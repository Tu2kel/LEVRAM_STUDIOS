from fastapi import APIRouter, Form
import subprocess
from pathlib import Path
import uuid

router = APIRouter()

@router.post("/voice-fx")
def voice_fx(
    input_path: str = Form(...),
    preset: str = Form("villain")
):
    input_file = Path(input_path.lstrip("/"))

    output_dir = Path("output/voice_fx")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / f"{preset}_{uuid.uuid4()}.mp3"

    if preset == "villain":
        filter_chain = "rubberband=pitch=0.72,bass=g=12,treble=g=-6,aecho=0.8:0.9:40:0.18"

    elif preset == "deep":
        filter_chain = "asetrate=32000,aresample=44100,bass=g=10"

    else:
        filter_chain = "bass=g=5"

    subprocess.run([
        "ffmpeg",
        "-y",
        "-i", str(input_file),
        "-af", filter_chain,
        str(output_file)
    ], check=True)

    return {
        "status": "fx_applied",
        "preset": preset,
        "input_path": str(input_file),
        "output_path": str(output_file),
        "output_url": "/" + str(output_file).replace("\\", "/")
    }
