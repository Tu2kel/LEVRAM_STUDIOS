from fastapi import APIRouter, Form
import subprocess
from pathlib import Path
import uuid
import json

router = APIRouter()

# Pitch:  50–150  (100 = normal, <100 = deeper, >100 = higher)
# Bass:   0–100   (50 = neutral, 0 = -8 dB cut, 100 = +8 dB boost)
# Reverb: 0–100   (0 = dry, 100 = heavy echo)
# Volume: 50–150  (100 = unity gain)

PRESET_DEFAULTS = {
    "villain": dict(pitch=72,  bass=75, reverb=35, volume=105),
    "deep":    dict(pitch=68,  bass=85, reverb=10, volume=100),
    "monster": dict(pitch=62,  bass=70, reverb=55, volume=112),
    "ghost":   dict(pitch=95,  bass=45, reverb=80, volume=90),
    "radio":   dict(pitch=100, bass=40, reverb=0,  volume=88),
    "clean":   dict(pitch=100, bass=50, reverb=0,  volume=100),
}


def probe_sample_rate(filepath: Path) -> int:
    """Read the actual sample rate of the audio file via ffprobe."""
    try:
        result = subprocess.run([
            "ffprobe", "-v", "error",
            "-select_streams", "a:0",
            "-show_entries", "stream=sample_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(filepath)
        ], capture_output=True, text=True, timeout=10)
        sr = result.stdout.strip()
        return int(sr) if sr.isdigit() else 44100
    except Exception:
        return 44100


def build_filter_chain(preset, pitch, bass, reverb, volume, input_sr):
    filters = []

    # ── Pitch: use actual input sample rate so direction is always correct ──
    # asetrate=input_sr*ratio → lower ratio = lower pitch, longer duration
    # aresample=input_sr     → restore to original sample rate
    # atempo=1/ratio         → restore original duration (time-stretch only)
    if pitch != 100:
        ratio = pitch / 100.0
        shifted_rate = int(input_sr * ratio)
        tempo = round(1.0 / ratio, 4)
        filters.append(
            f"asetrate={shifted_rate},aresample={input_sr},atempo={tempo}"
        )

    # ── Bass: 50 = 0 dB (neutral), 0 = -8 dB, 100 = +8 dB ─────────
    bass_db = round((bass - 50) / 50.0 * 8.0, 1)
    if bass_db != 0.0:
        filters.append(f"bass=g={bass_db}")

    # ── Reverb ───────────────────────────────────────────────────────
    if reverb > 0:
        wet = round(reverb / 100.0 * 0.55, 3)
        dry = round(1.0 - wet * 0.35, 3)
        filters.append(f"aecho={dry}:{wet}:60:0.3")

    # ── Radio: narrow bandpass ────────────────────────────────────────
    if preset == "radio":
        filters.append("highpass=f=350,lowpass=f=3200")

    # ── Volume ───────────────────────────────────────────────────────
    if volume != 100:
        db = round((volume - 100) / 10.0, 2)
        filters.append(f"volume={db:+.2f}dB")

    return ",".join(filters) if filters else "anull"


@router.post("/voice-fx")
def voice_fx(
    input_path: str = Form(...),
    preset: str = Form("villain"),
    pitch: int = Form(None),
    bass: int = Form(None),
    reverb: int = Form(None),
    volume: int = Form(None),
):
    input_file = Path(input_path.lstrip("/"))

    output_dir = Path("output/voice_fx")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / f"{preset}_{uuid.uuid4()}.mp3"

    # Probe actual sample rate — critical for correct pitch shift direction
    input_sr = probe_sample_rate(input_file)

    # Slider values take priority; fall back to preset defaults
    defaults = PRESET_DEFAULTS.get(preset, PRESET_DEFAULTS["clean"])
    p = pitch  if pitch  is not None else defaults["pitch"]
    b = bass   if bass   is not None else defaults["bass"]
    r = reverb if reverb is not None else defaults["reverb"]
    v = volume if volume is not None else defaults["volume"]

    filter_chain = build_filter_chain(preset, p, b, r, v, input_sr)

    print(f"VOICE FX [{preset}] input_sr={input_sr}Hz pitch={p} bass={b} reverb={r} volume={v}")
    print(f"FILTER CHAIN: {filter_chain}")

    subprocess.run([
        "ffmpeg", "-y",
        "-i", str(input_file),
        "-af", filter_chain,
        "-ar", "44100",      # Force consistent output sample rate
        str(output_file)
    ], check=True)

    return {
        "status": "fx_applied",
        "preset": preset,
        "input_sr": input_sr,
        "filters": filter_chain,
        "output_url": "/" + str(output_file).replace("\\", "/")
    }
