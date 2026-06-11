from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import asyncio
import base64 as _b64
import os
import uuid
import urllib.request

from backend.routes.characters import _get_character

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
    "fal_flux":         "fal-ai/flux/dev",
    "fal_flux_lora":    "fal-ai/flux-lora",
    "fal_flux_schnell": "fal-ai/flux/schnell",
    "fal_flux_pro":     "fal-ai/flux-pro",
    "fal_flux_pro11":   "fal-ai/flux-pro/v1.1",
    "fal_sd3":          "fal-ai/stable-diffusion-v3-medium",
}

# Engines that need a reference image (not in FAL_MODELS standard path)
REFERENCE_ENGINES = {"consistent_character", "instantid"}


class RefImage(BaseModel):
    base64: str
    mediaType: str = "image/jpeg"

class ImageGenPayload(BaseModel):
    prompt: str
    character: str = ""
    character_id: str = ""
    style: str = "cinematic photorealistic"
    negative_prompt: str = ""
    aspect: str = "widescreen"
    engine: str = "fal_flux"
    reference_images:   list[RefImage] = []
    face_references_1:  list[RefImage] = []  # Person 1 face photos
    face_references_2:  list[RefImage] = []  # Person 2 face photos
    # legacy — kept for backward compat; ignored if _1/_2 present
    face_references:    list[RefImage] = []


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
def _generate_fal(prompt: str, aspect: str, style: str, engine: str,
                  lora_url: str = "", lora_trigger: str = "") -> dict:
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed — pip install fal-client")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set. Add it to Railway Variables.")
    os.environ["FAL_KEY"] = api_key

    # If a character LoRA is available, always use the LoRA model
    if lora_url:
        engine   = "fal_flux_lora"
        model_id = FAL_MODELS["fal_flux_lora"]
    else:
        model_id = FAL_MODELS.get(engine, FAL_MODELS["fal_flux"])

    base_prompt = f"{style}: {prompt}" if style and style not in prompt else prompt
    # Prepend the trigger word so the LoRA fires correctly
    full_prompt = f"{lora_trigger}, {base_prompt}" if lora_trigger else base_prompt
    image_size  = FAL_SIZES.get(aspect, "landscape_16_9")
    steps       = 4 if "schnell" in engine else 30

    args = {
        "prompt":                full_prompt,
        "image_size":            image_size,
        "num_inference_steps":   steps,
        "guidance_scale":        3.5,
        "num_images":            1,
        "enable_safety_checker": False,
    }
    if lora_url:
        args["loras"] = [{"path": lora_url, "scale": 1.0}]

    result      = fal_client.run(model_id, arguments=args)
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


# ── Upload bytes to fal.ai storage → returns public URL ──────
def _fal_upload(data: bytes, media_type: str) -> str:
    import fal_client
    return fal_client.upload(data, media_type)


# ── Consistent Character — locks appearance across scenes ────
def _generate_consistent_character(prompt: str, face_refs: list[RefImage], aspect: str) -> dict:
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set")
    os.environ["FAL_KEY"] = api_key

    # Upload the reference image
    primary_bytes = _b64.b64decode(face_refs[0].base64)
    subject_url   = _fal_upload(primary_bytes, face_refs[0].mediaType)

    result = fal_client.run("fal-ai/consistent-character", arguments={
        "subject":           subject_url,
        "prompt":            prompt,
        "num_images":        1,
        "randomize_poses":   False,
        "output_format":     "jpeg",
    })
    img_url     = result["images"][0]["url"]
    image_bytes = _download_url(img_url)
    _, output_url = _save_bytes(image_bytes, prefix="consistent")
    return {"imageUrl": output_url, "prompt": prompt, "engine": "consistent_character", "model": "fal-ai/consistent-character"}


# ── InstantID — high-fidelity single-person face identity ────
def _generate_instantid(prompt: str, face_refs: list[RefImage], aspect: str, style: str) -> dict:
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed — pip install fal-client")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set")
    os.environ["FAL_KEY"] = api_key

    full_prompt = f"{style}: {prompt}" if style and style not in prompt else prompt
    image_size  = FAL_SIZES.get(aspect, "landscape_16_9")

    # Upload the best face reference so InstantID gets a proper URL
    primary_bytes = _b64.b64decode(face_refs[0].base64)
    face_url = _fal_upload(primary_bytes, face_refs[0].mediaType)

    result = fal_client.run("fal-ai/instantid", arguments={
        "face_image_url":       face_url,
        "prompt":               full_prompt,
        "negative_prompt":      "blurry, distorted face, bad anatomy, cartoon, anime",
        "image_size":           image_size,
        "num_inference_steps":  30,
        "guidance_scale":       5.0,
        "ip_adapter_scale":     0.8,
        "controlnet_conditioning_scale": 0.8,
        "num_images":           1,
        "enable_safety_checker": False,
    })
    image_bytes = _download_url(result["images"][0]["url"])
    _, output_url = _save_bytes(image_bytes, prefix="instantid")
    return {"imageUrl": output_url, "prompt": full_prompt, "engine": "instantid", "model": "fal-ai/instantid"}


