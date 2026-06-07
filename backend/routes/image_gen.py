from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import asyncio
import os
import uuid
import urllib.request

router = APIRouter()

IMAGE_DIR = Path("output/renders/images")

# ── Aspect ratio maps ──────────────────────────────────────────
DALLE_SIZES = {
    "widescreen": "1792x1024",
    "cinematic":  "1792x1024",
    "portrait":   "1024x1792",
    "square":     "1024x1024",
}

FAL_SIZES = {
    "widescreen": "landscape_16_9",
    "cinematic":  "landscape_16_9",
    "portrait":   "portrait_16_9",
    "square":     "square_hd",
}

COMFY_SIZES = {
    "widescreen": (768, 512),
    "cinematic":  (896, 384),
    "portrait":   (512, 768),
    "square":     (512, 512),
}

# fal.ai model IDs
FAL_MODELS = {
    "fal_flux":         "fal-ai/flux/dev",          # default — best quality/speed balance
    "fal_flux_schnell": "fal-ai/flux/schnell",       # 4-step turbo, fastest
    "fal_flux_pro":     "fal-ai/flux-pro",           # highest fidelity
    "fal_flux_pro11":   "fal-ai/flux-pro/v1.1",      # pro latest
    "fal_sd3":          "fal-ai/stable-diffusion-v3-medium",
}


class ImageGenPayload(BaseModel):
    prompt: str
    character: str = ""
    style: str = "cinematic photorealistic"
    negative_prompt: str = ""
    aspect: str = "widescreen"
    # fal_flux is now the default lead engine
    engine: str = "fal_flux"   # fal_flux | fal_flux_schnell | fal_flux_pro | dalle3 | comfy


def _save_bytes(image_bytes: bytes, prefix: str = "levram") -> tuple[str, str]:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    rid = uuid.uuid4().hex[:8]
    filename = f"{prefix}_{ts}_{rid}.png"
    path = IMAGE_DIR / filename
    path.write_bytes(image_bytes)
    return str(path), "/output/renders/images/" + filename


def _download_url(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "LEVRAM/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


# ── fal.ai (FLUX family + SD3) ────────────────────────────────
def _generate_fal(prompt: str, aspect: str, style: str, engine: str) -> dict:
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed — pip install fal-client")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set. Add it to Railway Variables.")
    os.environ["FAL_KEY"] = api_key

    model_id = FAL_MODELS.get(engine, FAL_MODELS["fal_flux"])
    full_prompt = f"{style}: {prompt}" if style and style not in prompt else prompt
    image_size  = FAL_SIZES.get(aspect, "landscape_16_9")

    # schnell uses fewer steps
    steps = 4 if "schnell" in engine else 28
    guidance = 3.5

    result = fal_client.run(
        model_id,
        arguments={
            "prompt": full_prompt,
            "image_size": image_size,
            "num_inference_steps": steps,
            "guidance_scale": guidance,
            "num_images": 1,
            "enable_safety_checker": False,
        },
    )
    image_url   = result["images"][0]["url"]
    image_bytes = _download_url(image_url)
    prefix      = engine.replace("fal_", "")
    _, output_url = _save_bytes(image_bytes, prefix=prefix)
    return {"imageUrl": output_url, "prompt": full_prompt, "engine": engine, "model": model_id}


# ── DALL-E 3 (fallback when OpenAI key present, no fal key) ──
def _generate_dalle3(prompt: str, aspect: str, style: str) -> dict:
    from openai import OpenAI
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set.")

    full_prompt = f"{style}: {prompt}" if style and style not in prompt else prompt
    size = DALLE_SIZES.get(aspect, "1792x1024")

    client = OpenAI(api_key=api_key)
    resp = client.images.generate(
        model="dall-e-3",
        prompt=full_prompt,
        size=size,
        quality="standard",
        n=1,
    )
    image_url = resp.data[0].url
    revised   = resp.data[0].revised_prompt or full_prompt
    image_bytes = _download_url(image_url)
    _, output_url = _save_bytes(image_bytes, prefix="dalle3")
    return {"imageUrl": output_url, "prompt": revised, "engine": "dalle3", "model": "dall-e-3"}


# ── ComfyUI local ─────────────────────────────────────────────
def _generate_comfy(prompt: str, aspect: str, style: str, character: str) -> dict:
    from backend.services.comfy_service import generate_comfy_keyframe
    w, h = COMFY_SIZES.get(aspect, (768, 512))
    queue_item = {
        "id": str(uuid.uuid4()),
        "shotId": f"imagegen-{uuid.uuid4().hex[:8]}",
        "shot": {
            "character":   character or "",
            "shotDesc":    prompt,
            "shotPrompt":  prompt,
            "renderStyle": style,
            "scene":       "Image Gen",
            "shot_number": "IMAGE-GEN",
        },
    }
    result = generate_comfy_keyframe(queue_item, width=w, height=h)
    out_url = result.get("outputUrl") or ("/" + result.get("outputPath", ""))
    return {"imageUrl": out_url, "prompt": result.get("promptUsed", prompt), "engine": "comfy", "model": "comfyui"}


# ── Route ─────────────────────────────────────────────────────
@router.post("/image-gen/generate")
async def generate_image(payload: ImageGenPayload):
    engine = payload.engine

    if engine in FAL_MODELS:
        fn = lambda: _generate_fal(payload.prompt, payload.aspect, payload.style, engine)
    elif engine == "dalle3":
        fn = lambda: _generate_dalle3(payload.prompt, payload.aspect, payload.style)
    elif engine == "comfy":
        fn = lambda: _generate_comfy(payload.prompt, payload.aspect, payload.style, payload.character)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown engine: {engine}")

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, fn)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/image-gen/models")
def list_models():
    """Return available image generation engines."""
    return {
        "success": True,
        "default": "fal_flux",
        "engines": [
            {"id": "fal_flux",         "label": "FLUX.1 Dev",        "provider": "fal.ai",  "speed": "fast",    "quality": "high"},
            {"id": "fal_flux_schnell", "label": "FLUX.1 Schnell",    "provider": "fal.ai",  "speed": "turbo",   "quality": "good"},
            {"id": "fal_flux_pro",     "label": "FLUX.1 Pro",        "provider": "fal.ai",  "speed": "medium",  "quality": "best"},
            {"id": "fal_flux_pro11",   "label": "FLUX.1 Pro v1.1",   "provider": "fal.ai",  "speed": "medium",  "quality": "best"},
            {"id": "fal_sd3",          "label": "Stable Diffusion 3","provider": "fal.ai",  "speed": "medium",  "quality": "high"},
            {"id": "dalle3",           "label": "DALL-E 3",          "provider": "openai",  "speed": "medium",  "quality": "high"},
            {"id": "comfy",            "label": "ComfyUI (local)",   "provider": "local",   "speed": "varies",  "quality": "varies"},
        ],
    }


@router.get("/image-gen/gallery")
def get_gallery():
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    images = sorted(IMAGE_DIR.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {
        "success": True,
        "images": [
            {
                "url":      "/output/renders/images/" + f.name,
                "filename": f.name,
                "created":  datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
                "engine":   f.name.split("_")[0] if "_" in f.name else "unknown",
            }
            for f in images[:60]
        ],
    }
