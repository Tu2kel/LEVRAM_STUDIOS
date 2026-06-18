"""Settings + startup status endpoint."""
import os
import asyncio
import httpx
from fastapi import APIRouter
from backend.db import ping_db, MONGODB_URL

router = APIRouter()


async def _ping(url: str, timeout: float = 3.0) -> bool:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url)
            return r.status_code < 500
    except Exception:
        return False


@router.get("/settings/status")
async def get_settings_status():
    comfy_url = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
    mongo_ok, comfy_ok = await asyncio.gather(
        ping_db(),
        _ping(f"{comfy_url}/system_stats"),
    )
    return {
        "backend":         True,
        "openai":          bool(os.environ.get("OPENAI_API_KEY")),
        "elevenlabs":      bool(os.environ.get("ELEVENLABS_API_KEY")),
        "wavespeed":       bool((os.environ.get("WAVESPEED_KEY") or "").strip()),
        "fal":             bool(os.environ.get("FAL_KEY")),
        "rvc_model":       bool(os.environ.get("RVC_MODEL_PATH")),
        "mongodb":         mongo_ok,
        "mongodb_url":     "configured" if MONGODB_URL else "not configured",
        "comfy_url":       comfy_url,
        "comfy_connected": comfy_ok,
    }
