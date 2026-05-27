import subprocess
from pathlib import Path

VOICE_PRESETS = {
    "villain": "rubberband=pitch=0.82,chorus=0.5:0.8:40:0.25:0.2:2,volume=1.2",
    "deep": "rubberband=pitch=0.75,volume=1.25",
    "monster": "rubberband=pitch=0.65,chorus=0.8:0.9:55:0.4:0.25:2,volume=1.3",
    "ghost": "aecho=0.8:0.88:700:0.4,volume=1.1",
    "radio": "highpass=f=300,lowpass=f=3000,volume=1.4",
    "clean": "volume=1.0"
}

def apply_voice_fx(input_path: str, output_path: str, preset: str = "villain") -> str:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    fx = VOICE_PRESETS.get(preset, VOICE_PRESETS["villain"])

    command = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-af", fx,
        output_path
    ]

    subprocess.run(command, check=True)
    return output_path
