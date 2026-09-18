# Changes Since Batch A (Dashboard Unblock)

> Batch A = P0-1 → P0-5 (route conflict, stale dashboard detail, `useScanStream`
> closure, WS auth, git branch fallback, redis `protected-mode` fix).
> Everything below came **after** that: Batch B, Batch C, and the follow-up
> fixes/features done live against the running stack.
> Status date: 2026-09-18. Items marked *(rebuild done)* are live.

---

## 1. Batch B — Correctness / Honesty *(live since 2026-09-11)*

| # | File(s) | What changed |
|---|---------|--------------|
| P1-3 | `backend/app/services/runner.py` | Scanner JSON now written via `tempfile.mkstemp(dir="/tmp")` — **outside** the scanned repo, so Semgrep (`--no-git-ignore`) and Trivy no longer re-scan our own output. |
| P1-5 | `backend/app/scanners/gitleaks.py` | `raw` keeps only `RuleID/File/StartLine/EndLine/Commit/Entropy/Fingerprint` — `Secret` **and** `Match` dropped; `_redact()` returns unconditional `"****"`. Old rows need a one-time scrub (no schema change): `UPDATE findings SET code_snippet='****', raw = raw - 'Match' - 'Secret' WHERE scanner='gitleaks';` |
| P1-8 | `backend/app/scanners/base.py`, `api/routes/scans.py`, `api/routes/reports.py`, `frontend/.../reports/page.tsx` | Fingerprint `v2:<hash>` over `scanner\|rule\|relpath\|snippet_hash` (fallback `line:`). Fits `String(128)`, no migration. **Accepted break:** v1 vs v2 diffs not comparable — `GET /scans/diff` sets `X-Sentinel-Fingerprint-Warning: v1-vs-v2-not-comparable` on mixed compares; Reports UI notes it. |
| P1-13 | `backend/app/services/report_service.py`, `api/routes/reports.py`, `frontend/src/lib/api.ts` | `generate_pdf()` raises `PdfUnavailableError`; route returns `503` instead of serving markdown labeled as PDF. `reportApi.download` preserves `err.status`; Reports UI shows the honest message. (Later superseded — see §3 PDF.) |
| P2-4 | `frontend/src/components/dashboard/SeverityChart.tsx` | `HealthRadar` **deleted** (fabricated axes). Dashboard showed numeric posture only. (Later reinstated on real data — see §4 Radar.) |
| P2-11 | `frontend/src/components/scanner/CodeExplorer.tsx` | Honest `Snippet view — full source not retained` banner, `useMemo` file tree, decorations effect deps fixed + cleared on unmount/switch. (This edit also dropped a closing `</div>` — build broke; fixed in §4.) |
| Cleanup | `frontend/src/components/shared/Topbar.tsx`, `(app)/dashboard/page.tsx` | Notification bell removed (no backend); Refresh is opt-in `onRefresh` (no `window.location.reload`); dead `refreshing` state removed. |

---

## 2. Batch C — Hardening *(rebuilt, live 2026-09-18)*

Zero new PyPI/npm packages — stdlib + existing deps only.

### C1 — DB correctness (`P1-2`)
- `backend/app/db/session.py` — `get_db` **no longer auto-commits** after every request (rollback-on-error only).
- Explicit `await db.commit()` added in: `api/routes/scans.py` (create/retry/cancel/reap), `repositories.py` (create/delete), `github.py` (callback/sync), `auth.py` (register).
- `workers/tasks.py` — `uuid.UUID(scan_id)` cast before `db.get` (main + crash paths); sync engine built **lazily** with `NullPool` instead of import-time string-replace.

