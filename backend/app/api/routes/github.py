from __future__ import annotations
import secrets
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user, rate_limit_auth
from app.core.config import settings
from app.core.crypto import decrypt_token, encrypt_token
from app.core.security import create_access_token, create_refresh_token
from app.db.session import get_db
from app.models import Repository, User
from app.schemas import RepositoryOut, TokenPair
from app.services.github_service import GitHubError, build_authorize_url, exchange_code_for_token, fetch_branches, fetch_github_user, list_user_repos

router = APIRouter(prefix="/github", tags=["github"])
_state_client = None

def _redis() -> aioredis.Redis:
    global _state_client
    if _state_client is None:
        _state_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _state_client

@router.get("/login", dependencies=[Depends(rate_limit_auth)])
async def github_login() -> dict:
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(status_code=503, detail="GitHub OAuth not configured")
    state = secrets.token_urlsafe(32)
    await _redis().set(f"sentinel:oauth:state:{state}", "pending", ex=600)
    return {"authorize_url": build_authorize_url(state), "state": state}

@router.get("/callback", dependencies=[Depends(rate_limit_auth)])
async def github_callback(code: str = Query(...), state: str = Query(...),
                          db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    stored = await _redis().get(f"sentinel:oauth:state:{state}")
    if stored is None: raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    await _redis().delete(f"sentinel:oauth:state:{state}")
    try:
        gh_token = await exchange_code_for_token(code)
        profile = await fetch_github_user(gh_token)
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    result = await db.execute(select(User).where(User.github_id == profile["github_id"]))
    user = result.scalar_one_or_none()
    if user is None:
        result = await db.execute(select(User).where(User.email == profile["email"]))
        user = result.scalar_one_or_none()
    encrypted = encrypt_token(gh_token)
    if user is None:
        user = User(email=profile["email"], full_name=profile["full_name"],
            github_id=profile["github_id"], github_username=profile["github_username"],
            github_access_token=encrypted, avatar_url=profile.get("avatar_url"))
        db.add(user)
        await db.flush()
    else:
        user.github_id = profile["github_id"]; user.github_username = profile["github_username"]
        user.github_access_token = encrypted; user.avatar_url = profile.get("avatar_url")
        if not user.full_name: user.full_name = profile["full_name"]
    await db.flush()
    await db.refresh(user)
    await db.commit()  # C1: explicit commit (get_db no longer auto-commits)
    access = create_access_token(str(user.id))
    refresh = create_refresh_token(str(user.id))
    frontend = settings.cors_origins_list[0] if settings.cors_origins_list else "http://localhost:3000"
    return RedirectResponse(url=f"{frontend}/auth/callback#access_token={access}&refresh_token={refresh}")

@router.get("/repos")
async def github_repos(current_user: User = Depends(get_current_user)) -> list[dict]:
    token = decrypt_token(current_user.github_access_token)
    if not token: raise HTTPException(status_code=403, detail="GitHub account not linked")
    try: return await list_user_repos(token)
    except GitHubError as exc: raise HTTPException(status_code=502, detail=str(exc))

@router.post("/sync", response_model=list[RepositoryOut])
async def github_sync(current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> list[Repository]:
    token = decrypt_token(current_user.github_access_token)
    if not token: raise HTTPException(status_code=403, detail="GitHub account not linked")
    try: gh_repos = await list_user_repos(token)
    except GitHubError as exc: raise HTTPException(status_code=502, detail=str(exc))
    existing_res = await db.execute(select(Repository).where(Repository.owner_id == current_user.id))
    existing = {r.full_name: r for r in existing_res.scalars().all()}
    ingested = []
    for gr in gh_repos:
        if gr["full_name"] in existing:
            repo = existing[gr["full_name"]]
            repo.clone_url = gr["clone_url"]; repo.default_branch = gr["default_branch"]
            repo.is_private = gr["is_private"]; repo.language = gr.get("language")
            repo.description = gr.get("description")
        else:
            repo = Repository(owner_id=current_user.id, name=gr["name"], full_name=gr["full_name"],
                clone_url=gr["clone_url"], default_branch=gr["default_branch"],
                is_private=gr["is_private"], language=gr.get("language"), description=gr.get("description"))
            db.add(repo)
        ingested.append(repo)
    await db.flush()
    for r in ingested: await db.refresh(r)
    await db.commit()  # C1: explicit commit (get_db no longer auto-commits)
    return ingested

@router.get("/repos/{owner}/{repo}/branches")
async def github_branches(owner: str, repo: str,
                          current_user: User = Depends(get_current_user)) -> list[str]:
    token = decrypt_token(current_user.github_access_token)
    if not token: raise HTTPException(status_code=403, detail="GitHub account not linked")
    try: return await fetch_branches(token, f"{owner}/{repo}")
    except GitHubError as exc: raise HTTPException(status_code=502, detail=str(exc))
