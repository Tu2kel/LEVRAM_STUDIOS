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

# ── Rate limiting: max 3 concurrent fal.ai generation calls ──────────────────
_FAL_SEM = asyncio.Semaphore(3)

# ── In-memory async job store ─────────────────────────────────────────────────
# Survives for the lifetime of the server process. On Railway, this resets
# on redeploy — fine for generation jobs which complete in minutes.
_JOBS: dict = {}   # job_id → {status, result, error, started_at, type}


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


# ─── Export Timeline → final MP4 ─────────────────────────────

class ExportTimelinePayload(BaseModel):
    timeline_file: str  = "data/timelines/main_timeline.json"
    title:         str  = "levram_export"
    shot_ids:      list[str] = []
    music_url:     str  = ""      # /output/music/... local path
    music_volume:  float = 0.20   # 0.0–1.0
    include_voice: bool = True    # mix in per-shot TTS audio if present
    fade_out_sec:  int  = 4


def _probe_duration(path: Path) -> float:
    """Return duration in seconds via ffprobe, fallback 5.0."""
    try:
        import json as _json
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, timeout=30
        )
        return float(_json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return 5.0


def _resolve_audio(url: str) -> Path | None:
    """Turn a local /output/... URL into a Path, strip any host prefix."""
    if not url:
        return None
    # Strip http://host:port prefix if present
    if url.startswith("http"):
        from urllib.parse import urlparse
        url = urlparse(url).path
    p = BASE_DIR / url.lstrip("/")
    return p if p.exists() else None


def _ffmpeg_mix_audio(
    video_path: Path,
    voice_clips: list[tuple[Path, float]],   # (audio_path, start_offset_sec)
    music_path: Path | None,
    music_volume: float,
    fade_out_sec: int,
    out_path: Path,
) -> None:
    """Combine video + offset voice clips + optional music bed into one MP4."""
    inputs     = ["-i", str(video_path)]
    filters    = []
    audio_outs = []
    idx        = 1   # input index (0 = video)

    for audio_path, offset_ms in [(p, int(o * 1000)) for p, o in voice_clips]:
        inputs += ["-i", str(audio_path)]
        tag = f"[va{idx}]"
        filters.append(f"[{idx}:a]adelay={offset_ms}|{offset_ms},apad[va{idx}]")
        audio_outs.append(tag)
        idx += 1

    if music_path:
        inputs += ["-i", str(music_path)]
        # Probe video duration for music fade
        try:
            vid_dur    = _probe_duration(video_path)
            fade_start = max(0, vid_dur - fade_out_sec)
        except Exception:
            fade_start = 0
        filters.append(
            f"[{idx}:a]volume={music_volume},"
            f"afade=t=out:st={fade_start:.1f}:d={fade_out_sec}[vmusic]"
        )
        audio_outs.append("[vmusic]")
        idx += 1

    if not audio_outs:
        # No audio at all — just copy video
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video_path), "-c", "copy", str(out_path)],
            capture_output=True, text=True, timeout=600, check=True
        )
        return

    n = len(audio_outs)
    filters.append(f"{''.join(audio_outs)}amix=inputs={n}:duration=first:dropout_transition=2[aout]")
    filter_str = ";".join(filters)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_str,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg audio mix error:\n{result.stderr}")


