from fastapi import APIRouter, Form
from pathlib import Path
import json

router = APIRouter()

CHARACTERS_FILE = Path("data/characters.json")


def _load_character(name: str) -> dict:
    if not CHARACTERS_FILE.exists():
        return {}
    data = json.loads(CHARACTERS_FILE.read_text())
    chars = data.get("characters", [])
    for c in chars:
        if c.get("name", "").strip().lower() == name.strip().lower():
            return c
    return {}


@router.post("/generate")
def tts_generate(
    text: str = Form(...),
    character: str = Form("default"),
):
    char = _load_character(character)
    voice_source = char.get("voice_source", "edge_tts")

    # ── ElevenLabs path ──────────────────────────────────────────────────────
    if voice_source == "elevenlabs":
        el_voice_id = char.get("elevenlabs_voice_id", "")
        if el_voice_id:
            try:
                from backend.services.elevenlabs_service import generate_tts as el_tts
                output_path = el_tts(text, el_voice_id)
                return {
                    "status": "generated",
                    "engine": "ElevenLabs",
                    "character": character,
                    "text": text,
                    "output_path": output_path,
                    "output_url": "/" + output_path.replace("\\", "/"),
                }
            except Exception as e:
                print(f"ElevenLabs TTS failed, falling back to edge_tts: {e}")

    # ── RVC path ─────────────────────────────────────────────────────────────
    if voice_source == "rvc":
        rvc_model = char.get("rvc_model_path", "")
        rvc_index = char.get("rvc_index_path", "")
        if rvc_model and Path(rvc_model).exists():
            try:
                from backend.services.spark_tts_service import generate_tts as edge_tts
                from backend.services.rvc_service import convert_voice
                raw_path = edge_tts(text, character)
                output_path = convert_voice(
                    raw_path,
                    rvc_model,
                    index_path=rvc_index or None,
                )
                return {
                    "status": "generated",
                    "engine": "RVC",
                    "character": character,
                    "text": text,
                    "output_path": output_path,
                    "output_url": "/" + output_path.replace("\\", "/"),
                }
            except Exception as e:
                print(f"RVC conversion failed, falling back to edge_tts: {e}")

    # ── edge_tts fallback ────────────────────────────────────────────────────
    from backend.services.spark_tts_service import generate_tts as edge_tts
    output_path = edge_tts(text, character)
    return {
        "status": "generated",
        "engine": "edge_tts",
        "character": character,
        "text": text,
        "output_path": output_path,
        "output_url": "/" + output_path.replace("\\", "/"),
    }
