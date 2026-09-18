from app.models import FindingCategory, Severity
from app.scanners.base import BaseScanner, NormalizedFinding
_SEV = {"ERROR": Severity.HIGH, "WARNING": Severity.MEDIUM, "INFO": Severity.LOW}
class SemgrepScanner(BaseScanner):
    name = "semgrep"; category = FindingCategory.SAST
    def command(self, target_dir, output_file): return ["semgrep","scan","--config","auto","--json","--output",output_file,"--quiet","--no-git-ignore",target_dir]
    def parse(self, raw_output, target_dir):
        if not isinstance(raw_output, dict): return []
        findings = []
        for r in raw_output.get("results", []):
            extra = r.get("extra",{}); meta = extra.get("metadata",{})
            sev = _SEV.get(str(extra.get("severity","INFO")).upper(), Severity.INFO)
            path = r.get("path",""); rel = path.replace(target_dir,"").lstrip("/") if path else None
            cwe_raw = meta.get("cwe"); cwe = cwe_raw[0] if isinstance(cwe_raw,list) and cwe_raw else (cwe_raw if isinstance(cwe_raw,str) else None)
            findings.append(NormalizedFinding(rule_id=r.get("check_id","semgrep-unknown"),
                title=meta.get("shortlink") or r.get("check_id","Semgrep finding"), description=extra.get("message",""),
                category=FindingCategory.SAST, severity=sev, scanner=self.name, file_path=rel,
                line_start=r.get("start",{}).get("line"), line_end=r.get("end",{}).get("line"),
                code_snippet=(extra.get("lines") or "").strip() or None, cwe=cwe, raw=r))
        return findings
