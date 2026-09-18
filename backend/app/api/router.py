from fastapi import APIRouter
from app.api.routes import auth, dashboard, github, repositories, reports, scans, stream

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(github.router)
api_router.include_router(repositories.router)
api_router.include_router(scans.router)
api_router.include_router(reports.router)
api_router.include_router(dashboard.router)
api_router.include_router(stream.router)
