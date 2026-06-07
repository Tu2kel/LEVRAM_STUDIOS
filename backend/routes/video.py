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

from fastapi import APIRouter, HTTPException, UploadFile, File
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

# Text-to-Video models (open-source only — no competitor IP)
FAL_T2V_MODELS = {
    "wan21":     "fal-ai/wan/v2.1/1.3b/text-to-video",  # fast, open-source
    "wan21_14b": "fal-ai/wan/v2.1/14b/text-to-video",   # highest quality
    "hunyuan":   "fal-ai/hunyuan-video",                 # strong consistency
    "cogvideox": "fal-ai/cogvideox-5b",                  # open-source, good motion
}

# Image-to-Video models — lock the character's face via a keyframe
FAL_I2V_MODELS = {
    "wan21_i2v":     "fal-ai/wan/v2.1/1.3b/image-to-video",  # fast
    "wan21_14b_i2v": "fal-ai/wan/v2.1/14b/image-to-video",   # best quality
    "hunyuan_i2v":   "fal-ai/hunyuan-video/image-to-video",
}

FAL_VIDEO_MODELS = {**FAL_T2V_MODELS, **FAL_I2V_MODELS}  # keep for backward compat

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

    # ── Short-term persistence: try local download; fall back to fal.ai CDN URL
    # fal.ai CDN URLs stay live for ~7 days — enough to survive Railway redeploys
    # without a Volume. If download fails, remoteUrl is served directly instead.
    local_url = None
    try:
        req = urllib.request.Request(video_url, headers={"User-Agent": "LEVRAM/1.0"})
        with urllib.request.urlopen(req, timeout=180) as r:
            out_path.write_bytes(r.read())
        local_url = "/output/videos/" + filename
    except Exception as dl_err:
        print(f"[LEVRAM] Local download failed ({dl_err}); using fal.ai CDN URL as outputUrl")

    # ── Long-term persistence (uncomment when ready to wire up cloud storage) ──
    # import boto3, io
    # s3 = boto3.client(
    #     "s3",
    #     endpoint_url=os.getenv("R2_ENDPOINT"),       # Cloudflare R2: https://<account>.r2.cloudflarestorage.com
    #     aws_access_key_id=os.getenv("R2_ACCESS_KEY"),
    #     aws_secret_access_key=os.getenv("R2_SECRET_KEY"),
    # )
    # bucket  = os.getenv("R2_BUCKET", "levram-output")
    # key     = f"videos/{filename}"
    # req2    = urllib.request.Request(video_url, headers={"User-Agent": "LEVRAM/1.0"})
    # with urllib.request.urlopen(req2, timeout=180) as r:
    #     s3.upload_fileobj(io.BytesIO(r.read()), bucket, key, ExtraArgs={"ContentType": "video/mp4"})
    # local_url = f"https://pub-<hash>.r2.dev/{key}"   # or your custom domain
    # ── To enable: pip install boto3, add R2_ENDPOINT/R2_ACCESS_KEY/R2_SECRET_KEY to Railway Variables

    return {
        "videoUrl":  local_url or video_url,
        "remoteUrl": video_url,
        "prompt":    prompt,
        "model":     model_id,
        "engine":    "fal",
    }


# ── T2V payload & route ───────────────────────────────────────

class FalVideoPayload(BaseModel):
    prompt: str
    model: str = "wan21"          # wan21 | wan21_14b | hunyuan | cogvideox
    aspect: str = "widescreen"
    duration: int = 5


@router.post("/video/generate-fal")
async def generate_fal_video(payload: FalVideoPayload):
    if payload.model not in FAL_T2V_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown T2V model: {payload.model}. Use /video/fal-models to list options.")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: _fal_video(payload.prompt, payload.model, payload.aspect, payload.duration),
        )
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Image-to-Video (character-locked) ────────────────────────

class FalI2VPayload(BaseModel):
    image_url: str               # local /output/... URL or remote https:// URL
    prompt: str = ""             # optional motion description
    model: str = "wan21_i2v"    # wan21_i2v | wan21_14b_i2v | hunyuan_i2v
    duration: int = 5


