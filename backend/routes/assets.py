from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
import json
import os
import mimetypes

router = APIRouter()

OUTPUT_ROOT = Path("output")
TAGS_FILE   = Path("data/asset_tags.json")
TAGS_FILE.parent.mkdir(parents=True, exist_ok=True)

# Asset type → subdirectory mapping
ASSET_DIRS = {
    "image":  OUTPUT_ROOT / "renders",
    "video":  OUTPUT_ROOT / "videos",
    "audio":  OUTPUT_ROOT / "audio",
    "music":  OUTPUT_ROOT / "music",
    "upscale": OUTPUT_ROOT / "renders" / "upscaled",
}

AUDIO_EXTS  = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}
IMAGE_EXTS  = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTS  = {".mp4", ".webm", ".mov", ".avi", ".mkv"}


def _load_tags() -> dict:
    if TAGS_FILE.exists():
        try:
            return json.loads(TAGS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_tags(tags: dict):
    TAGS_FILE.write_text(json.dumps(tags, indent=2))


def _asset_type_from_ext(ext: str) -> str:
    ext = ext.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    return "other"


def _scan_dir(directory: Path, asset_type: str, tags: dict) -> list[dict]:
    if not directory.exists():
        return []
    results = []
    for f in sorted(directory.iterdir(), key=lambda x: x.stat().st_mtime if x.is_file() else 0, reverse=True):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        detected_type = _asset_type_from_ext(ext)
        if detected_type == "other" and asset_type not in ("other", "all"):
            continue

        stat = f.stat()
        url_path = "/" + str(f).replace("\\", "/")
        # Serve via /output/ static mount
        if "output" in f.parts:
            idx = list(f.parts).index("output")
            url_path = "/" + "/".join(f.parts[idx:])

        key = f"{asset_type}/{f.name}"
        results.append({
            "id":       key,
            "filename": f.name,
            "type":     asset_type if asset_type != "all" else detected_type,
            "ext":      ext,
            "url":      url_path,
            "size_mb":  round(stat.st_size / (1024 * 1024), 2),
            "modified": int(stat.st_mtime),
            "tags":     tags.get(key, []),
        })
    return results


@router.get("/assets")
def list_assets(
    type: str = "all",
    search: str = "",
    tag: str = "",
):
    tags = _load_tags()
    results = []

    if type == "all":
        for atype, adir in ASSET_DIRS.items():
            if atype == "upscale":
                continue  # included under "image"
            results.extend(_scan_dir(adir, atype, tags))
        # Also include upscaled images
        results.extend(_scan_dir(ASSET_DIRS["upscale"], "image", tags))
    else:
        adir = ASSET_DIRS.get(type, OUTPUT_ROOT)
        results.extend(_scan_dir(adir, type, tags))

    # Filter by search
    if search:
        q = search.lower()
        results = [r for r in results if q in r["filename"].lower()]

    # Filter by tag
    if tag:
        results = [r for r in results if tag in r["tags"]]

    # Deduplicate by url
    seen = set()
    unique = []
    for r in results:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)

    return {"success": True, "assets": unique, "count": len(unique)}


class TagPayload(BaseModel):
    asset_id: str
    tags: list[str]


@router.post("/assets/tag")
def tag_asset(payload: TagPayload):
    tags = _load_tags()
    tags[payload.asset_id] = payload.tags
    _save_tags(tags)
    return {"success": True, "asset_id": payload.asset_id, "tags": payload.tags}


@router.delete("/assets/{asset_type}/{filename}")
def delete_asset(asset_type: str, filename: str):
    adir = ASSET_DIRS.get(asset_type)
    if not adir:
        raise HTTPException(status_code=404, detail=f"Unknown asset type: {asset_type}")

    path = adir / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    path.unlink()

    # Remove tags
    tags = _load_tags()
    key = f"{asset_type}/{filename}"
    tags.pop(key, None)
    _save_tags(tags)

    return {"success": True, "deleted": filename}