# ── Face Swap (fal.ai) — paste a face onto an existing image ──
def _face_swap(base_image_path: str, face_ref: RefImage) -> tuple:
    """Returns (saved_path, output_url) of the swapped image."""
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("fal-client not installed — pip install fal-client")

    api_key = os.getenv("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set")
    os.environ["FAL_KEY"] = api_key

    # Upload both images so fal.ai gets proper URLs (not huge data payloads)
    base_bytes = Path(base_image_path).read_bytes()
    base_url   = _fal_upload(base_bytes, "image/png")
    face_bytes = _b64.b64decode(face_ref.base64)
    face_url   = _fal_upload(face_bytes, face_ref.mediaType)

    result = fal_client.run("fal-ai/face-swap", arguments={
        "base_image_url": base_url,
        "swap_image_url": face_url,
    })
    img_url     = (result.get("image") or {}).get("url") or result["images"][0]["url"]
    image_bytes = _download_url(img_url)
    saved_path, output_url = _save_bytes(image_bytes, prefix="faceswap")
    return saved_path, output_url


# ── Reference image prompt enhancement (GPT-4o Vision) ───────
def _enhance_prompt_with_refs(prompt: str, refs: list[RefImage], style: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or not refs:
        return prompt
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        content = [
            {
                "type": "text",
                "text": (
                    f"The user wants to generate an image with this prompt: \"{prompt}\"\n"
                    f"Style: {style}\n\n"
                    "They have provided reference photo(s) below for visual context. "
                    "Analyze the reference(s) — note relevant details like subject appearance, "
                    "colors, lighting, environment, mood, clothing, textures, and composition. "
                    "Return ONLY an enhanced image generation prompt (1-3 sentences) that incorporates "
                    "the key visual details from the references into the user's original intent. "
                    "Do not mention 'the reference photo'. Just output the improved prompt."
                ),
            }
        ]
        for ref in refs[:10]:  # cap at 10 reference images
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{ref.mediaType};base64,{ref.base64}", "detail": "low"},
            })
        resp = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=300,
            messages=[{"role": "user", "content": content}],
        )
        enhanced = resp.choices[0].message.content.strip()
        return enhanced if enhanced else prompt
    except Exception as e:
        print(f"[image-gen] ref enhancement failed: {e}")
        return prompt