### C2 — Cancel / retry / reaper (`P1-1`) — all NEW
- `POST /scans` wraps `.delay()` in try/except → row marked `FAILED` + `503` on broker-down (no more lying `202`).
- **NEW** `DELETE /scans/{id}` — revoke Celery task + mark `FAILED` (cancel).
- **NEW** `POST /scans/{id}/retry` — re-queues a terminal scan as a new row (history preserved).
- **NEW** `POST /scans/reap` — marks caller's stale (>30 min, non-terminal) scans `FAILED` + sweeps orphan workspaces.
- Worker runs reaper + workspace GC opportunistically at each task start — **no beat container** (disk constraint).
- **NEW** `sweep_orphan_workspaces()` in `services/git_service.py` (duplicated small helper in `tasks.py`).

### C3 — Clone input security (`P1-11`)
- **NEW** `ALLOWED_GIT_HOSTS` setting (`backend/app/core/config.py`, default `github.com,gitlab.com`) + `allowed_git_hosts_list` property.
- **NEW** `validate_clone_url()` — https-only, allowlisted host, no creds-in-URL, DNS-resolve + globally-routable IP check, 2048-char cap.
- **NEW** `validate_branch()` — `^[A-Za-z0-9._\-/]{1,128}$`, rejects leading `-`/`/`, `..`.
- Enforced fail-fast (`400`, before DB rows) in **both** `POST /scans` and `POST /repositories`.
- Token via `git -c http.extraHeader="Authorization: Bearer …"` (never in URL/`/proc`/logs); `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`; `--filter=blob:none --depth 1`; `--` separator against flag injection.
- `MAX_REPO_SIZE_MB` (previously set, never read) now enforced post-clone via `du -sm` (os.walk fallback) — **NEW** `_enforce_size()`, `_workspace_size_mb()`.

### C4 — Timeouts & leaks (`P1-10`)
- `future.result(timeout=SCANNER_TIMEOUT_SECONDS + 30)` per scanner — one hung scanner can't block aggregation.
- AI remediation concurrent (`asyncio.gather`, semaphore 4, 90 s `wait_for` each) instead of sequential over 25 findings.
- **NEW** `aclose()` on `OpenRouterProvider` + no-op base in `ai/providers/base.py` (socket leak fixed).
- All-scanners-failed → scan marked `FAILED` with combined error (was fake `COMPLETED` with 0 findings).
- `workers/celery_app.py` gained `task_soft_time_limit`.

### C5 — Auth hardening (`P1-12`)
- **NEW** `rate_limit_auth` (10/min/IP, same Redis client) in `api/deps.py`, applied to `auth/login,register,refresh,logout` + `github/login,callback`.
- **NEW** setting `AUTH_RATE_LIMIT_PER_MINUTE` (default 10).
- JWTs carry **`jti`** (`core/security.py`); **NEW** `POST /auth/logout` denylists refresh `jti` in Redis till expiry (**NEW** `deny_token()`/`is_token_denied()`); `refresh` rejects denied tokens.
- `core/crypto.py` — versioned `v1:` envelopes (legacy rows still decrypt), lazily-built Fernet (was module-level/stale-on-reload).
- `app/main.py` — refuses to start in `production` with default `SECRET_KEY`.
- **NEW file** `backend/.env.example` (dummy values; rotation notice).
- Frontend `authApi.logout()` now fire-and-forget `POST /auth/logout` before clearing tokens (call sites unchanged).

### C6 — Least privilege
- `backend/Dockerfile` — creates `sentinel:10000`, `USER 10000`, owns `/app` + workspace dir. Same base image, no new layers to pull.
- `docker-compose.yml` — `user: "10000"`, `no-new-privileges`, `tmpfs` on `/tmp`, `deploy.resources.limits` (cpu/mem) on backend + worker. (`pids_limit` was tried, then dropped — Compose rejects it alongside `deploy.resources.limits`.)

### PDF downloads that always work (user-requested, part of Batch C)
- `report_service.generate_pdf()` — WeasyPrint-first, **NEW** stdlib-only fallback writer (valid `%PDF-1.4`, Helvetica/A4/paginated, xref-verified). Download is always a real PDF; `503` only if both engines fail. Fixed an em-dash encoding bug in the fallback during testing.
- **NEW** response header `X-Sentinel-PDF-Engine: weasyprint | stdlib-fallback`.
- Zero new dependencies.

