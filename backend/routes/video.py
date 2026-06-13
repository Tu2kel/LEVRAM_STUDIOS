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


_GRADE_FILTERS: dict[str, str] = {
    "cinematic": (
        "curves=r='0/0 0.2/0.18 0.8/0.75 1/0.92':"
        "g='0/0.01 0.5/0.48 1/0.95':"
        "b='0/0.04 0.5/0.44 1/0.85',"
        "eq=contrast=1.05:saturation=0.85"
    ),
    "warm": "colorchannelmixer=rr=1.08:gg=1.0:bb=0.88,eq=saturation=1.1:brightness=0.02",
    "cool": "colorchannelmixer=rr=0.90:gg=0.95:bb=1.12,eq=saturation=0.92",
    "noir": "hue=s=0,eq=contrast=1.3:brightness=-0.05",
}


def _ffmpeg_build_video(
    clip_paths: list[Path],
    out_path: Path,
    *,
    transition: str = "none",
    transition_dur: float = 0.5,
    color_grade: str = "",
    captions: list[dict] | None = None,
    speed: float = 1.0,
) -> None:
    """Re-encode clips with optional transitions, color grade, captions, or speed."""
    n = len(clip_paths)

    # Fast path: no effects, use stream-copy concat
    if transition == "none" and not color_grade and not captions and speed == 1.0:
        _ffmpeg_concat(clip_paths, out_path)
        return

    durations = [_probe_duration(p) for p in clip_paths]
    adj_durs  = [d / speed for d in durations]

    inputs: list[str] = []
    for p in clip_paths:
        inputs += ["-i", str(p)]

    vfilters: list[str] = []
    normalize = (
        "fps=25,"
        "scale=1920:1080:force_original_aspect_ratio=decrease,"
        "pad=1920:1080:-1:-1:color=black,"
        "setsar=1"
    )
    for i in range(n):
        speed_f = f"setpts={1.0/speed:.6f}*PTS," if speed != 1.0 else ""
        vfilters.append(f"[{i}:v]{speed_f}{normalize}[v{i}]")

    # Transitions or plain concat
    current_tag: str
    if transition != "none" and n > 1:
        td       = transition_dur
        last_tag = "[v0]"
        cumulative = adj_durs[0]
        for i in range(1, n):
            offset   = max(0.0, cumulative - td)
            new_tag  = f"[xf{i}]"
            vfilters.append(
                f"{last_tag}[v{i}]xfade=transition={transition}"
                f":duration={td:.3f}:offset={offset:.3f}{new_tag}"
            )
            cumulative += adj_durs[i] - td
            last_tag = new_tag
        current_tag = last_tag
    elif n > 1:
        concat_in = "".join(f"[v{i}]" for i in range(n))
        vfilters.append(f"{concat_in}concat=n={n}:v=1:a=0[vcat]")
        current_tag = "[vcat]"
    else:
        current_tag = "[v0]"

    # Color grade
    gf = _GRADE_FILTERS.get(color_grade, "")
    if gf:
        vfilters.append(f"{current_tag}{gf}[vgrade]")
        current_tag = "[vgrade]"

    # Captions (burn-in dialogue)
    if captions:
        for j, cap in enumerate(captions):
            raw = str(cap.get("text", "")).strip()
            if not raw:
                continue
            esc   = raw.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
            start = float(cap.get("start", 0))
            end   = float(cap.get("end", start + 3.0))
            vfilters.append(
                f"{current_tag}drawtext="
                f"text='{esc}':"
                f"fontcolor=white:fontsize=34:"
                f"box=1:boxcolor=black@0.55:boxborderw=6:"
                f"x=(w-text_w)/2:y=h-th-40:"
                f"enable='between(t\\,{start:.2f}\\,{end:.2f})'[vcap{j}]"
            )
            current_tag = f"[vcap{j}]"

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", ";".join(vfilters),
        "-map", current_tag,
        "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg build_video error:\n{result.stderr}")


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
    timeline_file:  str   = "data/timelines/main_timeline.json"
    title:          str   = "levram_export"
    shot_ids:       list[str] = []
    music_url:      str   = ""      # /output/music/... local path
    music_volume:   float = 0.20    # 0.0–1.0
    include_voice:  bool  = True    # mix in per-shot TTS audio if present
    fade_out_sec:   int   = 4
    transition:     str   = "none"  # none | fade | dissolve | wipeleft | radial | smoothup
    transition_dur: float = 0.5     # seconds (0.25–2.0)
    color_grade:    str   = ""      # "" | cinematic | warm | cool | noir
    captions:       bool  = False   # burn dialogue as subtitles
    speed:          float = 1.0     # 1.0=normal 0.5=slow-mo 2.0=fast
    title_clip:     str   = ""      # /output/... path to prepend as title card


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

    # ── Prepend title card if provided ────────────────────────
    if payload.title_clip:
        tc_path = _resolve_path(payload.title_clip)
        if tc_path.exists():
            clip_paths.insert(0, tc_path)
            shot_map.insert(0, -1)   # sentinel: not a real shot

    ts        = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_title = payload.title.replace(" ", "_")

    # ── 2. Probe clip durations (needed for transitions + captions) ──
    loop = asyncio.get_event_loop()
    clip_durs: list[float] = []
    for cp in clip_paths:
        d = await loop.run_in_executor(None, lambda p=cp: _probe_duration(p))
        clip_durs.append(d)

    # ── 3. Build caption timing list ───────────────────────────
    caption_list: list[dict] | None = None
    if payload.captions:
        caption_list = []
        cursor = 0.0
        for clip_idx, shot_idx in enumerate(shot_map):
            dur = clip_durs[clip_idx] / max(payload.speed, 0.1)
            if shot_idx >= 0:   # skip title card sentinel
                shot = shots[shot_idx]
                text = shot.get("dialogue") or shot.get("voiceText") or ""
                if text:
                    caption_list.append({"text": text, "start": cursor, "end": cursor + dur - 0.3})
            cursor += dur

    # ── 4. Build base video (effects pass) ────────────────────
    base_video = tmp_dir / f"{safe_title}_base_{ts}.mp4"
    try:
        await loop.run_in_executor(None, lambda: _ffmpeg_build_video(
            clip_paths, base_video,
            transition=payload.transition,
            transition_dur=payload.transition_dur,
            color_grade=payload.color_grade,
            captions=caption_list,
            speed=payload.speed,
        ))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    # ── 5. Collect voice audio with timing offsets ────────────
    voice_clips: list[tuple[Path, float]] = []
    if payload.include_voice:
        cursor = 0.0
        for clip_idx, shot_idx in enumerate(shot_map):
            clip_dur = clip_durs[clip_idx] / max(payload.speed, 0.1)
            if shot_idx < 0:    # title card — no voice
                cursor += clip_dur
                continue
            shot      = shots[shot_idx]
            audio_url = shot.get("fxUrl") or shot.get("rawUrl") or ""
            audio_path = _resolve_audio(audio_url)
            if audio_path:
                voice_clips.append((audio_path, cursor))
            cursor += clip_dur

    # ── 6. Resolve music track ────────────────────────────────
    music_path: Path | None = None
    if payload.music_url:
        mp = BASE_DIR / payload.music_url.lstrip("/")
        if mp.exists():
            music_path = mp

    # ── 7. Mix audio → final output ──────────────────────────
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
    "wan21_i2v":       "fal-ai/wan-i2v",                               # Wan 2.1 I2V — free, fast draft
    "wan21_14b_i2v":   "fal-ai/wan/v2.2-a14b/image-to-video",         # Wan 2.2 14B — free, best open
    "kling_26":        "fal-ai/kling-video/v2.6/pro/image-to-video",   # Kling 2.6 Pro — production
    "kling_o1":        "fal-ai/kling-video/o1/image-to-video",         # Kling O1 — dual keyframe (start+end)
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
    model: str = "kling_26"
    duration: int = 5
    project: str = ""            # saga/project name for per-project film library


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
    is_wan   = model_key.startswith("wan")
    is_kling = model_key.startswith("kling")

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

    return {
        "videoUrl":     local_url or video_url,
        "outputUrl":    local_url or video_url,
        "remoteUrl":    video_url,
        "prompt":       prompt,
        "model":        model_id,
        "engine":       "fal_i2v",
        "source_image": image_url,
        "filename":     filename,
    }