# ── Route ─────────────────────────────────────────────────────
@router.post("/image-gen/generate")
async def generate_image(payload: ImageGenPayload):
    engine = payload.engine
    loop   = asyncio.get_event_loop()

    face1  = payload.face_references_1
    face2  = payload.face_references_2

    # ── Face reference path ───────────────────────────────────
    if face1 or face2:
        prompt = payload.prompt
        if payload.reference_images:
            prompt = await loop.run_in_executor(
                None, _enhance_prompt_with_refs, prompt, payload.reference_images, payload.style
            )
        try:
            # Consistent Character — engine-selected, locks appearance across scenes
            if engine == "consistent_character" and face1:
                result = await loop.run_in_executor(
                    None, _generate_consistent_character, prompt, face1, payload.aspect
                )
                return {"success": True, **result}

            # Single person — InstantID (strong face identity)
            if face1 and not face2:
                result = await loop.run_in_executor(
                    None, _generate_instantid, prompt, face1, payload.aspect, payload.style
                )
                return {"success": True, **result}

            # Two people — generate composition then face-swap each person in
            base_engine = engine if engine in FAL_MODELS else "fal_flux"
            base_result = await loop.run_in_executor(
                None, _generate_fal, prompt, payload.aspect, payload.style, base_engine, "", ""
            )
            # base_result["imageUrl"] is like /output/renders/images/flux_....png
            base_path = str(IMAGE_DIR / Path(base_result["imageUrl"]).name)

            # Face swap Person 1 (use first/best reference photo)
            saved_path, swap1_url = await loop.run_in_executor(
                None, _face_swap, base_path, face1[0]
            )

            # Face swap Person 2 on top of Person 1 result
            if face2:
                _, final_url = await loop.run_in_executor(
                    None, _face_swap, saved_path, face2[0]
                )
            else:
                final_url = swap1_url

            return {"success": True, "imageUrl": final_url, "prompt": prompt,
                    "engine": "faceswap-2p", "model": "fal-ai/face-swap"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Enhance prompt with scene reference images if provided
    prompt = payload.prompt
    if payload.reference_images:
        loop = asyncio.get_event_loop()
        prompt = await loop.run_in_executor(
            None, _enhance_prompt_with_refs, prompt, payload.reference_images, payload.style
        )

    # Auto-load character LoRA if character_id is provided
    lora_url = lora_trigger = ""
    if payload.character_id:
        char = await _get_character(payload.character_id)
        if char and char.get("lora_status") == "ready" and char.get("lora_url"):
            lora_url    = char["lora_url"]
            lora_trigger = char.get("lora_trigger", "")

    if engine in FAL_MODELS or (lora_url and engine not in ("dalle3", "comfy")):
        fn = lambda: _generate_fal(prompt, payload.aspect, payload.style,
                                   engine, lora_url, lora_trigger)
    elif engine == "dalle3":
        fn = lambda: _generate_dalle3(prompt, payload.aspect, payload.style)
    elif engine == "comfy":
        fn = lambda: _generate_comfy(prompt, payload.aspect, payload.style, payload.character)
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
            {"id": "consistent_character", "label": "★ Consistent Character",      "provider": "fal.ai", "speed": "fast",   "quality": "best",   "note": "Requires Person 1 face photo — same character every generation"},
            {"id": "fal_flux_lora",        "label": "FLUX LoRA (character-locked)", "provider": "fal.ai", "speed": "fast",   "quality": "best",   "note": "Requires trained LoRA — auto-selected when character has one"},
            {"id": "fal_flux",             "label": "FLUX.1 Dev",                   "provider": "fal.ai", "speed": "fast",   "quality": "high"},
            {"id": "fal_flux_schnell",     "label": "FLUX.1 Schnell",               "provider": "fal.ai", "speed": "turbo",  "quality": "good"},
            {"id": "fal_flux_pro",         "label": "FLUX.1 Pro",                   "provider": "fal.ai", "speed": "medium", "quality": "best"},
            {"id": "fal_flux_pro11",       "label": "FLUX.1 Pro v1.1",             "provider": "fal.ai", "speed": "medium", "quality": "best"},
            {"id": "fal_sd3",              "label": "Stable Diffusion 3",           "provider": "fal.ai", "speed": "medium", "quality": "high"},
            {"id": "dalle3",               "label": "DALL-E 3",                     "provider": "openai", "speed": "medium", "quality": "high"},
            {"id": "comfy",                "label": "ComfyUI (local)",              "provider": "local",  "speed": "varies", "quality": "varies"},
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


@router.delete("/image-gen/gallery/{filename}")
def delete_gallery_image(filename: str):
    # Reject any path traversal attempts
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    target = IMAGE_DIR / filename
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    target.unlink()
    return {"success": True, "deleted": filename}


class FaceSwapPayload(BaseModel):
    image_url:         str               # existing output path e.g. /output/renders/images/flux_....png
    face_references_1: list[RefImage] = []
    face_references_2: list[RefImage] = []


@router.post("/image-gen/face-swap")
async def face_swap_on_image(payload: FaceSwapPayload):
    """Apply face swap to an already-generated image without regenerating it."""
    face1 = payload.face_references_1
    face2 = payload.face_references_2

    if not face1 and not face2:
        raise HTTPException(status_code=400, detail="No face references provided")

    # Resolve local file path from URL like /output/renders/images/flux_....png
    filename = Path(payload.image_url).name
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid image path")
    base_path = str(IMAGE_DIR / filename)
    if not Path(base_path).exists():
        raise HTTPException(status_code=404, detail="Source image not found")

    loop = asyncio.get_event_loop()
    try:
        current_path = base_path

        if face1:
            saved_path, swap_url = await loop.run_in_executor(
                None, _face_swap, current_path, face1[0]
            )
            current_path = saved_path

        if face2:
            _, swap_url = await loop.run_in_executor(
                None, _face_swap, current_path, face2[0]
            )

        return {"success": True, "imageUrl": swap_url, "engine": "faceswap", "model": "fal-ai/face-swap"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
