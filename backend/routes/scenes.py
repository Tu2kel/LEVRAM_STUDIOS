from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

from backend.db import scenes_col

router = APIRouter()

SCENES_DIR = Path("data/scenes")


class ScenePayload(BaseModel):
    saga: str = ""
    project: str = ""
    scene_number: str = ""
    shot_type: str = ""
    camera_mood: str = ""
    color_palette: str = ""
    ai_engine: str = ""
    shot_description: str = ""
    shot_prompt: str = ""
    negative_prompt: str = ""
    character: str = ""
    duration: str = ""
    voice_character: str = ""
    voice_preset: str = ""
    rawUrl: str | None = None
    fxUrl: str | None = None


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


def _build(scene: ScenePayload, scene_id: str, now: str, existing: dict | None = None) -> dict:
    data = scene.model_dump()
    data["id"] = scene_id
    data["prompt_version"] = "v1_cinematic"
    data["prompt_score"] = min(100, 40 + len(data.get("shot_prompt", "")) // 8)
    data["updated_at"] = now
    data["saved_at"] = (existing or {}).get("saved_at", now)
    return data


# ─── JSON fallback helpers ─────────────────────────────────────

def _json_save(scene_id: str, data: dict):
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    saga_slug = (data.get("saga") or data.get("project") or "default").replace(" ", "_").replace("/", "_")
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    file_path = SCENES_DIR / f"{saga_slug}_{scene_id}_{ts}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return str(file_path)


def _json_load_all() -> list[dict]:
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    scenes = []
    for f in sorted(SCENES_DIR.glob("*.json"), reverse=True):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                d = json.load(fh)
                d["file"] = str(f)
                scenes.append(d)
        except Exception:
            continue
    return scenes


def _json_find(scene_id: str) -> tuple[dict | None, Path | None]:
    matches = sorted(SCENES_DIR.glob(f"*_{scene_id}_*.json"), reverse=True)
    if not matches:
        return None, None
    path = matches[0]
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), path


# ─── Routes ───────────────────────────────────────────────────


@router.post("/save-scene")
async def save_scene(scene: ScenePayload):
    scene_id = scene.scene_number.strip() or f"SC-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    data = _build(scene, scene_id, now)

    if scenes_col is not None:
        await scenes_col.delete_many({"id": scene_id})
        await scenes_col.insert_one(data)
        return {"success": True, "scene": _strip(data)}

    file_path = _json_save(scene_id, data)
    return {"success": True, "scene": data, "file": file_path}


@router.get("/scenes")
async def list_scenes(project: str = ""):
    if scenes_col is not None:
        query = {"project": project} if project else {}
        docs = await scenes_col.find(query).sort("shot_number", 1).to_list(None)
        return {"success": True, "count": len(docs), "scenes": [_strip(d) for d in docs]}

    all_scenes = _json_load_all()
    if project:
        all_scenes = [s for s in all_scenes if s.get("project", "") == project]
    return {"success": True, "count": len(all_scenes), "scenes": all_scenes}


@router.delete("/scenes/clear")
async def clear_project_scenes(project: str):
    """Delete all scenes for a given project — called before a fresh pipeline run."""
    if not project:
        return {"success": False, "detail": "project required"}
    if scenes_col is not None:
        result = await scenes_col.delete_many({"project": project})
        return {"success": True, "deleted": result.deleted_count}
    # JSON fallback: remove matching files
    deleted = 0
    if SCENES_DIR.exists():
        slug = project.replace(" ", "_").replace("/", "_")
        for f in SCENES_DIR.glob(f"{slug}_*.json"):
            f.unlink()
            deleted += 1
    return {"success": True, "deleted": deleted}


@router.put("/scene/{scene_id}")
async def update_scene(scene_id: str, scene: ScenePayload):
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if scenes_col is not None:
        existing_doc = await scenes_col.find_one({"id": scene_id})
        data = _build(scene, scene_id, now, existing_doc)
        result = await scenes_col.find_one_and_update(
            {"id": scene_id}, {"$set": data}, return_document=True
        )
        if not result:
            raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
        return {"success": True, "scene": _strip(result)}

    existing, path = _json_find(scene_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
    data = _build(scene, scene_id, now, existing)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return {"success": True, "scene": data, "file": str(path)}


@router.delete("/scene/{scene_id}")
async def delete_scene(scene_id: str):
    if scenes_col is not None:
        result = await scenes_col.delete_many({"id": scene_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
        return {"success": True, "scene_id": scene_id}

    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    matches = list(SCENES_DIR.glob(f"*_{scene_id}_*.json"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
    deleted = []
    for f in matches:
        f.unlink()
        deleted.append(str(f))
    return {"success": True, "scene_id": scene_id, "deleted": deleted}
