import asyncio
import uuid
from pathlib import Path
import edge_tts

OUTPUT_DIR = Path("output/tts")

VOICE_MAP = {
    "Hulk": "en-US-GuyNeural",
    "Narrator": "en-US-ChristopherNeural",
    "Female": "en-US-JennyNeural"
}

async def _generate(text: str, voice: str, output_path: str):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_path)

def generate_tts(text: str, character: str = "Narrator") -> str:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    file_id = str(uuid.uuid4())
    output_path = OUTPUT_DIR / f"{character}_{file_id}.mp3"

    voice = VOICE_MAP.get(character, "en-US-GuyNeural")

    asyncio.run(_generate(text, voice, str(output_path)))

    return str(output_path)
