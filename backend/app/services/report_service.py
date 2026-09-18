"""
services/report_service.py
Report generation for completed scans.

Supports three formats:
  - JSON  : machine-readable, full fidelity
  - Markdown : human-readable, executive + technical sections
  - PDF   : rendered from Markdown via WeasyPrint (falls back gracefully)

All generators are pure functions: they receive a ScanDetail-equivalent
dict and return bytes. No DB access here — that belongs in the route layer.
"""

from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

from app.core.logging import get_logger

logger = get_logger("sentinel.reports")

class PdfUnavailableError(RuntimeError):
    """Raised when WeasyPrint/markdown stack is missing or failed."""

# ── Severity ordering ─────────────────────────────────────────────────────────
_SEV_ORDER = ["critical", "high", "medium", "low", "info"]
_SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "🔵", "info": "⚪"}


# ── JSON report ───────────────────────────────────────────────────────────────

def generate_json(scan: dict[str, Any], findings: list[dict[str, Any]], repo: dict[str, Any]) -> bytes:
    """Full-fidelity machine-readable report."""
    report = {
        "sentinel_report_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scan": {
            "id": str(scan["id"]),
            "repository": repo.get("full_name", "unknown"),
            "branch": scan["branch"],
            "commit_sha": scan.get("commit_sha"),
            "status": scan["status"],
            "scanners_run": scan.get("scanners_run", {}),
            "started_at": scan.get("started_at"),
            "completed_at": scan.get("completed_at"),
        },
        "summary": {
            "total_findings": scan["total_findings"],
            "health_score": repo.get("health_score", 100.0),
            "by_severity": {
                "critical": scan["critical_count"],
                "high":     scan["high_count"],
                "medium":   scan["medium_count"],
                "low":      scan["low_count"],
                "info":     scan["info_count"],
            },
            "by_scanner": _count_by_scanner(findings),
            "by_category": _count_by_category(findings),
        },
        "findings": [_serialise_finding(f) for f in _sort_findings(findings)],
    }
    return json.dumps(report, indent=2, default=str).encode("utf-8")


# ── Markdown report ───────────────────────────────────────────────────────────