@router.delete("/video/delete")
async def delete_video(url: str):
    """Delete a generated video file by its /output/videos/... URL."""
    safe = url.lstrip("/")
    if not safe.startswith("output/videos/"):
        raise HTTPException(400, "Only output/videos/ files can be deleted.")
    path = BASE_DIR / safe
    if not path.exists():
        raise HTTPException(404, "File not found.")
    path.unlink()
    return {"success": True}


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

    project = payload.project

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
                # Persist video metadata (MongoDB → Railway volume sidecar fallback)
                if result.get("filename"):
                    ts_str = datetime.now().strftime("%Y-%m-%d %H:%M")
                    import asyncio as _aio
                    _aio.create_task(_save_video_meta(result["filename"], {
                        "project": project,
                        "created": ts_str,
                        "created_ts": datetime.now().timestamp(),
                        "prompt": prompt,
                        "model": model_key,
                    }))
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
            "default": "wan21_i2v",
            "note": "Animate a FLUX+LoRA keyframe — character face is locked",
            "models": [
                {"id": "wan21_i2v",       "label": "Wan 2.1 Fast",          "speed": "fast",   "paid": False, "note": "Free — fast draft/preview"},
                {"id": "wan21_14b_i2v",   "label": "Wan 2.1 Best",          "speed": "slow",   "paid": False, "note": "Free — best open-source quality"},
                {"id": "kling_26",        "label": "Kling 2.6 Pro ✦",       "speed": "medium", "paid": True,  "note": "Production — best quality I2V"},
                {"id": "kling_o1",        "label": "Kling O1 Dual-frame ✦", "speed": "medium", "paid": True,  "note": "Start+end keyframe synthesis"},
                {"id": "runway_turbo",    "label": "Runway Gen-4 Turbo ✦",  "speed": "fast",   "paid": True,  "note": "Fast Runway I2V"},
                {"id": "runway_gen4_i2v", "label": "Runway Gen-4.5 ✦",      "speed": "fast",   "paid": True,  "note": "Runway flagship I2V"},
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

def _read_video_meta(path: Path) -> dict:
    """Read sidecar .json for a video file (local-dev fallback). Returns {} if missing."""
    import json as _json
    sidecar = path.with_suffix(".json")
    if sidecar.exists():
        try:
            return _json.loads(sidecar.read_text())
        except Exception:
            pass
    return {}


def _write_video_meta_local(path: Path, meta: dict) -> None:
    """Write sidecar JSON next to a video (local-dev fallback)."""
    import json as _json
    try:
        path.with_suffix(".json").write_text(_json.dumps(meta))
    except Exception:
        pass


async def _save_video_meta(filename: str, meta: dict) -> None:
    """Persist video metadata: MongoDB when available, sidecar file otherwise."""
    from backend.db import videos_col
    if videos_col is not None:
        await videos_col.update_one(
            {"filename": filename},
            {"$set": {**meta, "filename": filename}},
            upsert=True,
        )
    else:
        _write_video_meta_local(VID_DIR / filename, meta)


@router.get("/video/library")
async def get_video_library(project: str = ""):
    from backend.db import videos_col
    VID_DIR.mkdir(parents=True, exist_ok=True)

    if videos_col is not None:
        # MongoDB path
        query = {"project": project} if project else {}
        cursor = videos_col.find(query, {"_id": 0}).sort("created_ts", -1).limit(50)
        docs   = await cursor.to_list(length=50)
        # Enrich with current file size (Railway volume still holds the actual MP4s)
        result = []
        for doc in docs:
            path = VID_DIR / doc["filename"]
            size_mb = round(path.stat().st_size / 1_048_576, 1) if path.exists() else 0
            result.append({
                "url":     "/output/videos/" + doc["filename"],
                "name":    doc["filename"],
                "created": doc.get("created", ""),
                "size_mb": size_mb,
                "project": doc.get("project", ""),
            })
        return {"success": True, "videos": result}

    # Local JSON fallback
    videos = sorted(VID_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
    result = []
    for v in videos:
        meta = _read_video_meta(v)
        if project and meta.get("project", "") != project:
            continue
        result.append({
            "url":     "/output/videos/" + v.name,
            "name":    v.name,
            "created": datetime.fromtimestamp(v.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            "size_mb": round(v.stat().st_size / 1_048_576, 1),
            "project": meta.get("project", ""),
        })
        if len(result) >= 50:
            break
    return {"success": True, "videos": result}


@router.post("/video/tag-project")
async def tag_video_project(url: str, project: str):
    """Attach a project/saga name to a video."""
    safe = url.lstrip("/")
    if not safe.startswith("output/videos/"):
        raise HTTPException(400, "Only output/videos/ files can be tagged.")
    path = BASE_DIR / safe
    if not path.exists():
        raise HTTPException(404, "File not found.")
    filename = path.name
    await _save_video_meta(filename, {"project": project})
    return {"success": True}
