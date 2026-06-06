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

# ─── Aspect ratio → per-engine size strings ───────────────
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


class ImageGenPayload(BaseModel):
    prompt: str
    character: str = ""
    style: str = "cinematic photorealistic"
    negative_prompt: str = ""
    aspect: str = "widescreen"
    engine: str = "dalle3"  # "dalle3" | "fal_flux" | "comfy"


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
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


# ─── DALL-E 3 ─────────────────────────────────────────────
def _generate_dalle3(prompt: str, aspect: str, style: str) -> dict:
    from openai import OpenAI
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY missing from .env")

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
    return {"imageUrl": output_url, "prompt": revised}


# ─── fal.ai FLUX.1-dev ────────────────────────────────────
def _generate_fal_flux(prompt: str, aspect: str, style: str) -> dict:
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed. Run: pip install fal-client")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY missing from .env — sign up at fal.ai to get a key")

    os.environ["FAL_KEY"] = api_key

    full_prompt = f"{style}: {prompt}" if style and style not in prompt else prompt
    image_size  = FAL_SIZES.get(aspect, "landscape_16_9")

    result = fal_client.run(
        "fal-ai/flux/dev",
        arguments={
            "prompt": full_prompt,
            "image_size": image_size,
            "num_inference_steps": 28,
            "guidance_scale": 3.5,
            "num_images": 1,
            "enable_safety_checker": False,
        },
    )
    image_url   = result["images"][0]["url"]
    image_bytes = _download_url(image_url)
    _, output_url = _save_bytes(image_bytes, prefix="flux")
    return {"imageUrl": output_url, "prompt": full_prompt}


# ─── ComfyUI local ────────────────────────────────────────
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
    return {"imageUrl": out_url, "prompt": result.get("promptUsed", prompt)}


# ─── Route ────────────────────────────────────────────────
@router.post("/image-gen/generate")
async def generate_image(payload: ImageGenPayload):
    engine = payload.engine

    dispatch = {
        "dalle3":   lambda: _generate_dalle3(payload.prompt, payload.aspect, payload.style),
        "fal_flux": lambda: _generate_fal_flux(payload.prompt, payload.aspect, payload.style),
        "comfy":    lambda: _generate_comfy(payload.prompt, payload.aspect, payload.style, payload.character),
    }

    fn = dispatch.get(engine)
    if not fn:
        raise HTTPException(status_code=400, detail=f"Unknown engine: {engine}")

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, fn)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
