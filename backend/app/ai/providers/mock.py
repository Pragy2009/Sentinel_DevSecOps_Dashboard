from __future__ import annotations
from app.ai.providers.base import AIProvider, RemediationRequest, RemediationResult

_EXPLOIT = {"critical": 9.5, "high": 7.8, "medium": 5.3, "low": 3.1, "info": 1.0}

class MockAIProvider(AIProvider):
    name = "mock"
    async def remediate(self, req: RemediationRequest) -> RemediationResult:
        exploit = _EXPLOIT.get(req.severity.lower(), 5.0)
        fp = req.file_path or "app/affected.py"
        snippet = (req.code_snippet or "vulnerable_call(user_input)").strip().splitlines()[:1]
        original = snippet[0] if snippet else "vulnerable_call(user_input)"
        if req.scanner == "gitleaks":
            patch = f"--- a/{fp}\n+++ b/{fp}\n@@\n-API_KEY = \"sk-live-HARDCODED\"\n+import os\n+API_KEY = os.environ[\"API_KEY\"]\n"
        else:
            patch = f"--- a/{fp}\n+++ b/{fp}\n@@\n-{original}\n+safe_call(validate_and_escape(user_input))\n"
        return RemediationResult(
            explanation=f"The {req.scanner} scanner found '{req.title}'. This ({req.cwe or req.cve or 'CWE-unknown'}) allows attackers to exploit unvalidated input reaching a sensitive sink.",
            impact="Potential RCE, data exfiltration, or credential compromise. Violates OWASP Top 10 and SOC2 controls.",
            exploitability=exploit, patch_diff=patch)
