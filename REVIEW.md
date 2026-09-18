# Sentinel — Full Codebase Review + Implementation Log

> Audit: 2026-09-11 · Scope: `backend/` + `frontend/` + `docker-compose.yml`.
> Status as of 2026-09-11: **Batch A done, Batch B done** (details below). Original audit preserved verbatim after the log.

---

## Implementation status — 2026-09-11

### Batch A — dashboard unblock (done, rebuilt, verified live)
- P0-1 route conflict: `frontend/src/app/page.tsx` deleted; `(auth)/page.tsx` is single `/`.
- P0-2 dashboard stale detail: `dashboard/page.tsx` refetches `scanApi.get(activeScanId)` on selection + `handleTerminal` refetches stats/list/detail on WS terminal event.
- P0-3 `useScanStream` stale closure: now `useAppStore.getState()` inside callback + `onTerminalRef`; patches status/progress without clobbering.
- P0-5 WS auth: `stream.py` validates `?token=`, `decode_token`, `Scan.user_id == caller`, closes `4401/4404`; terminal-state re-check + close.
- Extra (found live): `git_service.clone_repository` falls back `requested branch → default HEAD` on `Remote branch not found`, rejects `-flag` branches, `tasks.py` records actual HEAD branch + warns. Fixes `google/security-crawl-maze main→master` case. Verified: `CE7D8E64/master/COMPLETED, 6 findings, health 73`.
- Extra (found live): `docker-compose.yml` redis `protected-mode no` + no host ports (prior `yes` caused `Connection reset by peer` from backend/worker while healthcheck stayed green → `POST /scans 500`). Verified: `PONG`, `POST /scans` unauth → `401` (not `500`).
- No `.env` files read or edited during implementation; `compose config` verified with `--no-interpolate --quiet` only.

### Batch B — correctness/honesty (done in tree, pending user test)
- P1-3 `services/runner.py`: scanner JSON via `tempfile.mkstemp(dir="/tmp")`, no longer inside target tree.
- P1-5 `scanners/gitleaks.py`: `raw` keeps only `RuleID/File/StartLine/EndLine/Commit/Entropy/Fingerprint`; `_redact()` → unconditional `"****"`. Old rows still tainted — one-time scrub required (no schema change):
  `UPDATE findings SET code_snippet='****', raw = raw - 'Match' - 'Secret' WHERE scanner='gitleaks';`
- P1-8 `scanners/base.py`: fingerprint `v2:<hash>` over `scanner|rule|relpath|snippet_hash` (fallback `line:`). Fits `String(128)`, no migration. **Accepted break:** v1 (bare hex) vs v2 diffs are NOT comparable — one generation of full churn. `GET /scans/diff` sets `X-Sentinel-Fingerprint-Warning: v1-vs-v2-not-comparable` on mixed compares; Reports UI notes it.
- P1-13 `services/report_service.py` + `api/routes/reports.py`: `generate_pdf()` raises `PdfUnavailableError`; route returns `503 "PDF engine unavailable, use markdown"` — never markdown-as-PDF. `reportApi.download` preserves `err.status`; Reports UI shows honest message.
- P2-4: `HealthRadar` deleted in Batch B (was `score×0.85/0.9/0.95` fabrication); **reinstated post-Batch-C per user request as `PostureRadar` in `SeverityChart.tsx`, now driven by real `category_distribution` from `GET /dashboard/stats` (100 when clean, −12/finding, floor 5; hover shows raw counts). Dashboard page grew 103→110 kB, no new deps (recharts already present). Dashboard stats gained one GROUP BY query (`category_distribution`).
- P2-11 `CodeExplorer.tsx`: `useMemo` tree, `Snippet view — full source not retained` banner + comments, decorations effect deps fixed + clears on unmount/switch.
- Cleanup: Topbar bell removed; Refresh is opt-in `onRefresh` (dashboard passes refetch, others hide — no `window.location.reload`); dashboard dead `refreshing` state removed.
- Verified: `py_compile` OK (runner, report_service, gitleaks, base, reports, scans), `compose config --no-interpolate --quiet` OK. Rebuild required: `docker compose up -d --build backend worker`.

