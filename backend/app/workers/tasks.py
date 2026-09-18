from __future__ import annotations
import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool
from app.core.config import settings
from app.core.logging import get_logger
from app.models import Finding, FindingState, Scan, ScanStatus, Severity
from app.services.pubsub import publish_event
from app.workers.celery_app import celery_app

logger = get_logger("sentinel.tasks")

# C1: build the sync engine lazily (import-time string-replace broke for
# non-asyncpg URLs) with NullPool — forked Celery workers must not share
# pooled connections.
SyncSession: sessionmaker[Session] | None = None


def _get_sync_session() -> Session:
    global SyncSession
    if SyncSession is None:
        url = settings.DATABASE_URL
        if "+asyncpg" in url:
            url = url.replace("+asyncpg", "+psycopg2")
        elif "://" in url and "+" not in url.split("://")[0]:
            # plain postgresql:// URL — psycopg2 is the sync default
            pass
        engine = create_engine(url, poolclass=NullPool, pool_pre_ping=True)
        SyncSession = sessionmaker(bind=engine)
    return SyncSession()

def _now(): return datetime.now(timezone.utc)


# ── C2: stale-scan reaper + workspace GC (zero infra: no beat container) ──
STALE_SCAN_MINUTES = 30
ACTIVE_STATUSES = (
    ScanStatus.QUEUED, ScanStatus.CLONING, ScanStatus.SCANNING,
    ScanStatus.AGGREGATING, ScanStatus.AI_ANALYSIS,
)

TERMINAL_STATUSES = (ScanStatus.COMPLETED, ScanStatus.FAILED)


def reap_stale_scans(db: Session, max_age_minutes: int = STALE_SCAN_MINUTES) -> int:
    """Mark scans stuck in non-terminal states past the age limit FAILED.

    Returns the number of rows transitioned. Best-effort: never raises.
    """
    from datetime import timedelta
    try:
        cutoff = _now() - timedelta(minutes=max_age_minutes)
        rows = db.query(Scan).filter(
            Scan.status.in_(ACTIVE_STATUSES),
            Scan.created_at < cutoff,
        ).all()
        for s in rows:
            s.status = ScanStatus.FAILED
            s.error_message = (
                f"Timed out: no terminal state within {max_age_minutes} min "
                "(worker may have been down; retry the scan)"
            )
            try:
                _emit(str(s.id), "error", "[!] Scan timed out — marked failed", 0, "failed")
            except Exception:
                pass
        if rows:
            db.commit()
            logger.warning(f"Reaped {len(rows)} stale scans")
        return len(rows)
    except Exception:
        logger.exception("reap_stale_scans failed")
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def sweep_orphan_workspaces(max_age_hours: int = 2) -> int:
    """Remove `scan-*` workspace dirs older than max_age_hours. Best-effort."""
    import os
    import shutil
    import time
    try:
        root = settings.WORKSPACE_ROOT
        if not root or not os.path.isdir(root):
            return 0
        now = time.time()
        removed = 0
        for entry in os.listdir(root):
            if not entry.startswith("scan-"):
                continue
            full = os.path.join(root, entry)
            try:
                if now - os.path.getmtime(full) > max_age_hours * 3600:
                    shutil.rmtree(full, ignore_errors=True)
                    removed += 1
            except OSError:
                continue
        return removed
    except Exception:
        return 0

def _emit(scan_id: str, level: str, message: str, progress: int, status: str) -> None:
    publish_event(scan_id, {"scan_id": scan_id, "level": level, "message": message,
        "progress": progress, "status": status, "ts": _now().isoformat()})

def _set_status(db: Session, scan: Scan, status: ScanStatus, progress: int) -> None:
    scan.status = status; scan.progress = progress; db.commit()

