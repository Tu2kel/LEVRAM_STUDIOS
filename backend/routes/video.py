"""
Video assembly routes.

Lane 1 — ffmpeg (static image + voice audio → .mp4 per shot, then concat episode)
Lane 2 — Wan2.1 T2V via ComfyUI (text prompt → animated .mp4 clip)
"""
import asyncio
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router   = APIRouter()
BASE_DIR = Path(".")
VID_DIR  = Path("output/videos")
VID_DIR.mkdir(parents=True, exist_ok=True)


# ─── Helpers ─────────────────────────────────────────────────

def _resolve_path(url_or_path: str) -> Path:
    """Turn a /output/... URL or relative path into an absolute Path."""
    p = url_or_path.lstrip("/")          # strip leading slash
    return BASE_DIR / p


def _ffmpeg_image_audio(image_path: Path, audio_path: Path, out_path: Path) -> None:
    """Combine a still image + audio into an MP4. Audio length sets duration."""
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "25", "-i", str(image_path),
        "-i", str(audio_path),
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:-1:-1:color=black,setsar=1",
        "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg error:\n{result.stderr}")


def _ffmpeg_concat(clip_paths: list[Path], out_path: Path) -> None:
    """Concatenate MP4 clips into one episode file using a concat list."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for p in clip_paths:
            f.write(f"file '{p.resolve()}'\n")
        concat_file = f.name

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", concat_file,
        "-c", "copy",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat error:\n{result.stderr}")


def _load_queue():
    import json
    qf = Path("data/render_queue.json")
    if not qf.exists():
        return {"queue": []}
    return json.loads(qf.read_text())


def _save_queue(data):
    import json
    Path("data/render_queue.json").write_text(json.dumps(data, indent=2))


# ─── Lane 1: Assemble one shot (image + voice → clip) ────────

class AssembleShotPayload(BaseModel):
    item_id: str           # render queue item id
    image_url: str = ""    # override; if blank, uses item's renderOutputUrl
    audio_url: str = ""    # override; if blank, uses item's voicePath


@router.post("/video/assemble-shot")
def assemble_shot(payload: AssembleShotPayload):
    data  = _load_queue()
    queue = data.get("queue", [])
    item  = next((i for i in queue if i["id"] == payload.item_id), None)

    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")

    image_url = payload.image_url or item.get("renderOutputUrl") or item.get("renderOutputPath") or ""
    audio_url = payload.audio_url or item.get("voicePath") or item.get("fxUrl") or ""

    if not image_url:
        raise HTTPException(status_code=400, detail="No keyframe image for this shot. Generate a keyframe first.")
    if not audio_url:
        raise HTTPException(status_code=400, detail="No voice audio for this shot. Generate voice first.")

    image_path = _resolve_path(image_url)
    audio_path = _resolve_path(audio_url)

    if not image_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {image_path}")
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio not found: {audio_path}")

    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"shot_{item['id'][:8]}_{ts}.mp4"
    out_path = VID_DIR / out_name

    try:
        _ffmpeg_image_audio(image_path, audio_path, out_path)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Persist clip URL in the queue item
    item["clipUrl"]     = "/output/videos/" + out_name
    item["clipPath"]    = str(out_path)
    item["updatedAt"]   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _save_queue(data)

    return {
        "success":  True,
        "clipUrl":  "/output/videos/" + out_name,
        "item":     item,
    }


# ─── Lane 1: Assemble full episode (all ready clips → one file) ─

class AssembleEpisodePayload(BaseModel):
    item_ids: list[str] = []   # ordered list; if empty, uses all items with a clipUrl
    title: str = "episode"


@router.post("/video/assemble-episode")
def assemble_episode(payload: AssembleEpisodePayload):
    data  = _load_queue()
    queue = data.get("queue", [])

    if payload.item_ids:
        ordered = [i for iid in payload.item_ids for i in queue if i["id"] == iid]
    else:
        ordered = [i for i in reversed(queue) if i.get("clipUrl")]

    clips = [_resolve_path(i["clipUrl"]) for i in ordered if i.get("clipUrl")]
    clips = [c for c in clips if c.exists()]

    if not clips:
        raise HTTPException(status_code=400, detail="No rendered clips found. Assemble each shot first.")

    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"{payload.title.replace(' ', '_')}_{ts}.mp4"
    out_path = VID_DIR / out_name

    try:
        _ffmpeg_concat(clips, out_path)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "success":    True,
        "episodeUrl": "/output/videos/" + out_name,
        "clips":      len(clips),
    }


# ─── Lane 2a: fal.ai T2V (lead — cloud GPU) ──────────────────

FAL_VIDEO_MODELS = {
    "wan21":       "fal-ai/wan/v2.1/1.3b/text-to-video",   # fast, good quality
    "wan21_14b":   "fal-ai/wan/v2.1/14b/text-to-video",    # highest quality, slower
    "kling15":     "fal-ai/kling-video/v1.5/pro/text-to-video",
    "kling2":      "fal-ai/kling-video/v2/master/text-to-video",
    "hunyuan":     "fal-ai/hunyuan-video",
}

FAL_VIDEO_SIZES = {
    "widescreen": "1280x720",
    "cinematic":  "1280x544",
    "portrait":   "720x1280",
    "square":     "720x720",
}


def _fal_video(prompt: str, model_key: str, aspect: str, duration: int) -> dict:
    import os, urllib.request
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed — pip install fal-client")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set. Add it to Railway Variables.")
    os.environ["FAL_KEY"] = api_key

    model_id = FAL_VIDEO_MODELS.get(model_key, FAL_VIDEO_MODELS["wan21"])
    resolution = FAL_VIDEO_SIZES.get(aspect, "1280x720")

    result = fal_client.run(
        model_id,
        arguments={
            "prompt": prompt,
            "resolution": resolution,
            "duration": duration,
            "num_inference_steps": 30,
        },
    )
    video_url = result.get("video", {}).get("url") or result.get("video_url") or ""
    if not video_url:
        raise RuntimeError(f"fal.ai returned no video URL. Raw: {result}")

    VID_DIR.mkdir(parents=True, exist_ok=True)
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    rid      = __import__("uuid").uuid4().hex[:8]
    filename = f"fal_{model_key}_{ts}_{rid}.mp4"
    out_path = VID_DIR / filename

    req = urllib.request.Request(video_url, headers={"User-Agent": "LEVRAM/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        out_path.write_bytes(r.read())

    return {
        "videoUrl": "/output/videos/" + filename,
        "prompt":   prompt,
        "model":    model_id,
        "engine":   "fal",
    }


class FalVideoPayload(BaseModel):
    prompt: str
    model: str = "wan21"          # wan21 | wan21_14b | kling15 | kling2 | hunyuan
    aspect: str = "widescreen"   # widescreen | portrait | square | cinematic
    duration: int = 5             # seconds (model-dependent)


@router.post("/video/generate-fal")
async def generate_fal_video(payload: FalVideoPayload):
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: _fal_video(payload.prompt, payload.model, payload.aspect, payload.duration),
        )
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/fal-models")
def list_fal_video_models():
    return {
        "success": True,
        "default": "wan21",
        "models": [
            {"id": "wan21",     "label": "Wan 2.1 (1.3B)",     "speed": "fast",   "note": "Best speed/quality"},
            {"id": "wan21_14b", "label": "Wan 2.1 (14B)",      "speed": "slow",   "note": "Highest quality"},
            {"id": "kling15",   "label": "Kling 1.5 Pro",      "speed": "medium", "note": "Cinematic motion"},
            {"id": "kling2",    "label": "Kling 2 Master",     "speed": "slow",   "note": "State of the art"},
            {"id": "hunyuan",   "label": "HunyuanVideo",       "speed": "medium", "note": "Strong consistency"},
        ],
    }


# ─── Lane 2b: Wan2.1 via local ComfyUI (fallback) ────────────

class WanVideoPayload(BaseModel):
    prompt: str
    character: str = ""
    aspect: str = "widescreen"
    steps: int = 25
    cfg: float = 6.0
    seed: int | None = None


@router.post("/video/generate-wan")
async def generate_wan_video(payload: WanVideoPayload):
    from backend.services.wan_service import generate_wan_t2v
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: generate_wan_t2v(
                prompt=payload.prompt,
                character=payload.character,
                aspect=payload.aspect,
                steps=payload.steps,
                cfg=payload.cfg,
                seed=payload.seed,
            )
        )
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── List generated videos ───────────────────────────────────

@router.get("/video/library")
def get_video_library():
    VID_DIR.mkdir(parents=True, exist_ok=True)
    videos = sorted(VID_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {
        "success": True,
        "videos": [
            {
                "url":     "/output/videos/" + v.name,
                "name":    v.name,
                "created": datetime.fromtimestamp(v.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
                "size_mb": round(v.stat().st_size / 1_048_576, 1),
            }
            for v in videos[:30]
        ],
    }
