from __future__ import annotations
from functools import lru_cache
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    APP_NAME: str = "Sentinel DevSecOps Platform"
    APP_ENV: Literal["dev","staging","production"] = "dev"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = True
    SECRET_KEY: str = Field(default="change-me-in-production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"
    DATABASE_URL: str = "postgresql+asyncpg://sentinel:sentinel_secret@postgres:5432/sentinel_db"
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_CALLBACK_URL: str = "http://localhost:8000/api/v1/github/callback"
    WORKSPACE_ROOT: str = "/tmp/sentinel-workspaces"
    CLONE_TIMEOUT_SECONDS: int = 120
    SCANNER_TIMEOUT_SECONDS: int = 600
    MAX_REPO_SIZE_MB: int = 500
    # C3: SSRF allowlist — only these git hosts may be cloned.
    ALLOWED_GIT_HOSTS: str = "github.com,gitlab.com"
    ENABLED_SCANNERS: str = "semgrep,bandit,trivy,gitleaks"
    AI_PROVIDER: Literal["mock","openrouter"] = "mock"
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MODEL: str = "deepseek/deepseek-chat"
    AI_MAX_FINDINGS_PER_SCAN: int = 25
    RATE_LIMIT_PER_MINUTE: int = 60
    # C5: stricter throttle for auth endpoints (login/register/refresh/OAuth).
    AUTH_RATE_LIMIT_PER_MINUTE: int = 10

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def enabled_scanners_list(self) -> list[str]:
        return [s.strip() for s in self.ENABLED_SCANNERS.split(",") if s.strip()]

    @property
    def allowed_git_hosts_list(self) -> list[str]:
        # C3: lowercase host allowlist for clone-URL validation.
        return [h.strip().lower() for h in self.ALLOWED_GIT_HOSTS.split(",") if h.strip()]

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
