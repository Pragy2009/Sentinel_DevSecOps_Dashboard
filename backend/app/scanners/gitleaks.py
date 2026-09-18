from app.models import FindingCategory, Severity
from app.scanners.base import BaseScanner, NormalizedFinding
class GitleaksScanner(BaseScanner):
    name = "gitleaks"; category = FindingCategory.SECRET
    def command(self, target_dir, output_file): return ["gitleaks","detect","--source",target_dir,"--report-format","json","--report-path",output_file,"--no-git","--exit-code","0"]
    def parse(self, raw_output, target_dir):
        if not isinstance(raw_output, list): return []
        findings = []
        for item in raw_output:
            rule = item.get("RuleID","secret"); line = item.get("StartLine")
            findings.append(NormalizedFinding(rule_id=rule, title=f"Hardcoded secret: {item.get('Description',rule)}",
                description=f"Secret matching rule '{rule}' detected. Rotate and move to secret manager.",
                category=FindingCategory.SECRET, severity=Severity.CRITICAL, scanner=self.name,
                file_path=item.get("File"), line_start=line, line_end=item.get("EndLine",line),
                code_snippet=self._redact(item.get("Match","")),
                # P1-5: never persist secret material. Drop both `Secret` and
                # `Match` (Match usually contains the secret). Keep only metadata.
                raw={k: item.get(k) for k in ("RuleID", "File", "StartLine", "EndLine", "Commit", "Entropy", "Fingerprint") if item.get(k) is not None}))
        return findings
    @staticmethod
    def _redact(match): return "****"
