from backend.services.comfy_service import generate_comfy_keyframe
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

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
    # Voice engine settings
    voice_source: str = "edge_tts"          # "elevenlabs" | "rvc" | "edge_tts"
    elevenlabs_voice_id: str = ""            # EL cloned voice ID
    rvc_model_path: str = ""                 # path to .pth model
    rvc_index_path: str = ""                 # path to .index file (optional)
    rvc_source_type: str = "pretrained"      # "my_voice" | "pretrained"


def load_data():
    if not DATA_FILE.exists():
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps({"characters": []}, indent=2))
    return json.loads(DATA_FILE.read_text())


def save_data(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


@router.get("/characters")
def get_characters():
    return load_data()


@router.post("/characters")
def create_character(payload: CharacterPayload):
    data = load_data()

    character = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "gender": payload.gender,
        "age": payload.age,
        "appearance": payload.appearance,
        "wardrobe": payload.wardrobe,
        "voice": payload.voice,
        "default_voice_profile": payload.default_voice_profile,
        "personality": payload.personality,
        "notes": payload.notes,
        "reference_image_url": payload.reference_image_url,
        "voice_source": payload.voice_source,
        "elevenlabs_voice_id": payload.elevenlabs_voice_id,
        "rvc_model_path": payload.rvc_model_path,
        "rvc_index_path": payload.rvc_index_path,
        "rvc_source_type": payload.rvc_source_type,
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    if not character["name"]:
        raise HTTPException(status_code=400, detail="Character name is required")

    data["characters"].append(character)
    save_data(data)

    return {"success": True, "character": character, "characters": data["characters"]}


# PHASE 8F.4 — update existing character without duplicating
@router.put("/characters/{character_id}")
def update_character(character_id: str, payload: CharacterPayload):
    data = load_data()
    characters = data.get("characters", []) if isinstance(data, dict) else []

    idx = next((i for i, c in enumerate(characters) if c.get("id") == character_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Character not found")

    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Character name is required")

    existing = characters[idx]
    existing.update({
        "name": payload.name.strip(),
        "gender": payload.gender,
        "age": payload.age,
        "appearance": payload.appearance,
        "wardrobe": payload.wardrobe,
        "voice": payload.voice,
        "default_voice_profile": payload.default_voice_profile,
        "personality": payload.personality,
        "notes": payload.notes,
        "reference_image_url": payload.reference_image_url,
        "voice_source": payload.voice_source,
        "elevenlabs_voice_id": payload.elevenlabs_voice_id,
        "rvc_model_path": payload.rvc_model_path,
        "rvc_index_path": payload.rvc_index_path,
        "rvc_source_type": payload.rvc_source_type,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

    data["characters"][idx] = existing
    save_data(data)

    return {"success": True, "character": existing, "characters": data["characters"]}


@router.delete("/characters/{character_id}")
def delete_character(character_id: str):
    data = load_data()
    before = len(data["characters"])

    data["characters"] = [
        c for c in data["characters"]
        if c.get("id") != character_id
    ]

    if len(data["characters"]) == before:
        raise HTTPException(status_code=404, detail="Character not found")

    save_data(data)
    return {"success": True, "characters": data["characters"]}

@router.post("/character-lab/generate")
async def generate_character_preview(payload: dict):
    prompt = payload.get("prompt") or ""

    item = {
        "id": "character-preview",
        "shotId": "character-preview",
        "shot": {
            "character": payload.get("character", {}).get("name", "Character Preview"),
            "shotDesc": prompt,
            "shotPrompt": prompt,
            "renderStyle": "cinematic photorealistic",
            "scene": "Character Lab",
            "shot_number": "CHARACTER-PREVIEW"
        }
    }

    # PHASE 8G — portrait orientation for character reference images
    render_result = generate_comfy_keyframe(item, width=512, height=768)

    image_url = (
        render_result.get("outputUrl")
        or render_result.get("renderOutputUrl")
        or render_result.get("image_url")
        or render_result.get("url")
    )

    return {
        "success": True,
        "message": "Character preview generated",
        "prompt": prompt,
        "image_url": image_url,
        "data": render_result
    }


# ===============================
# PHASE 8C — CHARACTER RETRIEVAL
# ===============================

@router.get("/characters")
@router.get("/api/characters")
def get_characters():
    data = load_data()
    characters = data.get("characters", []) if isinstance(data, dict) else []
    return {
        "success": True,
        "characters": characters
    }
