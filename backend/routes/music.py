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

router    = APIRouter()
MUSIC_DIR = Path("output/music")
MUSIC_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_DB  = Path("data/music_library.json")


# ─── Library helpers ──────────────────────────────────────────

def _load_library() -> list:
    if not MUSIC_DB.exists():
        return []
    try:
        return json.loads(MUSIC_DB.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_library(tracks: list):
    MUSIC_DB.parent.mkdir(parents=True, exist_ok=True)
    MUSIC_DB.write_text(json.dumps(tracks, indent=2), encoding="utf-8")


# ─── Upload a track ───────────────────────────────────────────

@router.post("/music/upload")
async def upload_track(
    name:        str        = Form(...),
    mood:        str        = Form(""),
    project:     str        = Form(""),
    file:        UploadFile = File(...),
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

    lib = _load_library()
    lib.insert(0, track)
    _save_library(lib)

    return {"success": True, "track": track}


@router.get("/music/library")
def get_library():
    lib = _load_library()
    # Filter to files that still exist on disk
    lib = [t for t in lib if (MUSIC_DIR / t["filename"]).exists()]
    _save_library(lib)
    return {"success": True, "tracks": lib}


@router.delete("/music/{track_id}")
def delete_track(track_id: str):
    lib   = _load_library()
    track = next((t for t in lib if t["id"] == track_id), None)
    if track:
        f = MUSIC_DIR / track["filename"]
        if f.exists():
            f.unlink()
    lib = [t for t in lib if t["id"] != track_id]
    _save_library(lib)
    return {"success": True}


# ─── Mix music into a video ────────────────────────────────────

class MixPayload(BaseModel):
    video_url:    str         # e.g. "/output/videos/episode_xyz.mp4"
    music_url:    str         # e.g. "/output/music/music_abc.mp3"
    music_volume: float = 0.25  # 0.0 – 1.0 under dialogue
    fade_out_sec: int   = 4   # seconds to fade music at end


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

    # Get video duration for the fade-out start point
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(vid_path)],
        capture_output=True, text=True
    )
    try:
        duration = float(json.loads(probe.stdout)["format"]["duration"])
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

    return {
        "success":  True,
        "mixedUrl": "/output/videos/" + out_name,
        "engine":   "ffmpeg",
    }


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
    format:    str = "youtube"   # key from SOCIAL_FORMATS
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

    # Scale + pad to target dimensions (letter/pillar box with black)
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

    # Write metadata sidecar
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
        "success":   True,
        "videoUrl":  "/output/social/" + out_name,
        "metaUrl":   "/output/social/" + meta_path.name,
        "format":    payload.format,
        "note":      fmt["note"],
        "size":      f"{w}x{h}",
    }


@router.get("/music/social-formats")
def get_social_formats():
    return {"success": True, "formats": SOCIAL_FORMATS}
