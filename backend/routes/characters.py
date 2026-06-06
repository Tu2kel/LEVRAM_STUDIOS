from backend.services.comfy_service import generate_comfy_keyframe
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json, uuid

from backend.db import characters_col

router = APIRouter()

DATA_FILE = Path("data/characters.json")


class CharacterPayload(BaseModel):
    name: str
    gender: str = ""
    age: str = ""
    appearance: str = ""
    wardrobe: str = ""
    voice: str = ""
    default_voice_profile: str = ""
    personality: str = ""
    notes: str = ""
    reference_image_url: str = ""
    voice_source: str = "edge_tts"
    elevenlabs_voice_id: str = ""
    rvc_model_path: str = ""
    rvc_index_path: str = ""
    rvc_source_type: str = "pretrained"
    default_fx_preset: str = "clean"


def _json_load():
    if not DATA_FILE.exists():
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps({"characters": []}, indent=2))
    return json.loads(DATA_FILE.read_text())


def _json_save(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


@router.get("/characters")
@router.get("/api/characters")
async def get_characters():
    if characters_col is not None:
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "characters": [_strip(d) for d in docs]}
    data = _json_load()
    return {"success": True, "characters": data.get("characters", [])}


@router.post("/characters")
async def create_character(payload: CharacterPayload):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Character name is required")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    character = {"id": str(uuid.uuid4()), **payload.model_dump(), "createdAt": now, "updatedAt": now}
    character["name"] = character["name"].strip()
    if characters_col is not None:
        await characters_col.insert_one(character)
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "character": _strip(character), "characters": [_strip(d) for d in docs]}
    data = _json_load()
    data["characters"].append(character)
    _json_save(data)
    return {"success": True, "character": character, "characters": data["characters"]}


@router.put("/characters/{character_id}")
async def update_character(character_id: str, payload: CharacterPayload):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Character name is required")
    updates = {**payload.model_dump(), "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    updates["name"] = updates["name"].strip()
    if characters_col is not None:
        result = await characters_col.find_one_and_update({"id": character_id}, {"$set": updates}, return_document=True)
        if not result:
            raise HTTPException(status_code=404, detail="Character not found")
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "character": _strip(result), "characters": [_strip(d) for d in docs]}
    data = _json_load()
    idx = next((i for i, c in enumerate(data["characters"]) if c.get("id") == character_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Character not found")
    data["characters"][idx].update(updates)
    _json_save(data)
    return {"success": True, "character": data["characters"][idx], "characters": data["characters"]}


@router.delete("/characters/{character_id}")
async def delete_character(character_id: str):
    if characters_col is not None:
        result = await characters_col.delete_one({"id": character_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Character not found")
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "characters": [_strip(d) for d in docs]}
    data = _json_load()
    before = len(data["characters"])
    data["characters"] = [c for c in data["characters"] if c.get("id") != character_id]
    if len(data["characters"]) == before:
        raise HTTPException(status_code=404, detail="Character not found")
    _json_save(data)
    return {"success": True, "characters": data["characters"]}


@router.post("/character-lab/generate")
async def generate_character_preview(payload: dict):
    prompt = payload.get("prompt") or ""
    item = {"id": "character-preview", "shotId": "character-preview", "shot": {
        "character": payload.get("character", {}).get("name", "Character Preview"),
        "shotDesc": prompt, "shotPrompt": prompt,
        "renderStyle": "cinematic photorealistic",
        "scene": "Character Lab", "shot_number": "CHARACTER-PREVIEW",
    }}
    render_result = generate_comfy_keyframe(item, width=512, height=768)
    image_url = (render_result.get("outputUrl") or render_result.get("renderOutputUrl")
                 or render_result.get("image_url") or render_result.get("url"))
    return {"success": True, "message": "Character preview generated", "prompt": prompt,
            "image_url": image_url, "data": render_result}
