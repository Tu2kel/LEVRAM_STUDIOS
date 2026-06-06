from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pathlib import Path
import shutil
import uuid
from backend.services import elevenlabs_service
from backend.services import rvc_service

router = APIRouter()

UPLOAD_DIR = Path("data/voice_samples")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

RVC_MODELS_DIR = Path("data/rvc_models")
RVC_MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ── ElevenLabs: clone a voice from an uploaded audio sample ──────────────────
@router.post("/voice-clone/elevenlabs")
async def clone_elevenlabs_voice(
    character_name: str = Form(...),
    file: UploadFile = File(...),
):
    tmp_path = UPLOAD_DIR / f"{uuid.uuid4()}_{file.filename}"
    with open(tmp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        voice_id = elevenlabs_service.clone_voice(character_name, str(tmp_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ElevenLabs clone failed: {e}")

    return {"success": True, "voice_id": voice_id, "character": character_name}


# ── ElevenLabs: list all cloned voices ───────────────────────────────────────
@router.get("/voice-clone/elevenlabs/voices")
def get_elevenlabs_voices():
    try:
        voices = elevenlabs_service.list_voices()
        return {"success": True, "voices": voices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ElevenLabs: generate a short test line with a specific voice ──────────────
@router.post("/voice-clone/elevenlabs/test")
async def test_elevenlabs_voice(
    voice_id: str = Form(...),
    text: str = Form("This is a test of the character voice. How does it sound?"),
):
    try:
        audio_path = elevenlabs_service.generate_tts(text, voice_id)
        return {
            "success": True,
            "audio_url": "/" + audio_path.replace("\\", "/"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ElevenLabs: delete a cloned voice ────────────────────────────────────────
@router.delete("/voice-clone/elevenlabs/{voice_id}")
def delete_elevenlabs_voice(voice_id: str):
    try:
        elevenlabs_service.delete_voice(voice_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── RVC: upload a .pth model (+ optional .index) ─────────────────────────────
@router.post("/voice-clone/rvc/upload")
async def upload_rvc_model(
    model_name: str = Form(...),
    model_file: UploadFile = File(...),
    index_file: UploadFile = File(None),
):
    safe_name = model_name.strip().replace(" ", "_")

    model_path = RVC_MODELS_DIR / f"{safe_name}.pth"
    with open(model_path, "wb") as f:
        shutil.copyfileobj(model_file.file, f)

    index_path = None
    if index_file and index_file.filename:
        index_path = RVC_MODELS_DIR / f"{safe_name}.index"
        with open(index_path, "wb") as f:
            shutil.copyfileobj(index_file.file, f)

    return {
        "success": True,
        "model_name": safe_name,
        "model_path": str(model_path),
        "index_path": str(index_path) if index_path else None,
    }


# ── RVC: list uploaded models ─────────────────────────────────────────────────
@router.get("/voice-clone/rvc/models")
def get_rvc_models():
    return {"success": True, "models": rvc_service.list_models()}
