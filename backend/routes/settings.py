"""Settings status endpoint — reads env var presence, pings ComfyUI."""
import os
import urllib.request
from fastapi import APIRouter

router = APIRouter()


def _ping(url: str, timeout: int = 3) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            r.read()
        return True
    except Exception:
        return False


@router.get("/settings/status")
def get_settings_status():
    comfy_url = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
    return {
        "openai":          bool(os.environ.get("OPENAI_API_KEY")),
        "elevenlabs":      bool(os.environ.get("ELEVENLABS_API_KEY")),
        "fal":             bool(os.environ.get("FAL_KEY")),
        "rvc_model":       bool(os.environ.get("RVC_MODEL_PATH")),
        "comfy_url":       comfy_url,
        "comfy_connected": _ping(f"{comfy_url}/system_stats"),
        "backend":         True,
    }
