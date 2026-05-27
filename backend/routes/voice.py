from fastapi import APIRouter, UploadFile, File, Form
from pathlib import Path
import shutil
import uuid

from backend.services.ffmpeg_service import apply_voice_fx, VOICE_PRESETS

router = APIRouter()

INPUT_DIR = Path("input/voices/uploads")
OUTPUT_DIR = Path("output/voices/processed")

@router.get("/presets")
def get_voice_presets():
    return {
        "available_presets": list(VOICE_PRESETS.keys())
    }

@router.post("/process")
async def process_voice(
    file: UploadFile = File(...),
    preset: str = Form("villain")
):
    file_id = str(uuid.uuid4())
    input_path = INPUT_DIR / f"{file_id}_{file.filename}"
    output_path = OUTPUT_DIR / f"{file_id}_{preset}.wav"

    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with input_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    processed_path = apply_voice_fx(str(input_path), str(output_path), preset)

    output_url = "/" + str(output_path).replace("\\", "/")

    return {
        "status": "processed",
        "preset": preset,
        "input_path": str(input_path),
        "output_path": processed_path,
        "output_url": output_url
    }
