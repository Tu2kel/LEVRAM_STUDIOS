"""
Image upscaling service.

Tier 1 (best, cloud): fal.ai real-esrgan (needs FAL_KEY)
Tier 2 (free, local): realesrgan-ncnn-vulkan binary (if installed)
Tier 3 (always works): PIL Lanczos
"""
import shutil
import subprocess
from pathlib import Path


def _try_fal_upscale(input_path: str, output_path: str, scale: int) -> bool:
    """Attempt fal.ai real-esrgan. Returns True on success."""
    import os
    api_key = os.getenv("FAL_KEY")
    if not api_key:
        return False
    try:
        import fal_client
        os.environ["FAL_KEY"] = api_key
        remote_url = fal_client.upload_file(input_path)
        result = fal_client.run(
            "fal-ai/real-esrgan",
            arguments={"image_url": remote_url, "scale": scale, "face_enhance": False},
        )
        image_url = result.get("image", {}).get("url") or ""
        if not image_url:
            return False
        import urllib.request as ur
        ur.urlretrieve(image_url, output_path)
        return Path(output_path).exists()
    except Exception:
        return False


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
    Always succeeds — falls back to local binary then PIL if cloud unavailable.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    if _try_fal_upscale(input_path, output_path, scale):
        return {"engine": "fal-real-esrgan", "scale": scale, "output_path": output_path}

    if _try_realesrgan_binary(input_path, output_path, scale):
        return {"engine": "realesrgan", "scale": scale, "output_path": output_path}

    _upscale_pil(input_path, output_path, scale)
    return {"engine": "pil-lanczos", "scale": scale, "output_path": output_path}
