"""
api/routes/reports.py
Report download and scan-diff endpoints.

GET /reports/{scan_id}?format=json|markdown|pdf
    Download a full scan report in the requested format.

GET /reports/diff/{base_id}/{head_id}?format=json|markdown
    Download a diff report comparing two scans.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Finding, Repository, Scan, ScanStatus, User
from app.services.report_service import (
    PdfUnavailableError,
    generate_diff_markdown,
    generate_json,
    generate_markdown,
    generate_pdf,
)

router = APIRouter(prefix="/reports", tags=["reports"])

ReportFormat = Literal["json", "markdown", "pdf"]

_MEDIA = {
    "json":     ("application/json",     ".json"),
    "markdown": ("text/markdown",        ".md"),
    "pdf":      ("application/pdf",      ".pdf"),
}


async def _get_scan_with_access(
    scan_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> tuple[Scan, Repository]:
    res = await db.execute(
        select(Scan)
        .options(selectinload(Scan.findings), selectinload(Scan.repository))
        .where(Scan.id == scan_id, Scan.user_id == current_user.id)
    )
    scan = res.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status != ScanStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Report only available for completed scans")
    return scan, scan.repository


def _finding_to_dict(f: Finding) -> dict:
    return {
        "id": str(f.id), "title": f.title, "description": f.description,
        "severity": f.severity.value, "category": f.category.value,
        "scanner": f.scanner, "rule_id": f.rule_id,
        "cve": f.cve, "cwe": f.cwe, "cvss_score": f.cvss_score,
        "file_path": f.file_path, "line_start": f.line_start, "line_end": f.line_end,
        "code_snippet": f.code_snippet, "state": f.state.value,
        "ai_explanation": f.ai_explanation, "ai_impact": f.ai_impact,
        "ai_exploitability": f.ai_exploitability, "ai_patch_diff": f.ai_patch_diff,
    }


def _scan_to_dict(s: Scan) -> dict:
    return {
        "id": str(s.id), "branch": s.branch, "commit_sha": s.commit_sha,
        "status": s.status.value, "scanners_run": s.scanners_run,
        "total_findings": s.total_findings, "critical_count": s.critical_count,
        "high_count": s.high_count, "medium_count": s.medium_count,
        "low_count": s.low_count, "info_count": s.info_count,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
    }


def _repo_to_dict(r: Repository | None) -> dict:
    if not r:
        return {"full_name": "unknown", "health_score": 100.0}
    return {"full_name": r.full_name, "health_score": r.health_score,
            "name": r.name, "clone_url": r.clone_url}


# ── GET /reports/{scan_id} ────────────────────────────────────────────────────

@router.get("/{scan_id}")
async def download_report(
    scan_id: uuid.UUID,
    format: ReportFormat = Query(default="markdown"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    scan, repo = await _get_scan_with_access(scan_id, current_user, db)

    scan_dict = _scan_to_dict(scan)
    findings_dicts = [_finding_to_dict(f) for f in scan.findings]
    repo_dict = _repo_to_dict(repo)
    ref = str(scan.id)[:8].upper()

    if format == "json":
        content = generate_json(scan_dict, findings_dicts, repo_dict)
    elif format == "pdf":
        try:
            content = generate_pdf(scan_dict, findings_dicts, repo_dict)
        except PdfUnavailableError as exc:
            # Both engines failed — honest 503, never corrupt bytes as PDF.
            raise HTTPException(status_code=503, detail=str(exc))
    else:
        content = generate_markdown(scan_dict, findings_dicts, repo_dict)

    media_type, ext = _MEDIA[format]
    filename = f"sentinel-report-{ref}{ext}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if format == "pdf":
        # Honest engine signal: UI/support can tell styled vs fallback PDF.
        try:
            import weasyprint  # noqa: F401
            headers["X-Sentinel-PDF-Engine"] = "weasyprint"
        except ImportError:
            headers["X-Sentinel-PDF-Engine"] = "stdlib-fallback"

    return Response(
        content=content,
        media_type=media_type,
        headers=headers,
    )


# ── GET /reports/diff/{base_id}/{head_id} ─────────────────────────────────────

@router.get("/diff/{base_id}/{head_id}")
async def download_diff_report(
    base_id: uuid.UUID,
    head_id: uuid.UUID,
    format: Literal["json", "markdown"] = Query(default="markdown"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    base_scan, base_repo = await _get_scan_with_access(base_id, current_user, db)
    head_scan, _ = await _get_scan_with_access(head_id, current_user, db)

    base_fp = {f.fingerprint: f for f in base_scan.findings}
    head_fp = {f.fingerprint: f for f in head_scan.findings}

    new_findings     = [_finding_to_dict(f) for fp, f in head_fp.items() if fp not in base_fp]
    resolved_findings = [_finding_to_dict(f) for fp, f in base_fp.items() if fp not in head_fp]
    persisting_findings = [_finding_to_dict(f) for fp, f in head_fp.items() if fp in base_fp]

    base_ref = str(base_scan.id)[:8].upper()
    head_ref = str(head_scan.id)[:8].upper()

    if format == "json":
        import json
        from datetime import datetime, timezone
        content = json.dumps({
            "sentinel_diff_version": "1.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "base_scan_id": str(base_id),
            "head_scan_id": str(head_id),
            "repository": _repo_to_dict(base_repo)["full_name"],
            "new_findings": new_findings,
            "resolved_findings": resolved_findings,
            "persisting_findings": persisting_findings,
            "summary": {
                "new": len(new_findings),
                "resolved": len(resolved_findings),
                "persisting": len(persisting_findings),
            },
        }, indent=2, default=str).encode("utf-8")
        media_type, ext = "application/json", ".json"
    else:
        content = generate_diff_markdown(
            _scan_to_dict(base_scan), _scan_to_dict(head_scan),
            new_findings, resolved_findings, persisting_findings,
            _repo_to_dict(base_repo),
        )
        media_type, ext = "text/markdown", ".md"

    filename = f"sentinel-diff-{base_ref}-{head_ref}{ext}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
