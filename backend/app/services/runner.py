from __future__ import annotations
import json, os, shutil, subprocess, tempfile, time
from app.core.config import settings
from app.core.logging import get_logger
from app.scanners.base import BaseScanner, ScannerResult
logger = get_logger("sentinel.runner")
def is_tool_available(tool: str) -> bool: return shutil.which(tool) is not None
def run_scanner(scanner: BaseScanner, target_dir: str) -> ScannerResult:
    start = time.monotonic()
    if not is_tool_available(scanner.name):
        return ScannerResult(scanner=scanner.name, success=False, error=f"{scanner.name} not installed", duration_seconds=0.0)
    # P1-3: keep scanner JSON outside the scanned tree (Semgrep --no-git-ignore
    # and Trivy fs would otherwise re-scan our own output).
    fd, output_file = tempfile.mkstemp(prefix=f".sentinel_{scanner.name}_", suffix=".json", dir="/tmp")
    os.close(fd)
    cmd = scanner.command(target_dir, output_file)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=settings.SCANNER_TIMEOUT_SECONDS, check=False)
        if os.path.exists(output_file):
            with open(output_file, "r", encoding="utf-8", errors="replace") as fh: content = fh.read().strip()
            raw = json.loads(content) if content else {}
        elif proc.stdout.strip(): raw = json.loads(proc.stdout)
        else: raw = {}
        findings = scanner.parse(raw, target_dir)
        for f in findings:
            if f.code_snippet is None and f.file_path and f.line_start:
                f.code_snippet = scanner._read_snippet(os.path.join(target_dir, f.file_path), f.line_start)
        duration = round(time.monotonic() - start, 2)
        return ScannerResult(scanner=scanner.name, success=True, findings=findings, duration_seconds=duration)
    except subprocess.TimeoutExpired:
        return ScannerResult(scanner=scanner.name, success=False, error=f"Timed out after {settings.SCANNER_TIMEOUT_SECONDS}s", duration_seconds=round(time.monotonic()-start,2))
    except Exception as exc:
        return ScannerResult(scanner=scanner.name, success=False, error=str(exc), duration_seconds=round(time.monotonic()-start,2))
    finally:
        if os.path.exists(output_file):
            try: os.remove(output_file)
            except OSError: pass
