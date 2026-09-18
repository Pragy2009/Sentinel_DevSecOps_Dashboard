from __future__ import annotations
import time, uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.db.session import init_db
from app.services.pubsub import close_async

configure_logging("DEBUG" if settings.DEBUG else "INFO")
logger = get_logger("sentinel.main")

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info("Starting Sentinel API")
    # C5: fail fast on default secret in production — argon2/fernet/JWT all
    # derive from SECRET_KEY; shipping the default is a full compromise.
    if settings.APP_ENV == "production" and settings.SECRET_KEY == "change-me-in-production":
        raise RuntimeError("SECRET_KEY must be set in production (refusing to start with default)")
    await init_db()
    yield
    await close_async()
    logger.info("Sentinel API shutdown")

app = FastAPI(title=settings.APP_NAME, version="1.0.0", docs_url="/docs", redoc_url="/redoc", lifespan=lifespan)

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.middleware("http")
async def trace_middleware(request: Request, call_next):
    trace_id = str(uuid.uuid4())[:8]
    start = time.monotonic()
    response = await call_next(request)
    duration = round((time.monotonic() - start) * 1000, 1)
    response.headers["X-Trace-Id"] = trace_id
    response.headers["X-Response-Time-ms"] = str(duration)
    return response

@app.get("/health", tags=["health"])
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "sentinel-api",
        "ai_provider": settings.AI_PROVIDER, "enabled_scanners": settings.enabled_scanners_list})

app.include_router(api_router, prefix=settings.API_V1_PREFIX)