def _fal_image_to_video(image_url: str, prompt: str, model_key: str, duration: int) -> dict:
    import os, urllib.request as ur
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set.")
    os.environ["FAL_KEY"] = api_key

    model_id = FAL_I2V_MODELS.get(model_key, FAL_I2V_MODELS["wan21_i2v"])

    # If local path, upload to fal.ai storage first
    if image_url.startswith("/output/") or image_url.startswith("output/"):
        local_path = image_url.lstrip("/")
        remote_url = fal_client.upload_file(local_path)
    else:
        remote_url = image_url

    result = fal_client.run(
        model_id,
        arguments={
            "image_url": remote_url,
            "prompt":    prompt or "cinematic motion, smooth camera",
            "duration":  duration,
            "resolution": "720p",
        },
    )
    video_url = result.get("video", {}).get("url") or result.get("video_url") or ""
    if not video_url:
        raise RuntimeError(f"No video URL in response: {result}")

    VID_DIR.mkdir(parents=True, exist_ok=True)
    ts       = __import__("datetime").datetime.now().strftime("%Y%m%d_%H%M%S")
    rid      = __import__("uuid").uuid4().hex[:8]
    filename = f"i2v_{model_key}_{ts}_{rid}.mp4"
    out_path = VID_DIR / filename

    # ── Short-term: try local download, fall back to fal.ai CDN URL (~7 day lifespan)
    local_url = None
    try:
        req = ur.Request(video_url, headers={"User-Agent": "LEVRAM/1.0"})
        with ur.urlopen(req, timeout=300) as r:
            out_path.write_bytes(r.read())
        local_url = "/output/videos/" + filename
    except Exception as dl_err:
        print(f"[LEVRAM] I2V local download failed ({dl_err}); using fal.ai CDN URL")

    # ── Long-term persistence (uncomment + wire R2 env vars when ready) ──
    # See T2V block above for the full boto3/R2 snippet — same pattern applies here.
    # key = f"videos/{filename}"  →  upload raw bytes  →  set local_url to R2 public URL

    return {
        "videoUrl":     local_url or video_url,
        "outputUrl":    local_url or video_url,
        "remoteUrl":    video_url,
        "prompt":       prompt,
        "model":        model_id,
        "engine":       "fal_i2v",
        "source_image": image_url,
    }


@router.post("/video/upload-image")
async def upload_image_for_video(file: UploadFile = File(...)):
    """Accept a logo/image file, save to output dir, return its server path for I2V."""
    IMG_DIR = Path("output/renders/images")
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "upload.png").suffix or ".png"
    name = f"upload_{uuid.uuid4().hex[:10]}{ext}"
    dest = IMG_DIR / name
    dest.write_bytes(await file.read())
    return {"success": True, "image_url": f"/output/renders/images/{name}"}


@router.post("/video/image-to-video")
async def image_to_video(payload: FalI2VPayload):
    """Animate a keyframe image — locks character appearance in the video."""
    if payload.model not in FAL_I2V_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown I2V model: {payload.model}")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: _fal_image_to_video(payload.image_url, payload.prompt, payload.model, payload.duration),
        )
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/fal-models")
def list_fal_video_models():
    return {
        "success": True,
        "t2v": {
            "default": "wan21",
            "models": [
                {"id": "wan21",     "label": "Wan 2.1 (1.3B)",  "speed": "fast",   "note": "Best speed/quality — open source"},
                {"id": "wan21_14b", "label": "Wan 2.1 (14B)",   "speed": "slow",   "note": "Highest quality — open source"},
                {"id": "hunyuan",   "label": "HunyuanVideo",    "speed": "medium", "note": "Strong temporal consistency"},
                {"id": "cogvideox", "label": "CogVideoX 5B",    "speed": "medium", "note": "Open source, good motion"},
            ],
        },
        "i2v": {
            "default": "wan21_i2v",
            "note": "Animate a FLUX+LoRA keyframe — character face is locked",
            "models": [
                {"id": "wan21_i2v",     "label": "Wan 2.1 I2V (1.3B)",  "speed": "fast",   "note": "Recommended for character shots"},
                {"id": "wan21_14b_i2v", "label": "Wan 2.1 I2V (14B)",   "speed": "slow",   "note": "Best quality"},
                {"id": "hunyuan_i2v",   "label": "HunyuanVideo I2V",    "speed": "medium", "note": "Strong face consistency"},
            ],
        },
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