@celery_app.task(bind=True, name="sentinel.run_scan")
def run_scan_task(self, scan_id: str, clone_url: str, branch: str, token: str | None) -> dict:
    from app.scanners.registry import get_scanner
    from app.services.aggregator import aggregate
    from app.services.git_service import GitCloneError, cleanup_workspace, clone_repository, get_current_branch, get_head_sha
    from app.services.runner import run_scanner
    from app.ai.factory import get_ai_provider
    from app.ai.providers.base import RemediationRequest

    db = _get_sync_session()
    workspace = None
    try:
        # C2: opportunistic reaper — every task run cleans up scans stuck
        # while the worker was down, plus orphaned workspace dirs.
        try:
            reap_stale_scans(db)
            sweep_orphan_workspaces()
        except Exception:
            pass
        # C1: Scan PK is UUID(as_uuid=True) — cast str first, else Postgres
        # raises `invalid input syntax for type uuid` on some paths.
        try:
            scan_uuid = uuid.UUID(str(scan_id))
        except (ValueError, TypeError, AttributeError):
            return {"error": f"invalid scan_id: {scan_id!r}"}
        scan = db.get(Scan, scan_uuid)
        if not scan: return {"error": "scan not found"}
        scan.celery_task_id = self.request.id; scan.started_at = _now(); db.commit()

        _set_status(db, scan, ScanStatus.CLONING, 10)
        _emit(scan_id, "info", f"[+] Cloning {clone_url} ({branch})...", 10, "cloning")
        try:
            workspace = clone_repository(clone_url, branch, token)
        except GitCloneError as exc:
            msg = str(exc)
            # Dead/revoked OAuth token surfaces as raw git stderr — translate
            # it into an actionable message (public repos don't even need a
            # token, so auth failure with a token present means it is invalid).
            if "Authentication failed" in msg and "github.com" in (clone_url or ""):
                msg += " — GitHub rejected your linked token (revoked/expired). Reconnect GitHub in Settings, then retry."
            scan.status = ScanStatus.FAILED; scan.error_message = msg; db.commit()
            _emit(scan_id, "error", f"[!] Clone failed: {msg}", 0, "failed")
            return {"error": msg}

        sha = get_head_sha(workspace)
        if sha: scan.commit_sha = sha; db.commit()
        actual_branch = get_current_branch(workspace)
        if actual_branch and actual_branch != "HEAD" and actual_branch != scan.branch:
            logger.warning(f"Requested branch '{scan.branch}' not found, scanned default HEAD '{actual_branch}' instead")
            scan.branch = actual_branch; db.commit()
            _emit(scan_id, "warn", f"[!] Branch not found, scanned default '{actual_branch}' instead", 20, "cloning")
        _emit(scan_id, "success", f"[✔] Clone complete (HEAD {sha[:8] if sha else 'n/a'})", 20, "cloning")

        _set_status(db, scan, ScanStatus.SCANNING, 30)
        enabled = settings.enabled_scanners_list
        _emit(scan_id, "info", f"[+] Running: {', '.join(enabled)}", 30, "scanning")

        all_findings = []
        scanners_run: dict[str, str] = {}

        with ThreadPoolExecutor(max_workers=max(len(enabled), 1)) as pool:
            future_map = {}
            for name in enabled:
                scanner = get_scanner(name)
                if scanner: future_map[pool.submit(run_scanner, scanner, workspace)] = name
                else: scanners_run[name] = "unknown"
            done = 0
            # C4: bound each future — one hung scanner must not block
            # aggregation forever (runner has its own timeout; this is the
            # belt-and-braces ceiling).
            _f_timeout = settings.SCANNER_TIMEOUT_SECONDS + 30
            for future in as_completed(future_map):
                name = future_map[future]
                try:
                    result = future.result(timeout=_f_timeout)
                except Exception as exc:
                    done += 1
                    progress = 30 + int((done / max(len(future_map), 1)) * 40)
                    scanners_run[name] = f"failed: timed out or crashed: {exc}"
                    _emit(scan_id, "warn", f"[!] {name} skipped: {exc}", progress, "scanning")
                    continue
                done += 1
                progress = 30 + int((done / max(len(future_map), 1)) * 40)
                if result.success:
                    scanners_run[name] = "ok"; all_findings.extend(result.findings)
                    _emit(scan_id, "success", f"[✔] {name}: {len(result.findings)} findings ({result.duration_seconds}s)", progress, "scanning")
                else:
                    scanners_run[name] = f"failed: {result.error}"
                    _emit(scan_id, "warn", f"[!] {name} skipped: {result.error}", progress, "scanning")

        scan.scanners_run = scanners_run; db.commit()

        # C4: all scanners failed is not a clean scan — mark FAILED with the
        # combined error so the UI (and reports gate) tells the truth.
        _ran = [v for k, v in scanners_run.items() if v != "unknown"]
        if _ran and all(v != "ok" for v in _ran):
            scan.status = ScanStatus.FAILED
            scan.error_message = "All scanners failed: " + "; ".join(
                f"{k}: {v}" for k, v in scanners_run.items() if v != "ok")
            db.commit()
            _emit(scan_id, "error", f"[!] {scan.error_message}", 0, "failed")
            return {"error": scan.error_message}

        _set_status(db, scan, ScanStatus.AGGREGATING, 75)
        _emit(scan_id, "info", "[+] Aggregating findings...", 75, "aggregating")
        agg = aggregate(all_findings)

        finding_rows = []
        for nf in agg.findings:
            row = Finding(scan_id=scan.id, rule_id=nf.rule_id, title=nf.title[:512],
                description=nf.description or "", category=nf.category, severity=nf.severity,
                scanner=nf.scanner, cwe=nf.cwe, cve=nf.cve, cvss_score=nf.cvss_score,
                file_path=nf.file_path, line_start=nf.line_start, line_end=nf.line_end,
                code_snippet=nf.code_snippet, state=FindingState.OPEN, fingerprint=nf.fingerprint(), raw=nf.raw)
            db.add(row); finding_rows.append(row)

        scan.total_findings = agg.total
        scan.critical_count = agg.counts[Severity.CRITICAL.value]
        scan.high_count = agg.counts[Severity.HIGH.value]
        scan.medium_count = agg.counts[Severity.MEDIUM.value]
        scan.low_count = agg.counts[Severity.LOW.value]
        scan.info_count = agg.counts[Severity.INFO.value]
        if scan.repository: scan.repository.health_score = agg.health_score
        db.commit()
        _emit(scan_id, "success", f"[✔] {agg.total} findings | health {agg.health_score}/100", 80, "aggregating")

        _set_status(db, scan, ScanStatus.AI_ANALYSIS, 85)
        _emit(scan_id, "info", "[+] AI remediation for critical/high findings...", 85, "ai_analysis")

        targets = [f for f in finding_rows if f.severity in (Severity.CRITICAL, Severity.HIGH)][:settings.AI_MAX_FINDINGS_PER_SCAN]
        if targets:
            provider = get_ai_provider()
            # C4: concurrent AI (semaphore 4) with per-finding timeout, and
            # always close the httpx client (fixes socket leak). Sequential
            # over 25 findings was the long tail of every scan.
            async def _process():
                sem = asyncio.Semaphore(4)
                done_count = 0

                async def _one(f):
                    nonlocal done_count
                    req = RemediationRequest(title=f.title, description=f.description, severity=f.severity.value,
                        scanner=f.scanner, file_path=f.file_path, code_snippet=f.code_snippet, cwe=f.cwe, cve=f.cve)
                    try:
                        async with sem:
                            result = await asyncio.wait_for(provider.remediate(req), timeout=90)
                        f.ai_explanation = result.explanation; f.ai_impact = result.impact
                        f.ai_exploitability = result.exploitability; f.ai_patch_diff = result.patch_diff
                        db.commit()
                    except Exception as exc:
                        logger.warning(f"AI remediation failed for {f.id}: {exc}")
                    finally:
                        done_count += 1
                        _emit(scan_id, "info", f"[+] AI {done_count}/{len(targets)}: {f.title[:48]}",
                              85 + int((done_count / len(targets)) * 13), "ai_analysis")

                try:
                    await asyncio.gather(*(_one(f) for f in targets))
                finally:
                    try:
                        aclose = getattr(provider, "aclose", None)
                        if aclose is not None:
                            await aclose()
                    except Exception:
                        pass
            asyncio.run(_process())

        scan.status = ScanStatus.COMPLETED; scan.progress = 100; scan.completed_at = _now(); db.commit()
        _emit(scan_id, "success", f"[✔] Scan complete — {agg.total} findings", 100, "completed")
        return {"scan_id": scan_id, "total": agg.total, "health_score": agg.health_score}

    except Exception as exc:
        logger.exception("Scan task crashed")
        try:
            # C1: re-cast — scan_id may be an arbitrary string here.
            try:
                crashed_uuid = uuid.UUID(str(scan_id))
            except (ValueError, TypeError, AttributeError):
                crashed_uuid = None
            scan = db.get(Scan, crashed_uuid) if crashed_uuid else None
            if scan: scan.status = ScanStatus.FAILED; scan.error_message = str(exc); db.commit()
        except Exception: pass
        _emit(scan_id, "error", f"[!] Scan failed: {exc}", 0, "failed")
        return {"error": str(exc)}
    finally:
        if workspace:
            from app.services.git_service import cleanup_workspace
            cleanup_workspace(workspace)
        db.close()
