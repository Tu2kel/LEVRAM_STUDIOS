from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

router = APIRouter()

SCENES_DIR = Path("data/scenes")


class ScenePayload(BaseModel):
    project: str = ""
    scene_number: str = ""
    shot_type: str = ""
    camera_mood: str = ""
    color_palette: str = ""
    ai_engine: str = ""
    shot_description: str = ""
    shot_prompt: str = ""
    character: str = ""
    duration: str = ""
    voice_character: str = ""
    voice_preset: str = ""


@router.post("/save-scene")
def save_scene(scene: ScenePayload):
    SCENES_DIR.mkdir(parents=True, exist_ok=True)

    scene_id = scene.scene_number.strip() or f"SC-{uuid.uuid4().hex[:6].upper()}"
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    data = scene.model_dump()
    data["id"] = scene_id
    data["saved_at"] = timestamp

    file_path = SCENES_DIR / f"{scene_id}_{timestamp}.json"

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
