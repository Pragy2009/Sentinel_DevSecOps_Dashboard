from __future__ import annotations
import json
import httpx
from app.ai.providers.base import AIProvider, RemediationRequest, RemediationResult
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("sentinel.ai.openrouter")
_SYSTEM = ('You are a principal appsec engineer. Respond ONLY with JSON: '
           '{"explanation":str,"impact":str,"exploitability":float 0-10,"patch_diff":str}. No markdown.')

class OpenRouterProvider(AIProvider):
    name = "openrouter"
    def __init__(self):
        if not settings.OPENROUTER_API_KEY: raise ValueError("OPENROUTER_API_KEY required")
        self._client = httpx.AsyncClient(base_url=settings.OPENROUTER_BASE_URL,
            headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}", "Content-Type": "application/json"}, timeout=60.0)

    async def remediate(self, req: RemediationRequest) -> RemediationResult:
        prompt = f"Title: {req.title}\nScanner: {req.scanner}\nSeverity: {req.severity}\nCWE: {req.cwe}\nCVE: {req.cve}\nFile: {req.file_path}\nDesc: {req.description}\nCode:\n{req.code_snippet or '(none)'}"
        try:
            resp = await self._client.post("/chat/completions", json={"model": settings.OPENROUTER_MODEL,
                "messages": [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": prompt}],
                "temperature": 0.2, "response_format": {"type": "json_object"}})
            resp.raise_for_status()
            data = json.loads(resp.json()["choices"][0]["message"]["content"].replace("```json","").replace("```","").strip())
            return RemediationResult(explanation=str(data.get("explanation","")), impact=str(data.get("impact","")),
                exploitability=float(data.get("exploitability", 5.0)), patch_diff=str(data.get("patch_diff","")))
        except Exception as exc:
            logger.error(f"OpenRouter failed: {exc}")
            return RemediationResult(explanation="AI unavailable", impact="Manual triage required", exploitability=5.0, patch_diff="")

    async def aclose(self) -> None:
        """C4: close the shared httpx client (fixes socket leak)."""
        try:
            await self._client.aclose()
        except Exception:
            pass
