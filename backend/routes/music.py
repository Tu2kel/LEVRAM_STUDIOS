"""
Phase 10 — Music & Score Studio

Free: upload any audio file as a score track; ffmpeg mixes it under the episode.
Paid stubs: Suno API, Udio API (enabled when API key is in .env).
"""
import json
import os
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from backend.db import music_col

router    = APIRouter()
MUSIC_DIR = Path("output/music")
MUSIC_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_DB  = Path("data/music_library.json")


# ─── JSON fallback helpers ─────────────────────────────────────

def _json_load() -> list:
    if not MUSIC_DB.exists():
        return []
    try:
        return json.loads(MUSIC_DB.read_text(encoding="utf-8"))
    except Exception:
        return []


def _json_save(tracks: list):
    MUSIC_DB.parent.mkdir(parents=True, exist_ok=True)
    MUSIC_DB.write_text(json.dumps(tracks, indent=2), encoding="utf-8")


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


# ─── Upload a track ───────────────────────────────────────────

@router.post("/music/upload")
async def upload_track(
    name:    str        = Form(...),
    mood:    str        = Form(""),
    project: str        = Form(""),
    file:    UploadFile = File(...),
):
    ext      = Path(file.filename).suffix.lower() or ".mp3"
    track_id = str(uuid.uuid4())
    filename = f"music_{track_id}{ext}"
    dest     = MUSIC_DIR / filename

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    track = {
        "id":        track_id,
        "name":      name,
        "mood":      mood,
        "project":   project,
        "url":       "/output/music/" + filename,
        "filename":  filename,
        "size_mb":   round(dest.stat().st_size / 1_048_576, 2),
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    if music_col is not None:
        await music_col.insert_one(track)
        return {"success": True, "track": _strip(track)}

    lib = _json_load()
    lib.insert(0, track)
    _json_save(lib)
    return {"success": True, "track": track}


@router.get("/music/library")
async def get_library():
    if music_col is not None:
        docs = await music_col.find({}).sort("createdAt", -1).to_list(None)
        alive = [_strip(d) for d in docs if (MUSIC_DIR / d["filename"]).exists()]
        if len(alive) < len(docs):
            dead_ids = [d["id"] for d in docs if not (MUSIC_DIR / d["filename"]).exists()]
            await music_col.delete_many({"id": {"$in": dead_ids}})
        return {"success": True, "tracks": alive}

    lib = _json_load()
    lib = [t for t in lib if (MUSIC_DIR / t["filename"]).exists()]
    _json_save(lib)
    return {"success": True, "tracks": lib}


@router.delete("/music/{track_id}")
async def delete_track(track_id: str):
    if music_col is not None:
        doc = await music_col.find_one({"id": track_id})
        if doc:
            f = MUSIC_DIR / doc["filename"]
            if f.exists():
                f.unlink()
        await music_col.delete_one({"id": track_id})
        return {"success": True}

    lib = _json_load()
    track = next((t for t in lib if t["id"] == track_id), None)
    if track:
        f = MUSIC_DIR / track["filename"]
        if f.exists():
            f.unlink()
    _json_save([t for t in lib if t["id"] != track_id])
    return {"success": True}


# ─── Mix music into a video ────────────────────────────────────

class GenerateMusicPayload(BaseModel):
    prompt:   str
    duration: int = 30   # seconds (8–90)
    project:  str = ""
    name:     str = ""


@router.post("/music/generate")
async def generate_music(payload: GenerateMusicPayload):
    """Generate AI music — WaveSpeed primary, fal.ai stable-audio fallback."""
    import asyncio
    import urllib.request as ur

    duration = max(8, min(90, payload.duration))

    # ── WaveSpeed music (active when WS_MUSIC_MODEL env var is set) ──────────
    ws_model   = os.getenv("WS_MUSIC_MODEL", "")   # e.g. "wavespeed-ai/stable-audio"
    ws_api_key = os.getenv("WAVESPEED_API_KEY", "")

    def _run_wavespeed() -> tuple[str, str]:
        import time, requests as _req
        headers = {
            "Authorization": f"Bearer {ws_api_key}",
            "Content-Type":  "application/json",
        }
        r = _req.post(
            f"https://api.wavespeed.ai/api/v2/{ws_model}",
            headers=headers,
            json={"prompt": payload.prompt, "duration": duration},
            timeout=60,
        )
        r.raise_for_status()
        request_id = r.json().get("data", {}).get("id") or r.json().get("id", "")
        if not request_id:
            raise RuntimeError(f"WaveSpeed: no request_id in response: {r.text[:200]}")

        for _ in range(90):
            time.sleep(3)
            pr = _req.get(
                f"https://api.wavespeed.ai/api/v2/predictions/{request_id}",
                headers=headers, timeout=30,
            )
            pr.raise_for_status()
            result = pr.json().get("data", pr.json())
            status = result.get("status", "")
            if status == "completed":
                outputs = result.get("outputs") or []
                audio_url = outputs[0] if outputs else ""
                if not audio_url:
                    raise RuntimeError("WaveSpeed: completed but no output URL")
                track_id = uuid.uuid4().hex[:10]
                filename = f"ai_{track_id}.wav"
                ur.urlretrieve(audio_url, MUSIC_DIR / filename)
                return f"/output/music/{filename}", filename
            if status in ("failed", "error"):
                raise RuntimeError(f"WaveSpeed job failed: {result.get('error', 'unknown')}")
        raise RuntimeError("WaveSpeed music timed out after 4.5 min")

    # ── fal.ai fallback ────────────────────────────────────────────────────────
    def _run_fal() -> tuple[str, str]:
        fal_key = os.getenv("FAL_KEY", "")
        if not fal_key:
            raise RuntimeError("FAL_KEY not set")
        try:
            import fal_client
        except ImportError:
            raise RuntimeError("fal-client not installed")
        os.environ["FAL_KEY"] = fal_key
        result = fal_client.run(
            "fal-ai/stable-audio",
            arguments={"prompt": payload.prompt, "seconds_total": duration, "steps": 100},
        )
        audio_url = (result.get("audio_file") or {}).get("url") or result.get("audio", {}).get("url") or ""
        if not audio_url:
            raise RuntimeError("fal.ai returned no audio URL")
        track_id = uuid.uuid4().hex[:10]
        filename = f"ai_{track_id}.wav"
        ur.urlretrieve(audio_url, MUSIC_DIR / filename)
        return f"/output/music/{filename}", filename

    loop = asyncio.get_event_loop()
    source = "wavespeed"
    local_url = filename = ""

    if ws_model and ws_api_key:
        try:
            local_url, filename = await loop.run_in_executor(None, _run_wavespeed)
        except Exception as _ws_err:
            print(f"[MUSIC] WaveSpeed failed ({_ws_err}), falling back to fal.ai")
            source = "fal-stable-audio"
            try:
                local_url, filename = await loop.run_in_executor(None, _run_fal)
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
    else:
        source = "fal-stable-audio"
        try:
            local_url, filename = await loop.run_in_executor(None, _run_fal)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    track_name = payload.name or f"AI Score — {payload.prompt[:40]}"
    track = {
        "id":        uuid.uuid4().hex[:10],
        "name":      track_name,
        "filename":  filename,
        "url":       local_url,
        "mood":      "",
        "project":   payload.project,
        "prompt":    payload.prompt,
        "duration":  duration,
        "source":    source,
        "createdAt": now,
    }
    if music_col is not None:
        await music_col.insert_one(track)
        track.pop("_id", None)
    else:
        tracks = _json_load()
        tracks.insert(0, track)
        _json_save(tracks)

    return {"success": True, "track": track, "url": local_url}


class MixPayload(BaseModel):
    video_url:    str
    music_url:    str
    music_volume: float = 0.25
    fade_out_sec: int   = 4


@router.post("/music/mix")
def mix_music(payload: MixPayload):
    base     = Path(".")
    vid_path = base / payload.video_url.lstrip("/")
    mus_path = base / payload.music_url.lstrip("/")

    if not vid_path.exists():
        raise HTTPException(status_code=404, detail=f"Video not found: {vid_path}")
    if not mus_path.exists():
        raise HTTPException(status_code=404, detail=f"Music not found: {mus_path}")

    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_name = f"mixed_{ts}_{vid_path.stem}.mp4"
    out_path = Path("output/videos") / out_name

    vol  = max(0.0, min(1.0, payload.music_volume))
    fade = max(1, payload.fade_out_sec)

    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(vid_path)],
        capture_output=True, text=True
    )
    try:
        duration   = float(json.loads(probe.stdout)["format"]["duration"])
        fade_start = max(0, duration - fade)
    except Exception:
        fade_start = 0

    filter_str = (
        f"[1:a]volume={vol},afade=t=out:st={fade_start:.1f}:d={fade}[music];"
        "[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(vid_path),
        "-i", str(mus_path),
        "-filter_complex", filter_str,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        str(out_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"ffmpeg mix error:\n{result.stderr}")

    return {"success": True, "mixedUrl": "/output/videos/" + out_name, "engine": "ffmpeg"}


# ─── Social format export ──────────────────────────────────────

SOCIAL_FORMATS = {
    "youtube":        {"w": 1920, "h": 1080, "note": "YouTube 16:9 1080p"},
    "youtube_shorts": {"w": 1080, "h": 1920, "note": "YouTube Shorts 9:16"},
    "instagram_reel": {"w": 1080, "h": 1920, "note": "Instagram Reels 9:16"},
    "tiktok":         {"w": 1080, "h": 1920, "note": "TikTok 9:16"},
    "twitter":        {"w": 1280, "h": 720,  "note": "Twitter/X 16:9 720p"},
    "facebook":       {"w": 1280, "h": 720,  "note": "Facebook 16:9 720p"},
}


class SocialExportPayload(BaseModel):
    video_url: str
    format:    str = "youtube"
    title:     str = ""
    tags:      list[str] = []


@router.post("/music/social-export")
def social_export(payload: SocialExportPayload):
    fmt = SOCIAL_FORMATS.get(payload.format)
    if not fmt:
        raise HTTPException(status_code=400, detail=f"Unknown format. Options: {list(SOCIAL_FORMATS)}")

    base     = Path(".")
    vid_path = base / payload.video_url.lstrip("/")
    if not vid_path.exists():
        raise HTTPException(status_code=404, detail=f"Video not found: {vid_path}")

    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir  = Path("output/social")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"{payload.format}_{ts}_{vid_path.stem}.mp4"
    out_path = out_dir / out_name
    w, h     = fmt["w"], fmt["h"]

    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:-1:-1:color=black,setsar=1"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", str(vid_path),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        str(out_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"ffmpeg error:\n{result.stderr}")

    meta_path = out_dir / f"{payload.format}_{ts}_{vid_path.stem}_meta.txt"
    meta_path.write_text(
        f"Title: {payload.title or vid_path.stem}\n"
        f"Tags: {', '.join(payload.tags)}\n"
        f"Format: {fmt['note']}\n"
        f"Resolution: {w}x{h}\n"
        f"Source: {payload.video_url}\n",
        encoding="utf-8"
    )

    return {
        "success":  True,
        "videoUrl": "/output/social/" + out_name,
        "metaUrl":  "/output/social/" + meta_path.name,
        "format":   payload.format,
        "note":     fmt["note"],
        "size":     f"{w}x{h}",
    }


@router.get("/music/social-formats")
def get_social_formats():
    return {"success": True, "formats": SOCIAL_FORMATS}
