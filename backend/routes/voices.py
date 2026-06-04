from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

router = APIRouter()

DATA_FILE = Path("data/voices.json")


class VoicePayload(BaseModel):
    name: str
    character: str = ""
    rawUrl: str = ""
    fxUrl: str = ""
    preset: str = ""


def load_data():
    if not DATA_FILE.exists():
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps({"voices": []}, indent=2))
    return json.loads(DATA_FILE.read_text())


def save_data(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


@router.get("/voices")
def get_voices():
    return load_data()


@router.post("/voices")
def create_voice(payload: VoicePayload):
    data = load_data()

    voice = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "character": payload.character,
        "rawUrl": payload.rawUrl,
        "fxUrl": payload.fxUrl,
        "preset": payload.preset,
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    if not voice["name"]:
        raise HTTPException(status_code=400, detail="Voice name is required")

    # Replace existing voice with the same name instead of creating endless duplicates.
    data["voices"] = [
        v for v in data["voices"]
        if v.get("name", "").strip().lower() != voice["name"].lower()
    ]

    data["voices"].insert(0, voice)
    save_data(data)

    return {"success": True, "voice": voice, "voices": data["voices"]}


@router.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    data = load_data()
    before = len(data["voices"])

    data["voices"] = [
        v for v in data["voices"]
        if v.get("id") != voice_id
    ]

    if len(data["voices"]) == before:
        raise HTTPException(status_code=404, detail="Voice not found")

    save_data(data)
    return {"success": True, "voices": data["voices"]}
