from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from app.models import FindingCategory, FindingState, ScanStatus, Severity

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    full_name: Optional[str]
    github_username: Optional[str]
    avatar_url: Optional[str] = None
    github_linked: bool = False
    created_at: datetime

class RepositoryCreate(BaseModel):
    name: str
    full_name: str
    clone_url: str
    default_branch: str = "main"
    is_private: bool = False

class RepositoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    full_name: str
    clone_url: str
    default_branch: str
    is_private: bool
    language: Optional[str] = None
    description: Optional[str] = None
    health_score: float
    created_at: datetime

class ScanCreate(BaseModel):
    repository_id: Optional[uuid.UUID] = None
    clone_url: Optional[str] = None
    branch: str = "main"

class ScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    repository_id: uuid.UUID
    branch: str
    commit_sha: Optional[str]
    status: ScanStatus
    progress: int
    scanners_run: Optional[dict]
    error_message: Optional[str]
    total_findings: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    info_count: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    rule_id: str
    title: str
    description: str
    category: FindingCategory
    severity: Severity
    scanner: str
    cwe: Optional[str]
    cve: Optional[str]
    cvss_score: Optional[float]
    file_path: Optional[str]
    line_start: Optional[int]
    line_end: Optional[int]
    code_snippet: Optional[str]
    state: FindingState
    ai_explanation: Optional[str]
    ai_impact: Optional[str]
    ai_exploitability: Optional[float]
    ai_patch_diff: Optional[str]
    created_at: datetime

class ScanDetail(ScanOut):
    findings: list[FindingOut] = []

class ScanCreateResponse(BaseModel):
    scan_id: uuid.UUID
    status: ScanStatus
    message: str

class ScanDiff(BaseModel):
    base_scan_id: uuid.UUID
    head_scan_id: uuid.UUID
    new_findings: list[FindingOut]
    resolved_findings: list[FindingOut]
    persisting_findings: list[FindingOut]
