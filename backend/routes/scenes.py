from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

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


@router.post("/save-scene")
def save_scene(scene: ScenePayload):
    SCENES_DIR.mkdir(parents=True, exist_ok=True)

    scene_id = scene.scene_number.strip() or f"SC-{uuid.uuid4().hex[:6].upper()}"
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    data = scene.model_dump()
    data["id"] = scene_id
    data["prompt_version"] = "v1_cinematic"
    data["prompt_score"] = min(100, 40 + len(data.get("shot_prompt", "")) // 8)
    data["saved_at"] = timestamp
    data["updated_at"] = timestamp

    saga_slug = (scene.saga or scene.project or "default").replace(" ", "_").replace("/", "_")
    file_path = SCENES_DIR / f"{saga_slug}_{scene_id}_{timestamp}.json"

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return {
        "success": True,
        "scene": data,
        "file": str(file_path)
    }


@router.get("/scenes")
def list_scenes():
    SCENES_DIR.mkdir(parents=True, exist_ok=True)

    scenes = []

    for file in sorted(SCENES_DIR.glob("*.json"), reverse=True):
        try:
            with open(file, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["file"] = str(file)
                scenes.append(data)
        except Exception:
            continue

    return {
        "success": True,
        "count": len(scenes),
        "scenes": scenes
    }


@router.put("/scene/{scene_id}")
def update_scene(scene_id: str, scene: ScenePayload):
    SCENES_DIR.mkdir(parents=True, exist_ok=True)

    matches = sorted(SCENES_DIR.glob(f"{scene_id}_*.json"), reverse=True)

    if not matches:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")

    file_path = matches[0]

    with open(file_path, "r", encoding="utf-8") as f:
        existing = json.load(f)

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    data = scene.model_dump()
    data["id"] = scene_id
    data["prompt_version"] = "v1_cinematic"
    data["prompt_score"] = min(100, 40 + len(data.get("shot_prompt", "")) // 8)
    data["saved_at"] = existing.get("saved_at")
    data["updated_at"] = timestamp

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return {
        "success": True,
        "scene": data,
        "file": str(file_path)
    }


@router.delete("/scene/{scene_id}")
def delete_scene(scene_id: str):
    SCENES_DIR.mkdir(parents=True, exist_ok=True)

    matches = list(SCENES_DIR.glob(f"{scene_id}_*.json"))

    if not matches:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")

    deleted = []

    for file in matches:
        file.unlink()
        deleted.append(str(file))

    return {
        "success": True,
        "scene_id": scene_id,
        "deleted": deleted
    }
