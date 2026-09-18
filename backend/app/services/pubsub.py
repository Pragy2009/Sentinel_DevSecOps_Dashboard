from __future__ import annotations
import json
from typing import Any, AsyncIterator
import redis, redis.asyncio as aioredis
from app.core.config import settings

_sync_client = None
_async_client = None

def channel(scan_id: str) -> str: return f"sentinel:scan:{scan_id}:events"
def log_key(scan_id: str) -> str: return f"sentinel:scan:{scan_id}:log"

def _sync() -> redis.Redis:
    global _sync_client
    if _sync_client is None:
        _sync_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _sync_client

def publish_event(scan_id: str, event: dict[str, Any]) -> None:
    r = _sync()
    raw = json.dumps(event)
    r.rpush(log_key(scan_id), raw)
    r.expire(log_key(scan_id), 86400)
    r.publish(channel(scan_id), raw)

async def _async() -> aioredis.Redis:
    global _async_client
    if _async_client is None:
        _async_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _async_client

async def get_buffered_events(scan_id: str) -> list[dict]:
    r = await _async()
    return [json.loads(i) for i in await r.lrange(log_key(scan_id), 0, -1)]

async def subscribe_events(scan_id: str) -> AsyncIterator[dict]:
    r = await _async()
    pubsub = r.pubsub()
    await pubsub.subscribe(channel(scan_id))
    try:
        async for msg in pubsub.listen():
            if msg["type"] == "message":
                try: yield json.loads(msg["data"])
                except json.JSONDecodeError: continue
    finally:
        await pubsub.unsubscribe(channel(scan_id))
        await pubsub.aclose()

async def close_async() -> None:
    global _async_client
    if _async_client:
        await _async_client.aclose()
        _async_client = None
