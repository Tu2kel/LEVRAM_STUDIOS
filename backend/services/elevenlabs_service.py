import os
from pathlib import Path
from elevenlabs.client import ElevenLabs
from elevenlabs import VoiceSettings
import uuid

_client = None

def _get_client():
    global _client
    if _client is None:
        key = os.getenv("ELEVENLABS_API_KEY", "")
        if not key:
            raise RuntimeError("ELEVENLABS_API_KEY not set in .env")
        _client = ElevenLabs(api_key=key)
    return _client


def generate_tts(text: str, voice_id: str, output_dir: Path = None) -> str:
    client = _get_client()
    if output_dir is None:
        output_dir = Path("output/tts")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / f"el_{uuid.uuid4()}.mp3"

    audio = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id="eleven_multilingual_v2",
        voice_settings=VoiceSettings(
            stability=0.5,
            similarity_boost=0.75,
            style=0.0,
            use_speaker_boost=True,
        ),
        output_format="mp3_44100_128",
    )

    with open(output_path, "wb") as f:
        for chunk in audio:
            if chunk:
                f.write(chunk)

    return str(output_path)


def clone_voice(name: str, audio_path: str) -> str:
    """Upload a voice sample and return the new voice_id."""
    client = _get_client()
    with open(audio_path, "rb") as f:
        voice = client.voices.add(
            name=name,
            files=[f],
            description=f"LEVRAM character voice: {name}",
        )
    return voice.voice_id


def list_voices() -> list:
    client = _get_client()
    response = client.voices.get_all()
    return [
        {
            "voice_id":    v.voice_id,
            "name":        v.name,
            "category":    v.category,
            "preview_url": v.preview_url or "",
        }
        for v in response.voices
    ]


def delete_voice(voice_id: str) -> bool:
    client = _get_client()
    client.voices.delete(voice_id)
    return True
