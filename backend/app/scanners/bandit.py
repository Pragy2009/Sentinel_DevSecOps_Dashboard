import os
from app.models import FindingCategory, Severity
from app.scanners.base import BaseScanner, NormalizedFinding
_SEV = {"HIGH": Severity.HIGH, "MEDIUM": Severity.MEDIUM, "LOW": Severity.LOW}
class BanditScanner(BaseScanner):
    name = "bandit"; category = FindingCategory.SAST
    def command(self, target_dir, output_file): return ["bandit","-r",target_dir,"-f","json","-o",output_file,"--quiet"]
    def parse(self, raw_output, target_dir):
        if not isinstance(raw_output, dict): return []
        findings = []
        for r in raw_output.get("results", []):
            sev = _SEV.get(str(r.get("issue_severity","LOW")).upper(), Severity.LOW)
            fp = r.get("filename",""); rel = os.path.relpath(fp, target_dir) if fp else None
            line = r.get("line_number")
            findings.append(NormalizedFinding(rule_id=r.get("test_id","bandit-unknown"), title=r.get("test_name","Bandit finding"),
                description=r.get("issue_text",""), category=FindingCategory.SAST, severity=sev, scanner=self.name,
                file_path=rel, line_start=line, line_end=line, code_snippet=(r.get("code") or "").strip() or None,
                cwe=str(r.get("issue_cwe",{}).get("id")) if r.get("issue_cwe") else None, raw=r))
        return findings