@router.post("/video/export-timeline")
async def export_timeline(payload: ExportTimelinePayload):
    import json, urllib.request

    tl_path = Path(payload.timeline_file)
    if not tl_path.exists():
        raise HTTPException(400, "Timeline not found")

    data  = json.loads(tl_path.read_text())
    shots = data.get("shots", [])

    if payload.shot_ids:
        shots = [s for sid in payload.shot_ids for s in shots if s.get("id") == sid]
    else:
        shots = [s for s in shots if s.get("videoUrl") or s.get("renderOutputUrl") or s.get("clipUrl")]

    if not shots:
        raise HTTPException(400, "No video clips in timeline — animate your shots first.")

    tmp_dir    = Path(tempfile.mkdtemp())
    clip_paths: list[Path]   = []
    shot_map:  list[int]     = []   # which shot index maps to which clip

    # ── 1. Download / resolve all video clips ─────────────────
    for i, shot in enumerate(shots):
        url = shot.get("videoUrl") or shot.get("renderOutputUrl") or shot.get("clipUrl") or ""
        if not url:
            continue
        if not url.startswith("http"):
            local = _resolve_path(url)
            if local.exists():
                clip_paths.append(local); shot_map.append(i)
            continue
        dest = tmp_dir / f"clip_{i:04d}.mp4"
        try:
            req  = urllib.request.Request(url, headers={"User-Agent": "LEVRAM/1.0"})
            loop = asyncio.get_event_loop()
            def _dl(r=req, d=dest):
                with urllib.request.urlopen(r, timeout=120) as resp:
                    d.write_bytes(resp.read())
            await loop.run_in_executor(None, _dl)
            clip_paths.append(dest); shot_map.append(i)
        except Exception:
            continue

    if not clip_paths:
        raise HTTPException(400, "Could not resolve any video files.")

    ts        = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = payload.title.replace(" ", "_")

    # ── 2. Concat video clips ─────────────────────────────────
    base_video = tmp_dir / f"{safe_title}_base_{ts}.mp4"
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, lambda: _ffmpeg_concat(clip_paths, base_video))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    # ── 3. Collect voice audio with timing offsets ────────────
    voice_clips: list[tuple[Path, float]] = []
    if payload.include_voice:
        cursor = 0.0
        for clip_idx, shot_idx in enumerate(shot_map):
            shot     = shots[shot_idx]
            clip_dur = await loop.run_in_executor(None, lambda p=clip_paths[clip_idx]: _probe_duration(p))
            # Prefer FX-processed audio, then raw TTS
            audio_url = shot.get("fxUrl") or shot.get("rawUrl") or ""
            audio_path = _resolve_audio(audio_url)
            if audio_path:
                voice_clips.append((audio_path, cursor))
            cursor += clip_dur

    # ── 4. Resolve music track ────────────────────────────────
    music_path: Path | None = None
    if payload.music_url:
        mp = BASE_DIR / payload.music_url.lstrip("/")
        if mp.exists():
            music_path = mp

    # ── 5. Mix audio → final output ──────────────────────────
    out_name = f"{safe_title}_{ts}.mp4"
    out_path = VID_DIR / out_name

    try:
        await loop.run_in_executor(None, lambda: _ffmpeg_mix_audio(
            base_video, voice_clips, music_path,
            payload.music_volume, payload.fade_out_sec, out_path
        ))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    return {
        "success":      True,
        "exportUrl":    "/output/videos/" + out_name,
        "clips":        len(clip_paths),
        "voice_tracks": len(voice_clips),
        "music":        bool(music_path),
        "skipped":      len(shots) - len(clip_paths),
    }


# ─── Lane 2a: fal.ai T2V (lead — cloud GPU) ──────────────────

# Text-to-Video models
FAL_T2V_MODELS = {
    "wan21":        "fal-ai/wan/v2.1/1.3b/text-to-video",   # fast, open-source
    "wan21_14b":    "fal-ai/wan/v2.1/14b/text-to-video",    # highest quality open-source
    "hunyuan":      "fal-ai/hunyuan-video",                  # strong consistency, free
    "cogvideox":    "fal-ai/cogvideox-5b",                   # open-source, good motion
    "runway_gen4":  "fal-ai/runway-gen4.5/text-to-video",   # Runway Gen-4.5 T2V — paid
}

# Image-to-Video models — lock the character's face via a keyframe
FAL_I2V_MODELS = {
    "wan21_i2v":       "fal-ai/wan-i2v",                               # Wan 2.1 I2V — free
    "wan21_14b_i2v":   "fal-ai/wan/v2.2-a14b/image-to-video",         # Wan 2.2 14B — free, best open
    "kling_pro":       "fal-ai/kling-video/v2.1/pro/image-to-video",   # Kling 2.1 Pro — ~$0.35/5s
    "kling_26":        "fal-ai/kling-video/v2.6/pro/image-to-video",   # Kling 2.6 Pro — latest
    "kling_o1":        "fal-ai/kling-video/o1/image-to-video",         # Kling O1 — dual keyframe (start+end)
    "seedance":        "bytedance/seedance-2.0/fast/image-to-video",   # Seedance 2.0 Fast — ~$2.42/10s
    "runway_turbo":    "fal-ai/runway-gen4-turbo/image-to-video",      # Runway Turbo — paid
    "runway_gen4_i2v": "fal-ai/runway-gen4.5/image-to-video",         # Runway Gen-4.5 — paid, best
}

