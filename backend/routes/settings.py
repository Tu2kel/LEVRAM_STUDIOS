"""Settings + startup status endpoint."""
import os
import urllib.request
from fastapi import APIRouter
from backend.db import ping_db, MONGODB_URL

router = APIRouter()


def _ping(url: str, timeout: int = 3) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            r.read()
        return True
    except Exception:
        return False


@router.get("/settings/status")
async def get_settings_status():
    comfy_url = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
    mongo_ok = await ping_db()
    return {
        "backend":         True,
        "openai":          bool(os.environ.get("OPENAI_API_KEY")),
        "elevenlabs":      bool(os.environ.get("ELEVENLABS_API_KEY")),
        "wavespeed":       bool((os.environ.get("WAVESPEED_KEY") or "").strip()),
        "wavespeed_len":   len((os.environ.get("WAVESPEED_KEY") or "").strip()),
        "fal":             bool(os.environ.get("FAL_KEY")),
        "fal_active":      False,  # fal.ai inactive — WaveSpeed is primary provider
        "rvc_model":       bool(os.environ.get("RVC_MODEL_PATH")),
        "mongodb":         mongo_ok,
        "mongodb_url":     "configured" if MONGODB_URL else "not configured",
        "comfy_url":       comfy_url,
        "comfy_connected": _ping(f"{comfy_url}/system_stats"),
    }
