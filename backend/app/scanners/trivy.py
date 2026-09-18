from app.models import FindingCategory, Severity
from app.scanners.base import BaseScanner, NormalizedFinding
_SEV = {"CRITICAL":Severity.CRITICAL,"HIGH":Severity.HIGH,"MEDIUM":Severity.MEDIUM,"LOW":Severity.LOW,"UNKNOWN":Severity.INFO}
class TrivyScanner(BaseScanner):
    name = "trivy"; category = FindingCategory.DEPENDENCY
    def command(self, target_dir, output_file): return ["trivy","fs","--scanners","vuln,misconfig","--format","json","--output",output_file,"--quiet",target_dir]
    def parse(self, raw_output, target_dir):
        if not isinstance(raw_output, dict): return []
        findings = []
        for result in raw_output.get("Results",[]):
            target = result.get("Target","")
            for vuln in result.get("Vulnerabilities",[]) or []:
                sev = _SEV.get(str(vuln.get("Severity","UNKNOWN")).upper(), Severity.INFO)
                cvss_score = None
                for vendor in ("nvd","redhat"):
                    if vendor in (vuln.get("CVSS") or {}) and "V3Score" in vuln["CVSS"][vendor]:
                        cvss_score = vuln["CVSS"][vendor]["V3Score"]; break
                findings.append(NormalizedFinding(rule_id=vuln.get("VulnerabilityID","trivy-vuln"),
                    title=f"{vuln.get('PkgName','pkg')}: {vuln.get('Title',vuln.get('VulnerabilityID',''))}",
                    description=vuln.get("Description","")[:2000], category=FindingCategory.DEPENDENCY, severity=sev,
                    scanner=self.name, file_path=target, cve=vuln.get("VulnerabilityID"), cvss_score=cvss_score,
                    raw={"PkgName":vuln.get("PkgName"),"InstalledVersion":vuln.get("InstalledVersion"),"FixedVersion":vuln.get("FixedVersion")}))
            for mis in result.get("Misconfigurations",[]) or []:
                sev = _SEV.get(str(mis.get("Severity","UNKNOWN")).upper(), Severity.INFO)
                cause = mis.get("CauseMetadata",{})
                findings.append(NormalizedFinding(rule_id=mis.get("ID","trivy-misconfig"), title=mis.get("Title","Misconfiguration"),
                    description=mis.get("Description",""), category=FindingCategory.MISCONFIG, severity=sev,
                    scanner=self.name, file_path=target, line_start=cause.get("StartLine"), line_end=cause.get("EndLine"), raw=mis))
        return findings