---

## 3. Follow-up fixes (found live after Batch C)

| Date | Issue | Fix |
|------|-------|-----|
| 2026-09-18 | `POST /scans` → `400` for **all** github.com repos | C3's `is_reserved` check false-positived on DNS64-synthesised NAT64 AAAA records (`64:ff9b::/96`) that Docker DNS returns for github.com. Gate is now `not is_global` / `is_multicast` / (`is_reserved` except NAT64 WKP). Verified against 16 IP cases + live in-container. |
| 2026-09-18 | `Clone failed: Authentication failed` on public repo | Not a code bug — user's stored GitHub OAuth token is dead (GitHub returns `401 Bad credentials`; decrypt path verified OK). Worker now appends *"— GitHub rejected your linked token (revoked/expired). Reconnect GitHub in Settings, then retry."* to such errors. User action: Settings → Connect GitHub. |
| 2026-09-18 | `docker compose up` → `pids_limit` vs `deploy.resources.limits.pids` conflict | Dropped `pids_limit` from compose (CPU/mem caps retained). |

---

## 4. Follow-up features (user-requested)

### Delete scans (NEW)
- Backend: `DELETE /scans/{id}?hard=true` → revokes task if active, deletes row + findings (cascade), `204`. Plain delete keeps cancel semantics.
- Frontend `scanApi.cancel()` / `scanApi.remove()` (**NEW**).
- Trash button on every scan: dashboard table extra column, scans sidebar list, scans detail-pane header — all with confirm dialog + store cleanup + stats refetch. Works for `failed`/`completed`/any state; deleting a running scan revokes it first.

### Security Posture radar (reinstated, now honest)
- `GET /dashboard/stats` gained **`category_distribution`** (one GROUP BY, no migration); `DashboardStats` type extended.
- **NEW** `PostureRadar` in `SeverityChart.tsx` — same mesh look, axes (Secrets/Deps/Code/Config/Containers) from real counts: 100 when clean, −12/finding, floor 5; hover shows raw counts. Dashboard +7 kB, no new deps.

### Frontend build repair
- Batch B's CodeExplorer edit had dropped a closing `</div>` — any frontend rebuild failed. Tag restored; `next build` compiles (warnings only, all pre-existing dead imports). Note: the build auto-touched `frontend/tsconfig.json` (`target: ES2017`).

---

## 5. Complete list of NEW files, endpoints, settings, headers

- **Files:** `backend/.env.example`
- **Endpoints:** `DELETE /scans/{id}` (cancel), `POST /scans/{id}/retry`, `POST /scans/reap`, `POST /auth/logout`
- **Params/headers:** `DELETE /scans/{id}?hard=true`; `X-Sentinel-PDF-Engine`; `X-Sentinel-Fingerprint-Warning` (Batch B)
- **Settings:** `ALLOWED_GIT_HOSTS`, `AUTH_RATE_LIMIT_PER_MINUTE`
- **DB reads (no migrations):** `category_distribution` aggregation; explicit commits everywhere (behavior-neutral)
- **Infra:** non-root backend/worker, compose resource caps, ~10.8 GB reclaimed via `docker builder prune`

## 6. Known open items (NOT yet done)

- **Semgrep is silently down** (found 2026-09-18, not yet fixed): unbounded `setuptools>=70.0.0` pulled v84, which removed `pkg_resources` → `semgrep` CLI crashes; runner reports it `"ok"` with 0 findings. Planned: pin `setuptools<81` + fail loudly on non-zero scanner exits.
- **Secret rotation overdue:** real `GITHUB_CLIENT_SECRET` + secret key were pasted into chat history — rotate both (users reconnect GitHub once after).
- Batch D engine depth (E1–E8), frontend P2 backlog, Alembic migrations, OAuth fragment-token flow — untouched.
