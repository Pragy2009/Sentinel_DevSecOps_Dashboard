from __future__ import annotations
import uuid
import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models import User

bearer_scheme = HTTPBearer(auto_error=False)
_rl_client = None

def _rl() -> aioredis.Redis:
    global _rl_client
    if _rl_client is None:
        _rl_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _rl_client

async def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
                           db: AsyncSession = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    payload = decode_token(creds.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try: user_id = uuid.UUID(payload.get("sub"))
    except (ValueError, TypeError): raise HTTPException(status_code=401, detail="Invalid token subject")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user

async def rate_limit(request: Request) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"sentinel:rl:{client_ip}:{request.url.path}"
    r = _rl()
    count = await r.incr(key)
    if count == 1: await r.expire(key, 60)
    if count > settings.RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")


async def rate_limit_auth(request: Request) -> None:
    """C5: stricter per-IP throttle for auth/OAuth endpoints (credential
    stuffing guard). Reuses the same Redis client — no new infra."""
    client_ip = request.client.host if request.client else "unknown"
    key = f"sentinel:rl:auth:{client_ip}:{request.url.path}"
    r = _rl()
    count = await r.incr(key)
    if count == 1: await r.expire(key, 60)
    if count > settings.AUTH_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many attempts, try again shortly")


# ── C5: refresh-token denylist (logout) ──────────────────────────────────

def _denylist_key(jti: str) -> str:
    return f"sentinel:denylist:{jti}"


async def deny_token(jti: str, ttl_seconds: int) -> None:
    if not jti or ttl_seconds <= 0:
        return
    r = _rl()
    await r.set(_denylist_key(jti), "1", ex=ttl_seconds)


async def is_token_denied(jti: str | None) -> bool:
    if not jti:
        return False
    return await _rl().exists(_denylist_key(jti)) == 1
