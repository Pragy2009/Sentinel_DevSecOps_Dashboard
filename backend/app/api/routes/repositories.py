from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Repository, User
from app.schemas import RepositoryCreate, RepositoryOut

router = APIRouter(prefix="/repositories", tags=["repositories"])

@router.post("", response_model=RepositoryOut, status_code=201)
async def create_repository(payload: RepositoryCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # C3: same SSRF/branch guard as POST /scans — repos can be scanned by id.
    from app.services.git_service import GitCloneError, validate_branch, validate_clone_url
    try:
        validate_clone_url(payload.clone_url)
        validate_branch(payload.default_branch)
    except GitCloneError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    repo = Repository(owner_id=current_user.id, **payload.model_dump())
    db.add(repo)
    await db.flush()
    await db.refresh(repo)
    await db.commit()  # C1: explicit commit (get_db no longer auto-commits)
    return repo

@router.get("", response_model=list[RepositoryOut])
async def list_repositories(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Repository).where(Repository.owner_id == current_user.id).order_by(Repository.created_at.desc()))
    return list(res.scalars().all())

@router.delete("/{repo_id}", status_code=204)
async def delete_repository(repo_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Repository).where(Repository.id == repo_id, Repository.owner_id == current_user.id))
    repo = res.scalar_one_or_none()
    if not repo: raise HTTPException(status_code=404, detail="Repository not found")
    await db.delete(repo)
    await db.commit()  # C1: explicit commit
    return None