def generate_markdown(scan: dict[str, Any], findings: list[dict[str, Any]], repo: dict[str, Any]) -> bytes:
    lines: list[str] = []

    # ── Cover ──────────────────────────────────────────────────────────────
    lines += [
        "# Sentinel Security Report",
        "",
        f"**Repository:** `{repo.get('full_name', 'unknown')}`  ",
        f"**Branch:** `{scan['branch']}`  ",
        f"**Commit:** `{(scan.get('commit_sha') or 'n/a')[:8]}`  ",
        f"**Generated:** {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}  ",
        f"**Scan ID:** `{str(scan['id'])[:8].upper()}`",
        "",
        "---",
        "",
    ]

    # ── Executive summary ───────────────────────────────────────────────────
    health = repo.get("health_score", 100.0)
    health_label = "🟢 Good" if health >= 80 else ("🟡 Fair" if health >= 50 else "🔴 Critical")
    lines += [
        "## Executive Summary",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Health Score | **{health:.1f} / 100** — {health_label} |",
        f"| Total Findings | **{scan['total_findings']}** |",
        f"| Critical | {scan['critical_count']} |",
        f"| High | {scan['high_count']} |",
        f"| Medium | {scan['medium_count']} |",
        f"| Low | {scan['low_count']} |",
        f"| Info | {scan['info_count']} |",
        "",
    ]

    # Scanners
    scanners = scan.get("scanners_run") or {}
    if scanners:
        lines += ["**Scanners:**", ""]
        for name, status in scanners.items():
            icon = "✅" if status == "ok" else "❌"
            lines.append(f"- {icon} `{name}`: {status}")
        lines.append("")

    lines += ["---", ""]

    # ── Findings by severity ────────────────────────────────────────────────
    lines += ["## Findings", ""]
    sorted_findings = _sort_findings(findings)

    current_sev = None
    for f in sorted_findings:
        sev = f.get("severity", "info")
        if sev != current_sev:
            current_sev = sev
            emoji = _SEV_EMOJI.get(sev, "⚪")
            lines += [f"### {emoji} {sev.title()}", ""]

        lines += [
            f"#### {f.get('title', 'Untitled')}",
            "",
            f"| Field | Value |",
            f"|-------|-------|",
            f"| Scanner | `{f.get('scanner', 'unknown')}` |",
            f"| Category | {f.get('category', '—')} |",
            f"| Rule | `{f.get('rule_id', '—')}` |",
        ]
        if f.get("cve"):
            lines.append(f"| CVE | [{f['cve']}](https://nvd.nist.gov/vuln/detail/{f['cve']}) |")
        if f.get("cwe"):
            lines.append(f"| CWE | `{f['cwe']}` |")
        if f.get("cvss_score"):
            lines.append(f"| CVSS Score | **{f['cvss_score']}** |")
        if f.get("file_path"):
            loc = f":{f['line_start']}" if f.get("line_start") else ""
            lines.append(f"| Location | `{f['file_path']}{loc}` |")
        lines.append("")

        if f.get("description"):
            lines += [f.get("description", ""), ""]

        if f.get("code_snippet"):
            lines += ["**Code snippet:**", "", "```", f["code_snippet"], "```", ""]

        # AI remediation block
        if f.get("ai_explanation"):
            lines += [
                "**AI Analysis:**",
                "",
                f"> **Exploit mechanism:** {f['ai_explanation']}",
                "",
            ]
        if f.get("ai_impact"):
            lines += [f"> **Business impact:** {f['ai_impact']}", ""]
        if f.get("ai_exploitability") is not None:
            lines += [f"> **Exploitability score:** `{f['ai_exploitability']:.1f} / 10`", ""]
        if f.get("ai_patch_diff"):
            lines += ["**Suggested patch:**", "", "```diff", f["ai_patch_diff"], "```", ""]

        lines += ["---", ""]

    if not sorted_findings:
        lines += ["> ✅ No findings detected. Repository is clean.", ""]

    # ── Appendix ────────────────────────────────────────────────────────────
    lines += [
        "## Appendix",
        "",
        "### Findings by Scanner",
        "",
        "| Scanner | Count |",
        "|---------|-------|",
    ]
    for scanner, count in _count_by_scanner(findings).items():
        lines.append(f"| `{scanner}` | {count} |")
    lines += [
        "",
        "### Findings by Category",
        "",
        "| Category | Count |",
        "|----------|-------|",
    ]
    for cat, count in _count_by_category(findings).items():
        lines.append(f"| {cat} | {count} |")
    lines += ["", "*Report generated by Sentinel DevSecOps Platform*", ""]

    return "\n".join(lines).encode("utf-8")


# ── PDF report ────────────────────────────────────────────────────────────────

def generate_pdf(scan: dict[str, Any], findings: list[dict[str, Any]], repo: dict[str, Any]) -> bytes:
    """
    Renders the Markdown report to PDF via WeasyPrint (best quality).
    Falls back to a stdlib-only single-font PDF writer when WeasyPrint is
    missing/broken, so the download is ALWAYS a valid application/pdf —
    never markdown bytes mislabeled as PDF, never a 503 in normal operation.
    PdfUnavailableError is raised only if both engines fail.
    Zero new dependencies either way.
    """
    md_bytes = generate_markdown(scan, findings, repo)
    try:
        return _generate_pdf_weasyprint(md_bytes)
    except PdfUnavailableError as exc:
        logger.warning(f"WeasyPrint PDF failed ({exc}); using stdlib fallback")
    return _generate_pdf_fallback(md_bytes)


