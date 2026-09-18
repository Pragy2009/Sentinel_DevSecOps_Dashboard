"""scanners/base.py"""
from __future__ import annotations
import abc, hashlib
from dataclasses import dataclass, field
from typing import Any, Optional
from app.models import FindingCategory, Severity

@dataclass
class NormalizedFinding:
    rule_id: str; title: str; description: str
    category: FindingCategory; severity: Severity; scanner: str
    file_path: Optional[str] = None; line_start: Optional[int] = None
    line_end: Optional[int] = None; code_snippet: Optional[str] = None
    cwe: Optional[str] = None; cve: Optional[str] = None
    cvss_score: Optional[float] = None; raw: dict[str, Any] = field(default_factory=dict)

    def fingerprint(self) -> str:
        # P1-8 v2: old `scanner:rule:file:line` churned on any line shift.
        # Hash normalized snippet when available, else line anchor. `v2:` prefix
        # fits existing String(128) (no schema change) and marks the break:
        # v1 diffs vs v2 diffs are NOT comparable (expect one generation of
        # new+resolved churn on first cross-version diff).
        rel = (self.file_path or "").replace("\\", "/").strip()
        snippet = (self.code_snippet or "").strip()
        if snippet:
            norm = " ".join(snippet.split())[:500]
            anchor = hashlib.sha256(norm.encode()).hexdigest()[:16]
        else:
            anchor = f"line:{self.line_start}"
        basis = f"{self.scanner}|{self.rule_id}|{rel}|{anchor}"
        return f"v2:{hashlib.sha256(basis.encode()).hexdigest()[:32]}"

    @staticmethod
    def fingerprint_version(fp: str | None) -> str:
        if not fp: return "unknown"
        return "v2" if fp.startswith("v2:") else "v1"

@dataclass
class ScannerResult:
    scanner: str; success: bool
    findings: list[NormalizedFinding] = field(default_factory=list)
    error: Optional[str] = None; duration_seconds: float = 0.0

class BaseScanner(abc.ABC):
    name: str = "base"; category: FindingCategory = FindingCategory.SAST

    @abc.abstractmethod
    def command(self, target_dir: str, output_file: str) -> list[str]: raise NotImplementedError

    @abc.abstractmethod
    def parse(self, raw_output: dict | list, target_dir: str) -> list[NormalizedFinding]: raise NotImplementedError

    @staticmethod
    def _read_snippet(file_path: str, line: Optional[int], context: int = 2) -> Optional[str]:
        if not file_path or line is None: return None
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as fh: lines = fh.readlines()
            return "".join(lines[max(0, line-1-context):min(len(lines), line+context)]).rstrip()
        except (OSError, IndexError): return None
