from __future__ import annotations
import abc
from dataclasses import dataclass

@dataclass
class RemediationRequest:
    title: str; description: str; severity: str; scanner: str
    file_path: str | None; code_snippet: str | None; cwe: str | None; cve: str | None

@dataclass
class RemediationResult:
    explanation: str; impact: str; exploitability: float; patch_diff: str

class AIProvider(abc.ABC):
    name: str = "base"
    @abc.abstractmethod
    async def remediate(self, req: RemediationRequest) -> RemediationResult: raise NotImplementedError

    async def aclose(self) -> None:
        """C4: release pooled connections. Default no-op for stateless providers."""
        return None