def _generate_pdf_weasyprint(md_bytes: bytes) -> bytes:
    try:
        import markdown as md_lib  # type: ignore[import]
        from weasyprint import CSS, HTML  # type: ignore[import]

        html_body = md_lib.markdown(
            md_bytes.decode("utf-8"),
            extensions=["tables", "fenced_code", "nl2br"],
        )
        full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body  {{ font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt;
           color: #1a1a2e; max-width: 900px; margin: 0 auto; padding: 2cm; }}
  h1   {{ color: #3730a3; border-bottom: 2px solid #3730a3; padding-bottom: 6px; }}
  h2   {{ color: #1e1b4b; margin-top: 28px; }}
  h3   {{ color: #312e81; }}
  h4   {{ color: #4c1d95; font-size: 10pt; margin-bottom: 4px; }}
  code, pre {{ background: #f5f5f5; border-radius: 4px; font-family: 'Courier New', monospace;
               font-size: 9pt; }}
  pre  {{ padding: 10px; overflow-x: auto; border-left: 3px solid #6366f1; }}
  table{{ border-collapse: collapse; width: 100%; font-size: 10pt; margin: 12px 0; }}
  th   {{ background: #ede9fe; color: #3730a3; padding: 6px 10px; text-align: left; }}
  td   {{ padding: 5px 10px; border-bottom: 1px solid #e5e7eb; }}
  blockquote {{ border-left: 3px solid #a78bfa; margin: 0; padding: 8px 16px;
                background: #f5f3ff; color: #4c1d95; }}
  hr   {{ border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }}
  @page {{ margin: 2cm; @bottom-center {{ content: "Sentinel Report — Page " counter(page); font-size: 9pt; color: #9ca3af; }} }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

        pdf_bytes = HTML(string=full_html).write_pdf(
            stylesheets=[CSS(string="@page { size: A4; }")]
        )
        return pdf_bytes

    except ImportError as exc:
        raise PdfUnavailableError("PDF engine unavailable, use markdown") from exc
    except Exception as exc:
        raise PdfUnavailableError("PDF engine unavailable, use markdown") from exc


def _pdf_escape(text: str) -> str:
    out: list[str] = []
    for ch in text:
        if ch in ("\\", "(", ")"):
            out.append("\\" + ch)
        elif 32 <= ord(ch) <= 126:
            out.append(ch)
        elif ch in ("\t",):
            out.append(" ")
        else:
            # Latin-1 keeps most western text readable; rest becomes '?'
            # (Helvetica WinAnsi cannot do CJK — accepted fallback tradeoff).
            try:
                ch.encode("latin-1")
                out.append(ch)
            except UnicodeEncodeError:
                out.append("?")
    return "".join(out)


def _wrap_line(line: str, width: int = 95) -> list[str]:
    if len(line) <= width:
        return [line]
    words = line.split(" ")
    rows: list[str] = []
    cur = ""
    for w in words:
        if len(w) > width:  # unbreakable token (hash/URL): hard-slice
            if cur:
                rows.append(cur)
                cur = ""
            while len(w) > width:
                rows.append(w[:width])
                w = w[width:]
            cur = w
        elif len(cur) + len(w) + (1 if cur else 0) <= width:
            cur = f"{cur} {w}" if cur else w
        else:
            rows.append(cur)
            cur = w
    if cur:
        rows.append(cur)
    return rows or [""]


def _generate_pdf_fallback(md_bytes: bytes) -> bytes:
    """Stdlib-only valid PDF (1.4, Helvetica, A4, paginated).

    Renders the markdown source as wrapped plain text — no styling, but a
    real, openable .pdf with zero native/system dependencies. Used when
    WeasyPrint is unavailable (slim images, missing pango, non-root without
    font cache, etc.).
    """
    text = md_bytes.decode("utf-8", errors="replace")
    rows: list[str] = []
    for raw in text.splitlines():
        rows.extend(_wrap_line(raw.rstrip()))

    # A4 @ 72dpi: 595x842. Margins 56pt; 12pt leading, 10pt Helvetica.
    # 48 text rows + 1 footer row per page.
    per_page = 48
    pages = [rows[i:i + per_page] for i in range(0, len(rows), per_page)] or [[]]

    objects: list[bytes] = []
    # 1: catalog, 2: pages, 3: font (populated after page count known)
    n_pages = len(pages)
    # Object numbering: 1 catalog, 2 pages, 3 font, then per page (page, content) pairs.
    page_obj_nums: list[tuple[int, int]] = []
    nxt = 4
    for _ in pages:
        page_obj_nums.append((nxt, nxt + 1))
        nxt += 2

    kids = " ".join(f"{p} 0 R" for p, _c in page_obj_nums)
    objects.append(f"<< /Type /Catalog /Pages 2 0 R >>".encode("latin-1"))  # obj 1
    objects.append(
        f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode("latin-1"))  # obj 2
    objects.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".encode("latin-1"))  # obj 3

    for idx, ((pnum, cnum), lines) in enumerate(zip(page_obj_nums, pages), start=1):
        content: list[str] = ["BT /F1 10 Tf 14 TL"]
        y = 786
        content.append(f"56 {y} Td")
        for i, line in enumerate(lines):
            content.append(f"({_pdf_escape(line)}) Tj")
            if i < len(lines) - 1:
                content.append("T*")
        content.append("ET")
        # Footer: page number (escaped — markdown body contains em-dashes etc.)
        content.append(
            f"BT /F1 8 Tf 56 30 Td ({_pdf_escape(f'Sentinel Report - Page {idx}/{n_pages}')}) Tj ET")
        stream = "\n".join(content).encode("latin-1")
        objects.append(  # page obj
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {cnum} 0 R >>".encode("latin-1"))
        objects.append(  # content obj
            f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = []
    for num, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{num} 0 obj\n".encode("ascii") + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode("ascii")
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_at}\n%%EOF").encode("ascii")
    return bytes(out)


# ── Diff summary ──────────────────────────────────────────────────────────────

def generate_diff_markdown(
    base_scan: dict[str, Any],
    head_scan: dict[str, Any],
    new_findings: list[dict[str, Any]],
    resolved_findings: list[dict[str, Any]],
    persisting_findings: list[dict[str, Any]],
    repo: dict[str, Any],
) -> bytes:
    lines: list[str] = [
        "# Sentinel Scan Diff Report",
        "",
        f"**Repository:** `{repo.get('full_name', 'unknown')}`  ",
        f"**Base scan:** `{str(base_scan['id'])[:8].upper()}` ({base_scan['branch']})  ",
        f"**Head scan:** `{str(head_scan['id'])[:8].upper()}` ({head_scan['branch']})  ",
        f"**Generated:** {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}",
        "",
        "---",
        "",
        "## Summary",
        "",
        f"| Status | Count |",
        f"|--------|-------|",
        f"| 🆕 New findings | **{len(new_findings)}** |",
        f"| ✅ Resolved | **{len(resolved_findings)}** |",
        f"| ⚠️ Persisting | **{len(persisting_findings)}** |",
        "",
    ]

    for section_label, section_findings, icon in [
        ("New Findings", new_findings, "🆕"),
        ("Resolved Findings", resolved_findings, "✅"),
        ("Persisting Findings", persisting_findings, "⚠️"),
    ]:
        lines += [f"## {icon} {section_label}", ""]
        if not section_findings:
            lines += ["> None.", ""]
            continue
        for f in _sort_findings(section_findings):
            sev_emoji = _SEV_EMOJI.get(f.get("severity", "info"), "⚪")
            lines += [
                f"- {sev_emoji} **{f.get('title','Untitled')}**"
                f"  `{f.get('file_path','')}:{f.get('line_start','')}`"
                f"  [{f.get('severity','').upper()}]",
            ]
        lines.append("")

    lines += ["---", "*Report generated by Sentinel DevSecOps Platform*"]
    return "\n".join(lines).encode("utf-8")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sort_findings(findings: list[dict]) -> list[dict]:
    rank = {s: i for i, s in enumerate(_SEV_ORDER)}
    return sorted(findings, key=lambda f: rank.get(f.get("severity", "info"), 99))


def _count_by_scanner(findings: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in findings:
        s = f.get("scanner", "unknown")
        counts[s] = counts.get(s, 0) + 1
    return dict(sorted(counts.items()))


def _count_by_category(findings: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in findings:
        c = f.get("category", "unknown")
        counts[c] = counts.get(c, 0) + 1
    return dict(sorted(counts.items()))


def _serialise_finding(f: dict) -> dict:
    return {
        "id": str(f.get("id", "")),
        "title": f.get("title", ""),
        "description": f.get("description", ""),
        "severity": f.get("severity", ""),
        "category": f.get("category", ""),
        "scanner": f.get("scanner", ""),
        "rule_id": f.get("rule_id", ""),
        "cve": f.get("cve"),
        "cwe": f.get("cwe"),
        "cvss_score": f.get("cvss_score"),
        "file_path": f.get("file_path"),
        "line_start": f.get("line_start"),
        "line_end": f.get("line_end"),
        "code_snippet": f.get("code_snippet"),
        "state": f.get("state", "open"),
        "ai_explanation": f.get("ai_explanation"),
        "ai_impact": f.get("ai_impact"),
        "ai_exploitability": f.get("ai_exploitability"),
        "ai_patch_diff": f.get("ai_patch_diff"),
    }
