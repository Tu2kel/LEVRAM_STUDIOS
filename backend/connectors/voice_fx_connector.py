import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def process_dark_villain(input_file, output_file):
    input_path = ROOT / input_file
    output_path = ROOT / output_file
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-filter:a",
        "asetrate=44100*0.85,aresample=44100,atempo=1.12,aecho=0.8:0.88:80:0.25",
        str(output_path)
    ]

    subprocess.run(cmd, check=True)
    return str(output_path)

if __name__ == "__main__":
    process_dark_villain(
        "input/voices/wally/raw/line_001.wav",
        "input/voices/wally/processed/line_001_dark.wav"
    )
