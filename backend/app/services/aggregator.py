from __future__ import annotations
from dataclasses import dataclass
from app.models import Severity
from app.scanners.base import NormalizedFinding
_WEIGHTS = {Severity.CRITICAL: 25.0, Severity.HIGH: 10.0, Severity.MEDIUM: 4.0, Severity.LOW: 1.0, Severity.INFO: 0.2}
_RANK = {Severity.CRITICAL:5, Severity.HIGH:4, Severity.MEDIUM:3, Severity.LOW:2, Severity.INFO:1}
@dataclass
class Aggregation:
    findings: list[NormalizedFinding]; counts: dict[str,int]; total: int; health_score: float
def aggregate(all_findings: list[NormalizedFinding]) -> Aggregation:
    seen: dict[str, NormalizedFinding] = {}
    for f in all_findings:
        fp = f.fingerprint()
        if fp not in seen or _RANK[f.severity] > _RANK[seen[fp].severity]: seen[fp] = f
    deduped = list(seen.values())
    counts = {s.value: 0 for s in Severity}
    penalty = 0.0
    for f in deduped: counts[f.severity.value] += 1; penalty += _WEIGHTS[f.severity]
    return Aggregation(findings=deduped, counts=counts, total=len(deduped), health_score=max(0.0, round(100.0 - penalty, 1)))
