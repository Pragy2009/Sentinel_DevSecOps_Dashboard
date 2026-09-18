from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.api.deps import get_current_user, rate_limit
from app.core.crypto import decrypt_token
from app.db.session import get_db
from app.models import Finding, Repository, Scan, ScanStatus, User
from app.schemas import FindingOut, ScanCreate, ScanCreateResponse, ScanDetail, ScanDiff, ScanOut

router = APIRouter(prefix="/scans", tags=["scans"])

@router.post("", response_model=ScanCreateResponse, status_code=202, dependencies=[Depends(rate_limit)])
async def create_scan(payload: ScanCreate, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> ScanCreateResponse:
    from app.workers.tasks import run_scan_task
    # C3: fail fast on malicious/oversized input BEFORE creating DB rows.
    from app.services.git_service import GitCloneError, validate_branch, validate_clone_url
    if payload.clone_url:
        try:
            validate_clone_url(payload.clone_url)
            validate_branch(payload.branch)
        except GitCloneError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    else:
        try:
            validate_branch(payload.branch)
        except GitCloneError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    repo = None
    if payload.repository_id:
        res = await db.execute(select(Repository).where(Repository.id == payload.repository_id, Repository.owner_id == current_user.id))
        repo = res.scalar_one_or_none()
        if not repo: raise HTTPException(status_code=404, detail="Repository not found")
    elif payload.clone_url:
        name = payload.clone_url.rstrip("/").split("/")[-1].replace(".git","")
        requested_branch = (payload.branch or "").strip() or "main"
        repo = Repository(owner_id=current_user.id, name=name, full_name=name, clone_url=payload.clone_url, default_branch=requested_branch)
        db.add(repo)
        await db.flush()
    else:
        raise HTTPException(status_code=400, detail="Provide repository_id or clone_url")
    effective_branch = (payload.branch or "").strip() or (repo.default_branch if repo and repo.default_branch else "main")
    scan = Scan(user_id=current_user.id, repository_id=repo.id, branch=effective_branch, status=ScanStatus.QUEUED)
    db.add(scan)
    await db.flush()
    await db.refresh(scan)
    # C1: explicit commit — get_db no longer auto-commits.
    await db.commit()
    clone_token = decrypt_token(current_user.github_access_token)
    # C2: broker-down honesty — a 202 that never runs is a lie. On .delay()
    # failure mark the row FAILED and return 503 so the UI tells the truth.
    try:
        run_scan_task.delay(str(scan.id), repo.clone_url, effective_branch, clone_token)
    except Exception as exc:
        scan.status = ScanStatus.FAILED
        scan.error_message = f"Queue unavailable: {exc}"
        await db.commit()
        raise HTTPException(status_code=503, detail="Scan queue unavailable, try again shortly")
    return ScanCreateResponse(scan_id=scan.id, status=ScanStatus.QUEUED, message=f"Scan queued for {repo.full_name}")


# ── C2: cancel / retry / reaper (defined before /{scan_id} so "reap" ──
# is never captured as a scan UUID) ──────────────────────────────────────

@router.post("/reap", status_code=200)
async def reap_scans(current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    """Mark the caller's stale non-terminal scans FAILED + sweep orphans."""
    from datetime import datetime, timedelta, timezone
    from app.services.git_service import sweep_orphan_workspaces as sweep_ws
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    res = await db.execute(
        select(Scan).where(
            Scan.user_id == current_user.id,
            Scan.status.in_([ScanStatus.QUEUED, ScanStatus.CLONING, ScanStatus.SCANNING,
                             ScanStatus.AGGREGATING, ScanStatus.AI_ANALYSIS]),
            Scan.created_at < cutoff,
        )
    )
    rows = list(res.scalars().all())
    for s in rows:
        s.status = ScanStatus.FAILED
        s.error_message = "Timed out: no terminal state within 30 min (reaped)"
    if rows:
        await db.commit()
    try:
        swept = sweep_ws(max_age_hours=2)
    except Exception:
        swept = 0
    return {"reaped": len(rows), "workspaces_swept": swept}


@router.delete("/{scan_id}", status_code=200)
async def cancel_scan(scan_id: uuid.UUID, hard: bool = Query(default=False),
                      current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    """Cancel a queued/active scan (revoke Celery task + mark FAILED).

    With `?hard=true` the row (and its findings via cascade) is deleted from
    the DB instead — for failed/unwanted scans. Active scans are revoked first
    so no orphan task keeps writing; the worker's crash path tolerates the
    missing row and orphan workspaces are swept by the reaper GC.
    """
    from app.workers.celery_app import celery_app
    res = await db.execute(select(Scan).where(Scan.id == scan_id, Scan.user_id == current_user.id))
    scan = res.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.celery_task_id and scan.status not in (ScanStatus.COMPLETED, ScanStatus.FAILED):
        try:
            celery_app.control.revoke(scan.celery_task_id, terminate=True)
        except Exception:
            pass
    if hard:
        await db.delete(scan)
        await db.commit()
        return Response(status_code=204)
    if scan.status in (ScanStatus.COMPLETED, ScanStatus.FAILED):
        return {"scan_id": scan.id, "status": scan.status, "message": "Already terminal"}
    scan.status = ScanStatus.FAILED
    scan.error_message = "Cancelled by user"
    await db.commit()
    return {"scan_id": scan.id, "status": scan.status, "message": "Scan cancelled"}


@router.post("/{scan_id}/retry", response_model=ScanCreateResponse, status_code=202)
async def retry_scan(scan_id: uuid.UUID, current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    """Re-queue a terminal scan as a brand-new row (history preserved)."""
    from app.workers.tasks import run_scan_task
    res = await db.execute(
        select(Scan).where(Scan.id == scan_id, Scan.user_id == current_user.id))
    orig = res.scalar_one_or_none()
    if not orig:
        raise HTTPException(status_code=404, detail="Scan not found")
    if orig.status not in (ScanStatus.COMPLETED, ScanStatus.FAILED):
        raise HTTPException(status_code=409, detail="Only completed/failed scans can be retried")
    res = await db.execute(
        select(Repository).where(Repository.id == orig.repository_id,
                                 Repository.owner_id == current_user.id))
    repo = res.scalar_one_or_none()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    scan = Scan(user_id=current_user.id, repository_id=repo.id,
                branch=orig.branch, status=ScanStatus.QUEUED)
    db.add(scan)
    await db.flush()
    await db.refresh(scan)
    await db.commit()
    clone_token = decrypt_token(current_user.github_access_token)
    try:
        run_scan_task.delay(str(scan.id), repo.clone_url, scan.branch, clone_token)
    except Exception as exc:
        scan.status = ScanStatus.FAILED
        scan.error_message = f"Queue unavailable: {exc}"
        await db.commit()
        raise HTTPException(status_code=503, detail="Scan queue unavailable, try again shortly")
    return ScanCreateResponse(scan_id=scan.id, status=ScanStatus.QUEUED,
                              message=f"Retry queued for {repo.full_name}")

@router.get("", response_model=list[ScanOut])
async def list_scans(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), limit: int = 50):
    res = await db.execute(select(Scan).where(Scan.user_id == current_user.id).order_by(Scan.created_at.desc()).limit(limit))
    return list(res.scalars().all())

@router.get("/{scan_id}", response_model=ScanDetail)
async def get_scan(scan_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Scan).options(selectinload(Scan.findings)).where(Scan.id == scan_id, Scan.user_id == current_user.id))
    scan = res.scalar_one_or_none()
    if not scan: raise HTTPException(status_code=404, detail="Scan not found")
    return scan

@router.get("/diff/{base_id}/{head_id}", response_model=ScanDiff)
async def diff_scans(base_id: uuid.UUID, head_id: uuid.UUID, response: Response, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    async def _findings(sid):
        res = await db.execute(select(Finding).join(Scan).where(Finding.scan_id == sid, Scan.user_id == current_user.id))
        return list(res.scalars().all())
    base, head = await _findings(base_id), await _findings(head_id)
    base_fp = {f.fingerprint: f for f in base}
    head_fp = {f.fingerprint: f for f in head}
    # Fingerprint v1 (bare hex) vs v2 (v2: prefix) are not comparable — flag it
    # via header instead of silently showing 100% churn (no schema change).
    versions = {("v2" if (fp or "").startswith("v2:") else "v1") for fp in list(base_fp) + list(head_fp)}
    if len(versions) > 1:
        response.headers["X-Sentinel-Fingerprint-Warning"] = "v1-vs-v2-not-comparable"
    return ScanDiff(base_scan_id=base_id, head_scan_id=head_id,
        new_findings=[FindingOut.model_validate(f) for f in head_fp.values() if f.fingerprint not in base_fp],
        resolved_findings=[FindingOut.model_validate(f) for f in base_fp.values() if f.fingerprint not in head_fp],
        persisting_findings=[FindingOut.model_validate(f) for f in head_fp.values() if f.fingerprint in base_fp])
