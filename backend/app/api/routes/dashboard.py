from __future__ import annotations
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Finding, FindingCategory, Repository, Scan, Severity, User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/stats")
async def dashboard_stats(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    total_scans = (await db.execute(select(func.count()).select_from(Scan).where(Scan.user_id == current_user.id))).scalar_one()
    total_repos = (await db.execute(select(func.count()).select_from(Repository).where(Repository.owner_id == current_user.id))).scalar_one()
    sev_rows = await db.execute(select(Finding.severity, func.count()).join(Scan).where(Scan.user_id == current_user.id).group_by(Finding.severity))
    distribution = {s.value: 0 for s in Severity}
    for sev, count in sev_rows.all(): distribution[sev.value] = count
    # Per-category counts back the Security Posture radar (real data —
    # the old radar fabricated these axes from score multipliers).
    cat_rows = await db.execute(select(Finding.category, func.count()).join(Scan).where(Scan.user_id == current_user.id).group_by(Finding.category))
    category_distribution = {c.value: 0 for c in FindingCategory}
    for cat, count in cat_rows.all(): category_distribution[cat.value] = count
    recent = await db.execute(select(Scan).options(selectinload(Scan.repository)).where(Scan.user_id == current_user.id).order_by(Scan.created_at.desc()).limit(10))
    recent_scans = [{"id": str(s.id), "repository_id": str(s.repository_id),
        "repository_name": s.repository.full_name if s.repository else "unknown",
        "status": s.status.value, "progress": s.progress, "total_findings": s.total_findings,
        "critical_count": s.critical_count, "high_count": s.high_count, "medium_count": s.medium_count,
        "low_count": s.low_count, "branch": s.branch, "created_at": s.created_at.isoformat(),
        "completed_at": s.completed_at.isoformat() if s.completed_at else None}
        for s in recent.scalars().all()]
    avg_health = (await db.execute(select(func.avg(Repository.health_score)).where(Repository.owner_id == current_user.id))).scalar_one()
    scanned_repos = (await db.execute(select(func.count(func.distinct(Scan.repository_id))).where(Scan.user_id == current_user.id))).scalar_one()
    return {"total_scans": total_scans, "total_repositories": total_repos, "scanned_repos": scanned_repos, "severity_distribution": distribution,
            "category_distribution": category_distribution,
            "avg_health_score": round(float(avg_health), 1) if avg_health else 100.0, "recent_scans": recent_scans}