FAL_VIDEO_MODELS = {**FAL_T2V_MODELS, **FAL_I2V_MODELS}  # keep for backward compat

FAL_VIDEO_SIZES = {
    "widescreen": "1280x720",
    "cinematic":  "1280x544",
    "portrait":   "720x1280",
    "square":     "720x720",
}


def _humanize_fal_error(e: Exception) -> str:
    """Turn raw fal.ai / network exceptions into plain-English messages."""
    msg = str(e).lower()
    if "quota" in msg or "rate limit" in msg or "429" in msg:
        return "fal.ai rate limit hit — wait 60 seconds and retry."
    if "unauthorized" in msg or "403" in msg or "invalid key" in msg:
        return "FAL_KEY is invalid or expired — check Railway Variables."
    if "model" in msg and ("not found" in msg or "unavailable" in msg):
        return "This fal.ai model is temporarily unavailable — try a different engine."
    if "timeout" in msg or "timed out" in msg:
        return "fal.ai took too long to respond — the model may be overloaded. Retry."
    if "no video" in msg or "no image" in msg or "returned no" in msg:
        return "fal.ai returned an empty result — your prompt may have triggered a content filter. Try rephrasing."
    if "fal_key not set" in msg or "fal_key" in msg:
        return "FAL_KEY not set — add it to Railway Variables."
    return f"Generation failed: {str(e)}"


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

    is_runway = model_key.startswith("runway")
    if is_runway:
        # Runway accepts only prompt + duration (5 or 10s); no resolution/steps params
        args = {
            "prompt":   prompt,
            "duration": 10 if duration >= 8 else 5,
        }
    else:
        args = {
            "prompt":               prompt,
            "resolution":           resolution,
            "duration":             duration,
            "num_inference_steps":  30,
        }

    result = fal_client.run(model_id, arguments=args)
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
        raise HTTPException(status_code=400, detail=f"Unknown T2V model: {payload.model}.")

    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {
        "status": "queued", "result": None, "error": None,
        "started_at": datetime.now().isoformat(), "type": "t2v",
    }

    async def _run():
        async with _FAL_SEM:
            _JOBS[job_id]["status"] = "running"
            loop = asyncio.get_event_loop()
            try:
                result = await loop.run_in_executor(
                    None, lambda: _fal_video(payload.prompt, payload.model, payload.aspect, payload.duration)
                )
                _JOBS[job_id]["status"] = "complete"
                _JOBS[job_id]["result"] = result
            except Exception as e:
                _JOBS[job_id]["status"] = "failed"
                _JOBS[job_id]["error"] = _humanize_fal_error(e)

    asyncio.create_task(_run())
    return {"success": True, "job_id": job_id, "status": "queued"}


