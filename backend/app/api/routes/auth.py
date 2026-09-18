from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import deny_token, get_current_user, is_token_denied, rate_limit_auth
from app.core.security import create_access_token, create_refresh_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas import RefreshRequest, TokenPair, UserLogin, UserOut, UserRegister

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/register", response_model=TokenPair, status_code=201, dependencies=[Depends(rate_limit_auth)])
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db)) -> TokenPair:
    if (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(email=payload.email, hashed_password=hash_password(payload.password), full_name=payload.full_name)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    await db.commit()  # C1: explicit commit (get_db no longer auto-commits)
    return TokenPair(access_token=create_access_token(str(user.id)), refresh_token=create_refresh_token(str(user.id)))

@router.post("/login", response_model=TokenPair, dependencies=[Depends(rate_limit_auth)])
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)) -> TokenPair:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenPair(access_token=create_access_token(str(user.id)), refresh_token=create_refresh_token(str(user.id)))

@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(rate_limit_auth)])
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    decoded = decode_token(payload.refresh_token)
    if not decoded or decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    # C5: logout denylist — revoked jti cannot be reused.
    if await is_token_denied(decoded.get("jti")):
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    result = await db.execute(select(User).where(User.id == decoded.get("sub")))
    user = result.scalar_one_or_none()
    if not user or not user.is_active: raise HTTPException(status_code=401, detail="User no longer valid")
    return TokenPair(access_token=create_access_token(str(user.id)), refresh_token=create_refresh_token(str(user.id)))


@router.post("/logout", status_code=200, dependencies=[Depends(rate_limit_auth)])
async def logout(payload: RefreshRequest) -> dict:
    """C5: server-side logout — denylist the refresh token's jti in Redis
    until its natural expiry. Access tokens are short-lived (30 min)."""
    from app.core.config import settings
    decoded = decode_token(payload.refresh_token)
    if not decoded or decoded.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    jti = decoded.get("jti")
    exp = decoded.get("exp")
    if jti and exp:
        from datetime import datetime, timezone
        try:
            ttl = int(exp - datetime.now(timezone.utc).timestamp())
        except (TypeError, ValueError):
            ttl = 0
        if ttl > 0:
            await deny_token(jti, min(ttl, settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400))
    return {"message": "Logged out"}

@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=current_user.id, email=current_user.email, full_name=current_user.full_name,
        github_username=current_user.github_username, avatar_url=current_user.avatar_url,
        github_linked=bool(current_user.github_access_token), created_at=current_user.created_at)
