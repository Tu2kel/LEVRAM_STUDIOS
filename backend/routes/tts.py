from fastapi import APIRouter, Form
from backend.services.spark_tts_service import generate_tts

router = APIRouter()

@router.post("/generate")
def tts_generate(
    text: str = Form(...),
    character: str = Form("default")
):
    output_path = generate_tts(text, character)

    output_url = "/" + output_path.replace("\\", "/")

    return {
        "status": "generated",
        "engine": "Spark-TTS",
        "character": character,
        "text": text,
        "output_path": output_path,
        "output_url": output_url
    }
