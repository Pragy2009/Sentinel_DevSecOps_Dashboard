from __future__ import annotations
import asyncio
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from app.core.security import decode_token
from app.db.session import AsyncSessionFactory
from app.models import Scan
from app.services.pubsub import get_buffered_events, subscribe_events

router = APIRouter(prefix="/stream", tags=["stream"])
TERMINAL = {"completed", "failed"}


async def _authorize_scan(scan_id: str, token: str | None) -> bool:
    if not token:
        return False
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return False
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
        scan_uuid = uuid.UUID(scan_id)
    except (ValueError, TypeError, AttributeError):
        return False
    async with AsyncSessionFactory() as db:
        res = await db.execute(
            select(Scan.id).where(Scan.id == scan_uuid, Scan.user_id == user_id)
        )
        return res.scalar_one_or_none() is not None


@router.websocket("/scans/{scan_id}")
async def scan_stream(websocket: WebSocket, scan_id: str) -> None:
    try:
        scan_uuid = uuid.UUID(scan_id)
    except (ValueError, TypeError):
        await websocket.close(code=4404)
        return
    token = websocket.query_params.get("token")
    if not await _authorize_scan(str(scan_uuid), token):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        for event in await get_buffered_events(scan_id):
            await websocket.send_json(event)
            if event.get("status") in TERMINAL:
                await websocket.close(code=1000)
                return
        async for event in subscribe_events(scan_id):
            await websocket.send_json(event)
            if event.get("status") in TERMINAL:
                await asyncio.sleep(0.3)
                await websocket.close(code=1000)
                return
    except WebSocketDisconnect:
        pass
    except Exception:
        try: await websocket.close(code=1011)
        except Exception: pass