### Batch C — hardening (done in tree, rebuild required)
- P1-2 `db/session.py`: `get_db` no longer auto-commits (rollback-on-error only); explicit `await db.commit()` added in `scans.py` (create/retry/cancel/reap), `repositories.py` (create/delete), `github.py` (callback/sync), `auth.py` (register). `tasks.py`: `uuid.UUID(scan_id)` cast before `db.get` (both main + crash paths); sync engine built lazily with `NullPool`.
- P1-1: `POST /scans` wraps `.delay()` → `FAILED` + `503` on broker-down; new `DELETE /scans/{id}` (revoke + `FAILED`), `POST /scans/{id}/retry` (new row, history preserved), `POST /scans/reap` (caller's stale >30 min → `FAILED` + orphan workspace sweep). Worker also reaps/sweeps opportunistically at task start — no beat container (disk constraint).
- P1-11: `git_service` now `validate_clone_url` (https-only, host allowlist `ALLOWED_GIT_HOSTS=github.com,gitlab.com`, no creds-in-URL, DNS-resolve + globally-routable check: `not is_global`/`is_multicast` reject, `is_reserved` rejects except NAT64 `64:ff9b::/96` — the blanket `is_reserved` check false-positived on Docker/DNS64-synthesised github.com AAAA records and blocked ALL github scans until fixed; verified live post-fix) + `validate_branch` (`^[A-Za-z0-9._\-/]{1,128}$`, no leading `-//`, no `..`) enforced in `POST /scans` AND `POST /repositories` (fail-fast `400` before DB rows). Token via `git -c http.extraHeader=` (never in URL), `GIT_TERMINAL_PROMPT=0`/`GIT_ASKPASS=true`, `--filter=blob:none --depth 1`, `--` separator, post-clone `du -sm` (os.walk fallback) vs `MAX_REPO_SIZE_MB` (now actually enforced).
- P1-10: `future.result(timeout=SCANNER_TIMEOUT+30)` per scanner; AI concurrent (`gather` + semaphore 4, 90s each via `wait_for`); `OpenRouterProvider.aclose()` + base-class no-op (socket leak fixed); all-scanners-failed → scan `FAILED` (not fake `COMPLETED 0`); `task_soft_time_limit` added.
- P1-12: `rate_limit_auth` (10/min/IP, same Redis client) on `auth/login,register,refresh,logout` + `github/login,callback`; JWTs carry `jti`; `POST /auth/logout` denylists refresh `jti` in Redis till expiry; `refresh` rejects denied `jti`; prod startup refuses default `SECRET_KEY`; crypto envelopes `v1:` (legacy rows still decrypt), lazy Fernet; `backend/.env.example` added; frontend `logout()` fire-and-forget `POST /auth/logout`.
- Non-root: backend `Dockerfile` creates `sentinel:10000`, `USER 10000`; compose `user/security_opt(no-new-privileges)/tmpfs/resources.limits` on backend+worker. Same base image, no new layers pulled. (`pids_limit` dropped — Compose maps it onto `deploy.resources.limits.pids` and rejects both set.)
- PDF (user-requested): `generate_pdf` now WeasyPrint-first with stdlib-only fallback writer (valid `%PDF-1.4`, Helvetica/A4/paginated, xref-verified) — download is ALWAYS a real PDF; `503` only if both engines fail. Route adds honest `X-Sentinel-PDF-Engine: weasyprint|stdlib-fallback`. Zero new deps.
- Disk constraint honored: no new PyPI/npm packages; shallow blobless clones; `docker system df` showed 10.8 GB reclaimable build cache → pruned.
- Verified: `py_compile` OK (all touched files), `compose config --no-interpolate --quiet` OK, PDF fallback byte-validated (`%PDF` head, `%%EOF` tail, full xref chain, 300-finding multipage doc), branch/crypto/URL validators unit-passed via stub harness. Rebuild required: `docker compose up -d --build backend worker`.

### Next (not started)
- Batch C (hardening): P1-1 cancel/retry/reaper, P1-2 UUID cast + explicit commits, P1-11 SSRF/branch allowlist + size enforce, P1-12 auth rate-limits, P1-10 Celery timeouts, non-root images.
- Batch D (engine depth): E1–E8 per original doc.

---

## Original audit (read-only, 2026-09-11 — preserved)

Files audited: `backend/app/main.py`, `core/{config,security,crypto,logging}.py`, `models/__init__.py`, `schemas/__init__.py`, `db/session.py`, `scanners/{base,registry,semgrep,bandit,trivy,gitleaks}.py`, `services/{runner,aggregator,git_service,github_service,report_service,pubsub}.py`, `workers/{tasks,celery_app}.py`, `api/{router,deps}.py`, `api/routes/{scans,dashboard,stream,auth,repositories,reports,github}.py`, `ai/{factory,providers/*}.py`, `frontend/src/{lib/{api,store,utils},hooks/{useScanStream,useAuth},components/{dashboard/*,scanner/*,shared/*},app/**}`, `docker-compose.yml`, both `Dockerfile`s, `requirements.txt`, `package.json`, `.gitignore`, `DOCKER_COMPOSE_FIX.md`. (`backend/.env` was NOT read from disk; values below come from the paste you provided.)

---

## P0 — Dashboard shows no scan results (your reported bug). Root causes, in order.

### P0-1. Route conflict: two pages both map to `/` (+ redirect loop)
- `frontend/src/app/page.tsx:1-5` (`redirect("/dashboard")`) **and** `frontend/src/app/(auth)/page.tsx:10` (login form) both resolve to `/` (route groups don't prefix URLs). Next errors with parallel-page conflict or silently prefers one, so the login page can be unreachable.
- `(app)/layout.tsx:10-12` redirects no-token users to `/`. If `/` itself redirects to `/dashboard`, unauthenticated users loop `/ → /dashboard → / → …` and never see usable content.
- **Fix:** delete `src/app/page.tsx`. Make `(auth)/page.tsx` the single `/` route and add: if token exists + `authApi.me()` succeeds → `router.replace("/dashboard")`. Add `src/app/not-found.tsx` + `error.tsx` while here.

### P0-2. Dashboard never auto-loads scan detail; findings panel only appears after a manual row click
- `frontend/src/app/(app)/dashboard/page.tsx:46-49` — `handleSelectScan` is the **only** place `setActiveScan` is called. The findings summary at `:116-138` renders only when `activeScan?.status === "completed"`.
- The 5s poller at `:33-38` refreshes `stats` + `scans` list but **never** refreshes `activeScan` detail. So a scan finishing while you watch the dashboard updates the table row but the "Scan Results" panel stays empty until you click the row again.
- **Fix:** after `loadData`, if `activeScanId` set → re-fetch `scanApi.get(activeScanId)`. Better: when WS event `status === "completed"` arrives for `activeScanId`, fetch `scanApi.get()` + `dashboardApi.stats()` once (don't rely on the 5s poll). Also auto-select the newest completed scan on first load if none selected (or drop the findings panel from dashboard entirely and point users to `/scans`, which already has a proper detail pane — see P2-8).

### P0-3. `useScanStream` stale closure — completion never propagates correctly
- `frontend/src/hooks/useScanStream.ts:7-25`: destructures `scans` from the store, uses it inside the WS callback, but `useEffect` deps are `[scanId]` only. The callback closes over a stale `scans` array and `setScans(scans.map(...))` can clobber fresher rows fetched by the poller. It also only patches `status`/`progress`, never `total_findings`/`*_count`, so the table keeps showing `—` even after completion.
- **Fix:**
```ts
const scans = useAppStore(s => s.scans); // subscribe, don't destructure once
useEffect(() => {
  if (!scanId) return;
  clearStream();
  const ws = openScanStream(scanId, (e) => {
    appendStream(e);
    if (e.status === "completed" || e.status === "failed") {
      useAppStore.getState().setScans(
        useAppStore.getState().scans.map(s => s.id === scanId ? { ...s, status: e.status, progress: e.progress } : s)
      );
      onTerminal?.(e); // caller refetches detail + stats
    }
  }, ...);
  return () => { ws.close(); };
}, [scanId]); // + onTerminal dep
```

### P0-4. `GET /dashboard/stats` payload half-unused, half-misleading
- `backend/app/api/routes/dashboard.py:18-23` returns `recent_scans` **without** `repository_id/name/progress/error` — and the dashboard never renders `recent_scans` at all (`dashboard/page.tsx` uses `stats` + `scans` only). Wasted query.
- `severity_distribution` counts **all findings across all historical scans** (rescans double-count). `avg_health_score` averages **all repos including never-scanned ones** (default `100.0` inflates the score).
- **Fix:** (a) either drop `recent_scans` from the endpoint or render it; (b) compute distribution over latest completed scan per repository (or add `?scope=latest`); (c) average health over repos with ≥1 completed scan, return `scanned_repos` count alongside; (d) add `repository_id`, `repository_name`, `progress` to each recent scan.

### P0-5. WS stream has no auth and can hang forever
- `frontend/src/lib/api.ts:111-118` appends `?token=`; `backend/app/api/routes/stream.py:9-10` accepts only `scan_id` and **ignores/never validates** the token, never checks the scan belongs to the caller. Any UUID-holder can stream anyone's scan.
- If a scan fails before emitting any event, buffered list is empty and the socket sits on `subscribe_events` forever (no timeout/heartbeat) — the terminal shows "Awaiting scan telemetry…" indefinitely.
- **Fix:** accept `WebSocket` + `token` query param (or subprotocol header), `decode_token`, verify `Scan.user_id == caller` before `accept()` (accept then close `4401` on failure). Add server-side ping every ~20s and a terminal-state re-check (poll DB once if no event in 60s).

---

## P1 — Backend bugs / reliability gaps (ordered by risk)

### P1-1. Scans stuck in `QUEUED` forever if Celery is down; no cancel/retry/reaper
- `api/routes/scans.py:36` fires `run_scan_task.delay(...)` with no broker-error handling. If Redis/Celery is down the HTTP 202 lies and the row never moves. No `DELETE /scans/{id}` (cancel), no retry, no periodic job marking stale `QUEUED/CLONING…` rows `FAILED`.
- **Fix:** wrap `.delay()` in try/except → on failure set scan `FAILED` + 503. Add cancel endpoint (revoke task + mark failed) and a Celery-beat/interval task to time out scans stuck >30 min.

### P1-2. `db.get(Scan, scan_id)` with `str` PK + implicit-commit `get_db`
- `workers/tasks.py:39,132` passes string `scan_id` to `db.get` whose PK is `UUID(as_uuid=True)` — Postgres raises `invalid input syntax for type uuid` on some paths; cast with `uuid.UUID(scan_id)` first.
- `db/session.py:12-21` commits after **every** request including read-only GETs, and routes depend on that implicit commit (`scans.py:28,33`, `repositories.py:16`). Move commits into the routes (`await db.commit()` before return), keep `get_db` to rollback-on-error only.

### P1-3. Scanner output file lives **inside** the scanned repo
- `services/runner.py:12` writes `.sentinel_{scanner}.json` into `target_dir`. Semgrep runs with `--no-git-ignore` (`scanners/semgrep.py:6`) so it re-scans that JSON; Trivy `fs` also walks it. **Fix:** `tempfile.NamedTemporaryFile(delete=False, dir="/tmp", suffix=".json")` outside target.

### P1-4. Scanner scope bloat + missed coverage
- Bandit (`scanners/bandit.py:7`) runs `-r target` with no excludes → scans `.git/`, `node_modules/`, `.venv/` (slow, false positives). Semgrep `--config auto` downloads rules every run (flaky/offline fail). Trivy `fs --scanners vuln,misconfig` (`scanners/trivy.py:6`) skips `secret` + `license`, no `--skip-dirs`, no DB cache warming. Gitleaks `--no-git` (`scanners/gitleaks.py:5`) on a `--depth 1` clone misses history secrets.
- **Fix:** Bandit `--exclude .git,node_modules,.venv,__pycache__`; Semgrep `--config p/ci` (or pin ruleset + `SEMGREP_APP_TOKEN` cache); Trivy `--scanners vuln,misconfig,secret --skip-dirs .git,node_modules,__pycache__` + `TRIVY_CACHE_DIR` volume + `--severity HIGH,CRITICAL` flag configurable; Gitleaks also run `detect --source` on full history when `.git` present (or keep `--no-git` but document the tradeoff).

### P1-5. Secret leak in Gitleaks `raw` + weak redaction
- `scanners/gitleaks.py:16` strips `Secret` but keeps `Match` (which usually **contains the secret**); `_redact` preserves first/last 4 chars. Persisting `raw` with `Match` to Postgres (`tasks.py:92`) stores near-plaintext secrets.
- **Fix:** drop both `Secret` and `Match` from `raw`, store only `{RuleID, File, StartLine, EndLine, Commit, Entropy, Fingerprint}`; make `_redact` return `"****"` unconditionally (or entropy-only).

### P1-6. Semgrep severity + title mapping loses signal
- `scanners/semgrep.py:3` maps `ERROR→HIGH` (no path to CRITICAL ever), `WARNING→MEDIUM`, `INFO→LOW`. Title uses `meta.shortlink` (a URL) instead of a human title (`semgrep.py:15-16`). Path relativization via string replace breaks on Windows separators. CWE `cwe_raw[0]` may be `"CWE-798"` or dict depending on ruleset version.
- **Fix:** map `ERROR→CRITICAL` when `confidence==HIGH` or `owasp`/`cwe` indicates injection/RCE, else HIGH; title = `meta.message[:120] or check_id`; `os.path.relpath(path, target_dir)`; normalize CWE to `CWE-\d+`.

### P1-7. Trivy CVSS + Bandit CWE normalization gaps
- `scanners/trivy.py:15-17` only reads `CVSS.nvd/redhat.V3Score` — GHSA/Ubuntu/V3.1/V4/V2 scores ignored → `cvss_score` often null. `scanners/bandit.py:18` stores bare numeric CWE id (`"78"`) vs Semgrep's `"CWE-78"`.
- **Fix:** iterate all vendors, prefer V4 > V3.1 > V3.0 > V2; normalize all CWEs to `CWE-<n>` format in one helper in `scanners/base.py`.

### P1-8. Fingerprint too weak → diff/new-vs-fixed is unreliable
- `scanners/base.py:17-19` hashes `scanner:rule:file:line` only. Any line shift (format, insert) creates false new+resolved pairs in `scans.py:57-62` diff and `reports.py:140-145`.
- **Fix:** `sha256(scanner|rule|relpath|line_content_hash|col?)[:32]` — hash normalized snippet (strip whitespace) + fallback to ±3-line context hash; store `fingerprint_version`.

### P1-9. Aggregator health score is naive; provenance dropped
- `services/aggregator.py:5,18` linear penalties (25/10/4/1/0.2) with no repo-size normalization, no CVSS/EPSS weighting; dedup keeps highest severity but discards which scanners agreed (loses confidence signal).
- **Fix:** keep `seen_count` + `seen_scanners[]` per fingerprint; health = `100 - min(100, Σ weight × reachability_factor)` with size normalization (`penalty / sqrt(kloc)`); expose `by_category`/`by_scanner` in the response (reports already recompute this client-side).

### P1-10. Celery task failure modes
- `workers/tasks.py:63-78`: `future.result()` has no timeout (one hung scanner blocks aggregation despite `SCANNER_TIMEOUT_SECONDS`); `asyncio.run(_process())` per scan creates a fresh loop and `OpenRouterProvider` opens an `httpx.AsyncClient` never closed (`ai/providers/openrouter.py:16`) → socket warnings/leak; AI is sequential over up to 25 findings (slow); final `COMPLETED` with 0 findings is indistinguishable from "all scanners failed" (only `scanners_run` dict hints it, and the frontend renders just ✔/✘ without the error text at `scans/page.tsx:155-163`).
- **Fix:** `future.result(timeout=settings.SCANNER_TIMEOUT_SECONDS + 30)`; shared `httpx.AsyncClient` with `aclose()`; `asyncio.gather` with semaphore(4); if all scanners failed → mark scan `FAILED` with combined error, not `COMPLETED`.

### P1-11. `clone_url` / `branch` unsanitized (SSRF + flag injection + size bomb)
- `api/routes/scans.py:24-28` accepts any `clone_url` (including `file:///etc`, `http://169.254.169.254/`); `branch` flows into `git clone --branch` (`services/git_service.py:17`) — a branch starting with `-` becomes a flag (`--upload-pack=` RCE vector); `MAX_REPO_SIZE_MB` (config) is **never enforced** anywhere.
- **Fix:** allowlist `https://github.com/`, `https://gitlab.com/` (+ configured hosts); reject `file://`, `ssh://`, credentials-in-URL, private-IP hosts (resolve + check); validate branch `^[A-Za-z0-9._\-/]{1,128}$` and pass `--` before URLs; `git clone --filter=blob:none` + post-clone `du -sm` check vs `MAX_REPO_SIZE_MB`; clone with `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`, token via `http.extraHeader` instead of URL (`git -c http.extraHeader="Authorization: Bearer …" clone …`) so it never appears in `/proc`/errors.

### P1-12. Auth/rate-limit hardening gaps
- `api/deps.py:37-44` rate-limits by IP+path on one route only (`scans.py:15`); login/register/GitHub-callback have **no** throttling (credential stuffing). Logout is client-side only (no refresh-token denylist). `core/security.py:8` argon2 with defaults, `SECRET_KEY` falls back to `"change-me-in-production"` (`core/config.py:13`). `core/crypto.py:10` module-level Fernet from `SHA256(SECRET_KEY)` — no rotation, stale if key reloads.
- **Fix:** apply `rate_limit` to `/auth/*` + `/github/*` keyed per-IP **and** per-account; add refresh-token `jti` denylist in Redis on logout; fail startup if `APP_ENV=production` and `SECRET_KEY` is default; version crypto envelopes (`v1:` prefix) for rotation.

### P1-13. Reports PDF fallback serves corrupt downloads
- `services/report_service.py:246-251` returns **markdown bytes** on WeasyPrint failure, but `api/routes/reports.py:117-124` still labels them `application/pdf` → user downloads a "PDF" that isn't one.
- **Fix:** on fallback either 503 with `{"detail": "PDF engine unavailable, use markdown"}` or return markdown with `text/markdown` + `.md` extension. Also stream large finding lists instead of building the whole `md` string in memory.

### P1-14. No migrations, Postgres-only models, sync/async engine split
- `db/session.py:23-26` uses `create_all` (no Alembic → production schema drift). `models/__init__.py` uses `UUID` + `JSONB` (can't run SQLite tests). `workers/tasks.py:14-16` derives sync URL by string-replace (breaks for non-asyncpg URLs) at import time.
- **Fix:** add Alembic; use `Uuid` + `JSON` (SQLAlchemy 2.0 generic) or keep PG types with `as_generic`; build sync engine lazily inside task with explicit mapping + pool `NullPool` for forked workers.

### P1-15. GitHub OAuth fragility
- `services/github_service.py:30-42` doesn't check `/user` status before `user["id"]` (401 → `KeyError` 500). `api/routes/github.py:65` redirects with tokens in URL **fragment** (persists in history/extensions) and derives frontend base from `cors_origins_list[0]`. `auth/callback/page.tsx` never clears the hash and login page never reads `?error=` (`(auth)/page.tsx` has no error-param handling) — OAuth failures are silent.
- **Fix:** `raise_for_status` + map to 502; pass tokens via one-time Redis code (`/auth/callback?code=…` → backend exchanges for tokens) or at minimum `history.replaceState`; surface `error` param on login page.

---

## P2 — Frontend bugs / dead code (all verified by import usage)

| # | Location | Issue | Fix |
|---|----------|-------|-----|
| P2-1 | `dashboard/page.tsx:5,18,40-44` | `RefreshCw`, `Loader2`, `refreshing`, `handleRefresh` defined, never rendered | Delete; Topbar owns refresh (which itself should go — P2-3) |
| P2-2 | `ScanTable.tsx:3`, `scans/page.tsx:4,12`, `FindingList.tsx:6`, `reports/page.tsx:1,9,13`, `settings/page.tsx:4` | Dead imports: `statusColor`, `Filter`, `healthColor` (scans), `severityColor`, `TrendingDown`, `useCallback`, `healthColor` (reports), `Bell` | Remove; add `eslint --max-warnings 0` + `tsc --noEmit` to CI |
| P2-3 | `Topbar.tsx:9-24` | Bell = dead (no backend, count only); Refresh = `window.location.reload()` (kills WS + selection) | Remove bell until notifications exist; replace reload with store `refetch()` callback prop |
| P2-4 | `SeverityChart.tsx:37-53` | `HealthRadar` fabricates Secrets/Deps/Config as `score×0.85/0.9/0.95` — misleading "Security Posture" | Compute from real `category` counts (needs API change) or delete radar, keep bar chart + numeric score |
| P2-5 | `ScanTable.tsx:54-62`, `scans/page.tsx:101-108`, `reports/page.tsx:327-333` | Findings badges show only C/H/M (sometimes +L), hide Info; no repo name, no error text for `failed` | Show all five + repo short name column (needs `repository_name` in `ScanOut`); render `error_message` tooltip on failed rows |
| P2-6 | `api.ts:45-67,124-156` | 401-interceptor `refreshing` boolean races (parallel 401s reject); `reportApi` uses raw `fetch` (no auto-refresh, no error body) | Queue pending requests during refresh; route report downloads through `http` with `responseType: "blob"` |
| P2-7 | `api.ts:34-35`, `next.config.ts:15-23` | `/api/backend` rewrite never used; browser hits `NEXT_PUBLIC_*=localhost:8000` baked at **build** time (`frontend/Dockerfile:12-13`) — breaks on any non-localhost host | Use same-origin `/api/backend/...` client in prod (rewrite) or runtime `window.__ENV__`; pass API URLs as Docker **build args** per env |
| P2-8 | `dashboard/page.tsx:115-138` vs `scans/page.tsx` | Two competing "scan results" UIs; dashboard summary duplicates scans detail pane with less info | Keep dashboard to stats + table + terminal; move findings/AI/diff deep-links to `/scans` (add "Open in Scans" button) |
| P2-9 | `scans/page.tsx:62-64,122-125` | `activeIsRunning` from stale 5s list; completing scan doesn't auto-switch terminal → findings (must re-click) | Drive pane from WS terminal event: on `completed` → `scanApi.get()` then render findings |
| P2-10 | `repositories/page.tsx:17-31,86` | `loadBranches` onFocus fails for manual repos (`full_name` w/o `/` → `owner=undefined`); `scans` var unused; post-create refetches whole list; **no delete button** though `DELETE /repositories` exists | Guard `full_name.includes("/")` else skip branch fetch; append created scan to store; add delete w/ confirm |
| P2-11 | `CodeExplorer.tsx:281-306` | **Shows synthetic content, not source**: builds `# path + snippets` pseudo-file; Monaco decorations at real `line_start` point at wrong lines; `buildFileTree` unmemoized; decorations effect misses editor-mount race | Label honestly ("Snippet view — full source not retained") OR retain workspace tarball / fetch via GitHub raw on demand; `useMemo` tree; include editor refs in effect deps; clear decorations on unmount |
| P2-12 | `FindingList.tsx:56-73` | AI/Patch tabs permanently disabled for medium/low (backend only enriches crit/high) with no explanation; no resolve/suppress, no pagination (1000+ findings = DOM freeze) | Hide tabs when absent + tooltip "AI covers critical/high only"; add virtualized list (`react-virtuoso`) + `state` toggle (needs API) |
| P2-13 | `reports/page.tsx:248-264,354-369` | Diff allows any two scans (cross-repo diff meaningless); `ScanPicker` lists completed only with no repo grouping | Constrain pickers to same `repository_id` (needs field in `ScanOut`); group options by repo |
| P2-14 | `settings/page.tsx:94-112` | Scanner list hardcoded `["Semgrep","Bandit","Trivy","Gitleaks"]` (drifts from `ENABLED_SCANNERS`); no connection test | Fetch `GET /health` (`enabled_scanners`) and render that; add "Test GitHub connection" |
| P2-15 | `(auth)/page.tsx`, `auth/callback/page.tsx` | Logged-in users still see login; OAuth hash never cleared; `?error=` never displayed | Redirect-if-authed on login; `history.replaceState` after reading hash; render `error` param |
| P2-16 | `(app)/layout.tsx` | Auth gate flashes content before redirect, no loading state | Gate on `useAuth().loading`; render skeleton until resolved |
| P2-17 | `package.json` | **9 unused Radix packages** (`dialog,tooltip,select,progress,tabs,scroll-area,separator,avatar,dropdown-menu` — zero imports in `src/`), `date-fns` unused (`utils.ts:36` uses native `toLocaleDateString`), dual `monaco-editor` + `@monaco-editor/react` weight | Remove unused; `npm ci` in Dockerfile; audit bundle (`next/bundle-analyzer`) |
| P2-18 | `store.ts` | No single-scan updater, no optimistic actions; `streamLines` unfiltered | Add `updateScan(id, patch)`, `prependScan()`, level filter for terminal |
| P2-19 | Global | No `error.tsx`, `loading.tsx`, 404, or ErrorBoundary anywhere; polling continues when tab hidden | Add route-level boundaries + `document.visibilityState` gating on intervals |

---

## Cleanup — unnecessary / not-working features (delete or fix, don't keep half-alive)

1. 🔔 Bell notifications (`Topbar.tsx:13-20`) — no backend. **Remove** until a real notifications feed exists.
2. 📡 HealthRadar fabricated axes (`SeverityChart.tsx:37-53`) — **remove or rewire** to real per-category data.
3. 📝 Fake Code Explorer source (`CodeExplorer.tsx:287-295`) — **relabel** as snippet viewer or implement real source fetch. Don't present pseudo-code as scanned files.
4. 📄 PDF export (`report_service.py:198-251`) — **disable button** with tooltip until WeasyPrint output is verified in the built image, or return proper fallback MIME (P1-13).
5. ↔️ Cross-repo diff (`reports/page.tsx`) — **constrain** to same repo.
6. 🌿 Branch dropdown for manual/URL repos (`repositories/page.tsx:66-74`) — **hide** when `full_name` has no `/` or GitHub not linked.
7. 📦 Unused deps (P2-17) + dead `/api/backend` rewrite (P2-7) + dead `recent_scans` payload (P0-4) + dead `Filter/healthColor/Bell` imports — **delete**.
8. 🗂️ `DOCKER_COMPOSE_FIX.md` (historical npm-404 note, already resolved) + stray `build.log` (binary in repo root) — **delete**; keep fixes in git history, not docs.
9. 📏 `MAX_REPO_SIZE_MB` (set, never read), per-finding `state` (model-only, no API/UI), `RATE_LIMIT_PER_MINUTE` (one route) — **implement or remove** from config/schema so settings tell the truth.
10. 🔄 Topbar full-reload Refresh — **replace** with targeted refetch.

---

## Security notes (beyond P1-11/P1-12)

- You pasted `backend/.env` with a real `GITHUB_CLIENT_SECRET` (+ secret key) into chat. **Rotate both now**: new GitHub OAuth secret + new `SECRET_KEY` (which also invalidates all Fernet-encrypted GitHub tokens — users must reconnect GitHub once). `.gitignore` already ignores `.env` — good — but add `backend/.env.example` with dummy values so setup doesn't require copying secrets.
- Images run as **root** (`backend/Dockerfile`, compose has no `user:`), no `read_only`, no `pids_limit`/`mem_limit` — a malicious repo scanned by semgrep/trivy parsers shares the worker. At minimum: `user: "10000"`, `WORKSPACE_ROOT` as tmpfs/volume, compose `deploy.resources.limits`, and `no-new-privileges:true`.
- `GET /health` discloses `enabled_scanners` + `ai_provider` — fine for now, but don't add versions/paths later.

---

## Engine upgrade — finding more intricate / higher-signal vulnerabilities

Current engine = generic SAST (Semgrep-auto + Bandit-python-only) + known-CVE (Trivy) + secrets (Gitleaks) + mock/LLM summaries. It **cannot** see: JS/TS/Go/Java vulns, IaC/K8s misconfig beyond Trivy defaults, Dockerfile anti-patterns, CI/CD supply-chain, API/authz flaws, reachability (is the vulnerable dep actually imported?), or business-risk ranking. Proposals below are ordered by signal-per-effort.

### E1. Close language gaps (highest miss rate today)
- Bandit covers **Python only**. Add: `eslint-plugin-security` + `npm audit`/`osv-scanner` (JS/TS), `gosec` (Go), `SpotBugs+FindSecBugs` or Semgrep Java rules (Java), `cargo audit` (Rust), `Hadolint` (Dockerfile). Reuse the existing `BaseScanner.command()+parse()` pattern — one file per scanner in `scanners/`, register in `registry.py`.
- Pin per-language Semgrep rulesets (`p/javascript`, `p/golang`, `p/java`, `p/docker`, `p/terraform`, `p/kubernetes`, `p/github-actions`) instead of single `auto`.

### E2. Reachability + dependency intelligence (kill "vulnerable but never imported" noise)
- Build import graph per ecosystem (`package.json`/`requirements`/`go.mod` → grep imports) and flag `reachable: bool` on each Trivy CVE. Sort reachable-exploitable first.
- Enrich every CVE with **EPSS + CISA KEV + CVSS v4**: `osv.dev` API + local KEV mirror; new `risk_score = f(CVSS, EPSS, KEV, reachable, exposure)` replaces raw severity sort. Store `epss`, `kev`, `reachable`, `risk_score` on `Finding`.

### E3. Taint-style checks Semgrep-auto misses (custom rules dir)
Add `backend/app/scanners/rules/*.yml` (mounted, versioned) for: SQLi string-concat → `execute()`, reflected XSS (`innerHTML` ← req param), SSRF (`requests.get(user_input)` / `fetch(req.query.url)`), command injection (`os.system`/`exec` ← input), path traversal (`open(base + user)`), JWT `verify(..., algorithms=["none"])` / hardcoded secret, Flask/Django `debug=True` + `SECRET_KEY=` literal, mass-assignment (`Model(**request.json)`), IDOR (`get_object(id)` without ownership check — heuristic + AI confirm), insecure deserialization (`pickle.loads`, `yaml.load` w/o Loader, `eval`), weak crypto (`md5`, `DES`, `Random()` for tokens), cookie `secure=False/httponly=False/samesite=None`.
- Each rule carries `cwe`, `owasp` (`A01…A10`), `confidence`, and a **fix template** the AI patcher must fill (so patches compile).

### E4. Supply-chain + CI/CD + IaC (where criticals hide in modern repos)
- GitHub Actions audit: `pull_request_target` + checkout persistence, unpinned `actions/*@v3` (pin to SHA), `secrets.*` echoed to logs, self-hosted runner on public repo, `write-all` permissions. Dockerfile audit: `FROM :latest`, `USER root`/missing `USER`, `ADD` vs `COPY`, secrets in `ENV/ARG`, `curl|bash` without checksum. K8s/Terraform: privileged pods, `hostNetwork`, S3 `acl=public-read`, SG `0.0.0.0/0:22/3389/5432/6379`, missing encryption at rest, IAM `*:*`. Implement as Semgrep rules + Trivy-misconfig severity bump when public-exposure combines with vuln (composite rule → CRITICAL).

### E5. Secrets 2.0 (precision, not just more regex)
- Verify candidates: entropy + surrounding context (`AKIA…` + `aws_secret` nearby), exclude tests/fixtures (`*_test.go`, `*.example`, entropy of UUIDs), tier severity (cloud keys/IAM → CRITICAL; generic high-entropy → HIGH; test data → INFO/suppressed). Never persist raw secret (P1-5); store `entropy`, `verified` (optional live check behind explicit opt-in flag only).

### E6. Detections that need cross-file reasoning (AI-assisted, scanner-proposed)
- Auth/session: JWT hardcoded secret, session fixation, password-reset token entropy/TTL, OAuth `state` missing, CORS `allow_credentials + *`. Rate-limit/auth missing on sensitive routes (compare route decorators vs auth deps — very feasible in this FastAPI codebase's own dogfood). OpenAPI: `GET /reports/{scan_id}`-style IDOR (missing ownership check — this codebase does it right via `user_id`, but scanned repos often don't), excessive data exposure, missing pagination caps (DoS).
- Pipeline: scanner emits **candidate** (low confidence) → AI confirms/rejects with evidence quotes → only confirmed persists. Add `confidence: high|medium|low` + `evidence: [file:line]` columns.

### E7. Accuracy infrastructure (makes every future rule better)
- `sentinel.yaml` per-repo config: `ignore_paths`, `baseline_file`, `severity_overrides`, `fail_on: critical`. Honor `// nosemgrep`/`# nosec` with required justification comment (else still flag). Baseline diff: first scan = baseline; PR scans show only **new** findings (fingerprint v2, P1-8). SARIF export + GitHub code-scanning upload + PR check-run summary. SBOM (CycloneDX) artifact per scan via Trivy `--format cyclonedx`.
- Validate AI patches: apply to temp copy → run targeted scanner rule → keep patch only if finding clears (else mark `patch_unverified`). Cap AI spend: risk-ordered top-N, cache by `rule+snippet_hash`.

### E8. Scale/perf (needed before E1–E7 on large repos)
- Shallow sparse checkout + incremental scan (`git fetch` + scan changed files for PRs, full scan nightly). Per-scanner timeouts + `task_time_limit` already set; add **cancel** (P1-1), queue priority (interactive > scheduled), workspace GC cron (orphaned `scan-*` dirs), Trivy DB shared volume so workers don't each download ~100MB+.

---

## Suggested implementation order (for your approval)

- **Batch A (unblock dashboard):** P0-1 → P0-2 → P0-3 → P0-4 (minimal) → P0-5 token check. *Acceptance: fresh login → run scan → dashboard table + counts + findings update live without clicks/reloads.*
- **Batch B (correctness/honesty):** P1-3, P1-5, P1-8, P1-13, P2-4, P2-11-label, Cleanup 1–4. *Acceptance: no fake radar/source, no corrupt PDFs, no secret material in DB.*
- **Batch C (hardening):** P1-1, P1-2, P1-11, P1-12, P1-10, compose/Dockerfile non-root + limits, `.env.example`, secret rotation.
- **Batch D (engine depth):** E1 (JS/Go rules) → E3 custom rules dir + `sentinel.yaml` → E2 reachability/EPSS/KEV → E6 AI-confirm pipeline → E7 SARIF/baseline/verified patches → E5/E4/E8.

Reply `proceed A` (or `A+B`, etc.) and I'll implement that batch with tests/build checks. If you want a smaller first step, say `P0 only`.
