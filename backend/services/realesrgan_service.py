"""
Image upscaling service.

Tier 1 (free, best):   realesrgan-ncnn-vulkan binary (if installed)
Tier 2 (free, decent): PIL Lanczos (always available)
Tier 3 (paid stub):    Topaz Gigapixel API (needs TOPAZ_API_KEY)
"""
import shutil
import subprocess
from pathlib import Path


def _try_realesrgan_binary(input_path: str, output_path: str, scale: int) -> bool:
    """Attempt real-ESRGAN ncnn binary. Returns True on success."""
    binary = shutil.which("realesrgan-ncnn-vulkan")
    if not binary:
        return False
    try:
        result = subprocess.run(
            [binary, "-i", input_path, "-o", output_path, "-s", str(scale),
             "-n", "realesr-animevideov3"],
            capture_output=True, timeout=300
        )
        return result.returncode == 0 and Path(output_path).exists()
    except Exception:
        return False


def _upscale_pil(input_path: str, output_path: str, scale: int) -> None:
    """PIL Lanczos fallback — always works, no extra install."""
    from PIL import Image
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    img = img.resize((w * scale, h * scale), Image.LANCZOS).convert("RGB")
    img.save(output_path, "PNG")


def upscale(input_path: str, output_path: str, scale: int = 4) -> dict:
    """
    Upscale an image. Returns {engine, scale, output_path}.
    Always succeeds — falls back to PIL if no AI upscaler is installed.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    if _try_realesrgan_binary(input_path, output_path, scale):
        return {"engine": "realesrgan", "scale": scale, "output_path": output_path}

    _upscale_pil(input_path, output_path, scale)
    return {"engine": "pil-lanczos", "scale": scale, "output_path": output_path}
