from app.scanners.bandit import BanditScanner
from app.scanners.base import BaseScanner
from app.scanners.gitleaks import GitleaksScanner
from app.scanners.semgrep import SemgrepScanner
from app.scanners.trivy import TrivyScanner
_REGISTRY: dict[str, BaseScanner] = {"semgrep": SemgrepScanner(), "bandit": BanditScanner(), "trivy": TrivyScanner(), "gitleaks": GitleaksScanner()}
def get_scanner(name: str) -> BaseScanner | None: return _REGISTRY.get(name)
def all_scanner_names() -> list[str]: return list(_REGISTRY.keys())