@router.get("/video/job/{job_id}")
async def get_job_status(job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        return {"success": False, "error": "Job not found or expired"}
    return {"success": True, **job}


# ── Image-to-Video (character-locked) ────────────────────────

class FalI2VPayload(BaseModel):
    image_url: str               # start frame — local /output/... URL or remote https://
    end_image_url: str = ""      # end frame — only used by kling_o1 dual-keyframe
    prompt: str = ""
    model: str = "kling_pro"
    duration: int = 5


def _fal_image_to_video(image_url: str, prompt: str, model_key: str, duration: int,
                        end_image_url: str = "") -> dict:
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

    def _upload_if_local(url: str) -> str:
        if url.startswith("/output/") or url.startswith("output/"):
            return fal_client.upload_file(url.lstrip("/"))
        return url

    remote_url = _upload_if_local(image_url)

    is_runway   = model_key.startswith("runway")
    is_wan      = model_key.startswith("wan")
    is_kling    = model_key.startswith("kling")
    is_seedance = model_key.startswith("seedance")

    if model_key == "kling_o1":
        # Dual-keyframe: synthesises motion between start and end image
        if not end_image_url:
            raise RuntimeError("Kling O1 requires an end frame image (end_image_url).")
        remote_end = _upload_if_local(end_image_url)
        args = {
            "start_image_url": remote_url,
            "end_image_url":   remote_end,
            "prompt":          prompt or "smooth cinematic transition between frames",
            "duration":        10 if duration >= 8 else 5,
            "aspect_ratio":    "16:9",
        }
    elif is_runway:
        # Runway: image_url + prompt + duration (5 or 10 only)
        args = {
            "image_url": remote_url,
            "prompt":    prompt or "cinematic motion, smooth camera movement",
            "duration":  10 if duration >= 8 else 5,
        }
    elif is_wan:
        # Wan requires explicit aspect_ratio
        args = {
            "image_url":    remote_url,
            "prompt":       prompt or "cinematic motion, smooth camera",
            "duration":     duration,
            "resolution":   "720p",
            "aspect_ratio": "16:9",
        }
    elif is_kling:
        # Standard Kling single-frame: duration 5 or 10
        args = {
            "image_url":    remote_url,
            "prompt":       prompt or "cinematic motion, smooth camera movement",
            "duration":     10 if duration >= 8 else 5,
            "aspect_ratio": "16:9",
        }
    elif is_seedance:
        # Seedance 2.0: duration up to 10s, supports audio gen
        args = {
            "image_url":      remote_url,
            "prompt":         prompt or "cinematic motion, smooth camera movement",
            "duration":       min(duration, 10),
            "resolution":     "720p",
            "aspect_ratio":   "16:9",
        }
    else:
        # Generic fallback
        args = {
            "image_url":    remote_url,
            "prompt":       prompt or "cinematic motion, smooth camera",
            "duration":     duration,
            "aspect_ratio": "16:9",
        }

    result = fal_client.run(model_id, arguments=args)
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
    """Animate a keyframe image — returns job_id immediately, poll /video/job/{id}."""
    if payload.model not in FAL_I2V_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown I2V model: {payload.model}")

    job_id = uuid.uuid4().hex
    _JOBS[job_id] = {
        "status": "queued", "result": None, "error": None,
        "started_at": datetime.now().isoformat(), "type": "i2v",
    }

    async def _run():
        async with _FAL_SEM:
            _JOBS[job_id]["status"] = "running"
            loop = asyncio.get_event_loop()
            try:
                result = await loop.run_in_executor(
                    None, lambda: _fal_image_to_video(
                        payload.image_url, payload.prompt, payload.model,
                        payload.duration, payload.end_image_url
                    )
                )
                _JOBS[job_id]["status"] = "complete"
                _JOBS[job_id]["result"] = result
            except Exception as e:
                _JOBS[job_id]["status"] = "failed"
                _JOBS[job_id]["error"] = _humanize_fal_error(e)

    asyncio.create_task(_run())
    return {"success": True, "job_id": job_id, "status": "queued"}


@router.get("/video/fal-models")
def list_fal_video_models():
    return {
        "success": True,
        "t2v": {
            "default": "hunyuan",
            "models": [
                {"id": "hunyuan",      "label": "HunyuanVideo",        "speed": "medium", "paid": False,  "note": "Free — strong temporal consistency"},
                {"id": "runway_gen4",  "label": "Runway Gen-4.5 ✦",    "speed": "fast",   "paid": True,   "note": "Runway flagship — T2V + I2V"},
                {"id": "wan21",        "label": "Wan 2.1 Fast",         "speed": "fast",   "paid": False,  "note": "Free — best speed/quality open-source"},
                {"id": "wan21_14b",    "label": "Wan 2.1 Best",         "speed": "slow",   "paid": False,  "note": "Free — highest quality open-source"},
                {"id": "cogvideox",    "label": "CogVideoX 5B",         "speed": "medium", "paid": False,  "note": "Free — cinematic style"},
            ],
        },
        "i2v": {
            "default": "hunyuan_i2v",
            "note": "Animate a FLUX+LoRA keyframe — character face is locked",
            "models": [
                {"id": "hunyuan_i2v",     "label": "HunyuanVideo I2V",      "speed": "medium", "paid": False, "note": "Free — strong face consistency"},
                {"id": "runway_turbo",    "label": "Runway Gen-4 Turbo ✦",  "speed": "fast",   "paid": True,  "note": "Fastest Runway — I2V only"},
                {"id": "runway_gen4_i2v", "label": "Runway Gen-4.5 ✦",      "speed": "fast",   "paid": True,  "note": "Best quality — Runway flagship I2V"},
                {"id": "wan21_i2v",       "label": "Wan 2.1 Fast",           "speed": "fast",   "paid": False, "note": "Free — fast character shots"},
                {"id": "wan21_14b_i2v",   "label": "Wan 2.1 Best",           "speed": "slow",   "paid": False, "note": "Free — best open-source quality"},
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
