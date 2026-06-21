from fastapi import APIRouter, Header, HTTPException
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

# ── Provider flag ─────────────────────────────────────────────
FAL_DISABLED = False  # fal.ai temporarily active — draining remaining credits

# ── WaveSpeed ─────────────────────────────────────────────────
WAVESPEED_API_BASE = "https://api.wavespeed.ai/api/v3"

WS_IMG_SIZES = {
    "widescreen": {"width": 1280, "height": 720},
    "cinematic":  {"width": 1280, "height": 544},
    "portrait":   {"width": 720,  "height": 1280},
    "square":     {"width": 1024, "height": 1024},
}

WS_IMG_MODELS = {
    "ws_flux":             "wavespeed-ai/flux-dev",
    "ws_flux_schnell":     "wavespeed-ai/flux-schnell",
    "ws_flux_ultra":       "wavespeed-ai/flux-dev-ultra-fast",
    "ws_flux2":            "wavespeed-ai/flux-2-dev/text-to-image",
    "ws_flux_pro":         "wavespeed-ai/flux-1.1-pro",
    "ws_pulid":            "wavespeed-ai/flux-pulid",
    "ws_flux_uncensored":  "wavespeed-ai/flux-dev",              # No spicy image model — safety checker off handles it
}

# fal.ai model IDs (standby — do not route here while FAL_DISABLED)
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


def _save_bytes(image_bytes: bytes, prefix: str = "levram", studio: str = "levram") -> tuple[str, str]:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
    rid = uuid.uuid4().hex[:8]
    scope = "rl_" if studio == "redlight" else ""
    filename = f"{scope}{prefix}_{ts}_{rid}.png"
    path = IMAGE_DIR / filename
    path.write_bytes(image_bytes)
    return str(path), "/output/renders/images/" + filename


def _download_url(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "LEVRAM/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


# ══════════════════════════════════════════════════════════════
# WaveSpeed — Primary image provider
# ══════════════════════════════════════════════════════════════

def _ws_to_public_url(b64data: str, media_type: str, prefix: str = "ref") -> str:
    """Save base64 bytes to output dir and return a public Railway URL."""
    import json as _json
    ext      = "jpg" if "jpeg" in media_type else media_type.split("/")[-1]
    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.{ext}"
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    (IMAGE_DIR / filename).write_bytes(_b64.b64decode(b64data))
    domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    if not domain:
        raise RuntimeError("RAILWAY_PUBLIC_DOMAIN not set — WaveSpeed needs a public image URL")
    return f"https://{domain}/output/renders/images/{filename}"


def _ws_submit_poll(model_id: str, payload: dict, timeout_secs: int = 120) -> list:
    """Submit to WaveSpeed, poll until complete. Returns list of output URLs."""
    import json, time, urllib.error
    api_key = os.getenv("WAVESPEED_KEY")
    if not api_key:
        raise RuntimeError("WAVESPEED_KEY not set")

    submit_url = f"{WAVESPEED_API_BASE}/{model_id}"
    data = json.dumps(payload).encode()
    print(f"[WS] POST {submit_url}  payload={json.dumps(payload)[:300]}")
    req  = urllib.request.Request(
        submit_url,
        data=data,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            submit = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"WaveSpeed {e.code} on {model_id}: {body[:400]}")

    pred_id = (submit.get("data") or {}).get("id") or submit.get("id")
    if not pred_id:
        raise RuntimeError(f"WaveSpeed returned no prediction ID: {submit}")

    for _ in range(timeout_secs):
        time.sleep(1)
        poll_req = urllib.request.Request(
            f"{WAVESPEED_API_BASE}/predictions/{pred_id}/result",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(poll_req, timeout=30) as r:
            poll = json.loads(r.read())

        pdata  = poll.get("data") or {}
        status = pdata.get("status", "")
        if status == "completed":
            return pdata.get("outputs") or []
        if status in ("failed", "error", "cancelled"):
            raise RuntimeError(f"WaveSpeed {status}: {pdata.get('error', 'unknown')}")

    raise RuntimeError("WaveSpeed image generation timed out")


def _ws_generate_image(prompt: str, aspect: str, style: str,
                       engine: str = "ws_flux", lora_url: str = "", lora_trigger: str = "",
                       studio: str = "levram") -> dict:
    model_id    = WS_IMG_MODELS.get(engine, WS_IMG_MODELS["ws_flux"])
    size        = WS_IMG_SIZES.get(aspect, WS_IMG_SIZES["widescreen"])
    full_prompt = f"{lora_trigger} {prompt}".strip() if lora_trigger else prompt
    if style:
        full_prompt = f"{full_prompt}, {style}"

    is_schnell = "schnell" in engine
    payload = {
        "prompt":                 full_prompt,
        "width":                  size["width"],
        "height":                 size["height"],
        "num_inference_steps":    4 if is_schnell else 28,
        "guidance_scale":         0.0 if is_schnell else 3.5,
        "enable_safety_checker":  False,
        "seed":                   -1,
    }
    if lora_url:
        payload["loras"] = [{"path": lora_url, "scale": 0.9}]

    outputs = _ws_submit_poll(model_id, payload)
    if not outputs:
        raise RuntimeError("WaveSpeed returned no image")

    image_bytes = _download_url(outputs[0])
    _, output_url = _save_bytes(image_bytes, prefix=engine.replace("ws_", "ws"), studio=studio)
    return {"imageUrl": output_url, "prompt": prompt, "engine": engine, "model": model_id}


def _ws_pulid(prompt: str, face_refs: list, aspect: str, style: str = "", studio: str = "levram") -> dict:
    """WaveSpeed FLUX PuLID — character-locked generation from face reference."""
    face_url    = _ws_to_public_url(face_refs[0].base64, face_refs[0].mediaType, prefix="pulid")
    size        = WS_IMG_SIZES.get(aspect, WS_IMG_SIZES["widescreen"])
    full_prompt = f"{prompt}, {style}" if style else prompt

    outputs = _ws_submit_poll("wavespeed-ai/flux-pulid", {
        "prompt":              full_prompt,
        "image":               face_url,
        "width":               size["width"],
        "height":              size["height"],
        "num_inference_steps": 28,
        "guidance_scale":      3.5,
        "true_cfg":            1.0,
    })
    if not outputs:
        raise RuntimeError("WaveSpeed PuLID returned no image")

    image_bytes = _download_url(outputs[0])
    _, output_url = _save_bytes(image_bytes, prefix="pulid", studio=studio)
    return {"imageUrl": output_url, "prompt": prompt, "engine": "ws_pulid", "model": "wavespeed-ai/flux-pulid"}


def _ws_seedream_edit(prompt: str, body_ref_urls: list, studio: str = "levram") -> list:
    """WaveSpeed Seedream Edit Sequential — full body character consistency.

    Passes a reference image to Seedream which locks the character's complete
    appearance (face, outfit, hair, body proportions) while generating a new
    scene described by the prompt.
    """
    outputs = _ws_submit_poll("bytedance/seedream-v5.0-lite/edit-sequential", {
        "prompt":     f"1 image. Show Figure 1 in the following scene: {prompt}. Preserve the character's exact appearance, face, outfit, and features.",
        "images":     body_ref_urls,
        "max_images": 1,
    }, timeout_secs=180)
    if not outputs:
        raise RuntimeError("WaveSpeed Seedream Edit returned no image")
    return outputs


def _ws_face_swap(base_image_path: str, face_ref, studio: str = "levram") -> tuple:
    """WaveSpeed face swap — replace face in base image with reference face."""
    import base64 as _b64mod
    base_b64 = _b64mod.b64encode(Path(base_image_path).read_bytes()).decode()
    base_url = _ws_to_public_url(base_b64, "image/png", prefix="swap_base")
    face_url = _ws_to_public_url(face_ref.base64, face_ref.mediaType, prefix="swap_face")

    outputs = _ws_submit_poll("wavespeed-ai/image-face-swap", {
        "image":      base_url,
        "face_image": face_url,
    })
    if not outputs:
        raise RuntimeError("WaveSpeed face swap returned no image")

    image_bytes = _download_url(outputs[0])
    saved_path, output_url = _save_bytes(image_bytes, prefix="faceswap", studio=studio)
    return saved_path, output_url


# ── fal.ai (FLUX family + SD3) — STANDBY while FAL_DISABLED ──
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
    imgs_fal    = result.get("images") or []
    if not imgs_fal:
        raise RuntimeError(f"fal.ai returned no images: {result}")
    image_url   = imgs_fal[0].get("url") or imgs_fal[0].get("image_url") or imgs_fal[0]
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


# ── Venice.ai image generation ────────────────────────────────
VENICE_KEY      = os.getenv("VENICE_API_KEY", "")
VENICE_IMG_BASE = "https://api.venice.ai/api/v1"

VENICE_IMG_SIZES = {
    "widescreen": (1280, 720),
    "cinematic":  (1280, 544),
    "portrait":   (720,  1280),
    "square":     (1024, 1024),
}

def _venice_generate_image(prompt: str, aspect: str, style: str, studio: str = "levram") -> dict:
    import json as _json, urllib.error
    if not VENICE_KEY:
        raise RuntimeError("VENICE_API_KEY not set")

    w, h = VENICE_IMG_SIZES.get(aspect, VENICE_IMG_SIZES["widescreen"])
    full_prompt = f"{prompt}, {style}".strip(", ") if style else prompt

    body = _json.dumps({
        "model":           "venice-sd35",
        "prompt":          full_prompt,
        "negative_prompt": "blurry, low quality, watermark, censored, blur",
        "width":           w,
        "height":          h,
        "steps":           25,
        "cfg_scale":       7.5,
        "safe_mode":       False,
    }).encode()

    req = urllib.request.Request(
        f"{VENICE_IMG_BASE}/image/generate",
        data=body,
        headers={
            "Authorization": f"Bearer {VENICE_KEY}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = _json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Venice {e.code}: {body_err[:400]}")

    # Venice proprietary endpoint returns {images: [{b64_json: ...}]}
    # Venice OpenAI-compat endpoint returns {data: [{b64_json: ...}]}
    images = data.get("images") or data.get("data") or []
    if not images:
        raise RuntimeError(f"Venice returned no images: {data}")

    entry = images[0]
    if isinstance(entry, dict):
        raw = entry.get("b64_json") or entry.get("b64") or entry.get("base64") or ""
        if not raw and entry.get("url", "").startswith("data:"):
            raw = entry["url"].split(",", 1)[-1]
    else:
        raw = entry if isinstance(entry, str) else ""
    if not raw:
        raise RuntimeError(f"Venice image entry unreadable: {entry}")
    image_bytes = _b64.b64decode(raw)
    _, out_url = _save_bytes(image_bytes, prefix="venice", studio=studio)
    return {"imageUrl": out_url, "prompt": full_prompt, "engine": "venice_flux", "model": "venice-sd35"}


def _venice_body_ref(prompt: str, body_ref_bytes: bytes, aspect: str = "cinematic", studio: str = "levram") -> dict:
    """Venice plain gen with character-preserving prompt — body-ref fallback when Seedream is dry.
    Venice doesn't support reference image conditioning, so we enrich the prompt and generate."""
    return _venice_generate_image(prompt, aspect, "cinematic photorealistic", studio=studio)


def _novita_body_ref(prompt: str, body_ref_bytes: bytes, aspect: str = "cinematic", studio: str = "levram") -> dict:
    """Novita img2img — body/character consistency via denoising init image."""
    import json as _json, time, base64 as _b64n, urllib.error
    if not NOVITA_KEY:
        raise RuntimeError("NOVITA_API_KEY not set")

    w, h = NOVITA_IMG_SIZES.get(aspect, NOVITA_IMG_SIZES["cinematic"])
    b64_str = _b64n.b64encode(body_ref_bytes).decode()
    full    = f"Preserve the character's exact appearance, outfit, face, and features. {prompt}, cinematic photorealistic"

    body = _json.dumps({
        "extra": {"response_image_type": "jpeg"},
        "request": {
            "model_name":          "epicphotogasm_xPlusPlus_135412.safetensors",
            "prompt":              full,
            "negative_prompt":     "blurry, low quality, watermark, different outfit, different person, bad anatomy",
            "width":               w,
            "height":              h,
            "image_num":           1,
            "steps":               25,
            "seed":                -1,
            "guidance_scale":      7.5,
            "sampler_name":        "Euler a",
            "image_base64":        b64_str,
            "strength":            0.60,
        }
    }).encode()

    headers = {"Authorization": f"Bearer {NOVITA_KEY}", "Content-Type": "application/json"}
    req = urllib.request.Request(f"{NOVITA_IMG_BASE}/img2img", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            submit = _json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Novita img2img submit {e.code}: {e.read().decode()[:300]}")

    task_id = submit.get("task_id")
    if not task_id:
        raise RuntimeError(f"Novita img2img no task_id: {submit}")

    for _ in range(120):
        time.sleep(1)
        poll = urllib.request.Request(
            f"https://api.novita.ai/v3/async/task-result?task_id={task_id}",
            headers={"Authorization": f"Bearer {NOVITA_KEY}"},
        )
        with urllib.request.urlopen(poll, timeout=20) as r:
            result = _json.loads(r.read())
        status = result.get("task", {}).get("status", "")
        if status == "TASK_STATUS_SUCCEED":
            imgs = result.get("images") or []
            if not imgs:
                raise RuntimeError("Novita img2img succeeded but returned no images")
            img_url = imgs[0].get("image_url") or imgs[0].get("url") or imgs[0]
            img_bytes = _download_url(img_url)
            _, out_url = _save_bytes(img_bytes, prefix="novita_bodyref", studio=studio)
            return {"imageUrl": out_url, "prompt": full, "engine": "novita_bodyref", "model": "epicphotogasm_xPlusPlus"}
        if status in ("TASK_STATUS_FAILED", "TASK_STATUS_CANCELED"):
            raise RuntimeError(f"Novita img2img {status}: {result}")

    raise RuntimeError("Novita img2img timed out")


# ── NovitaAI — uncensored adult content, FLUX + Pony models ──
NOVITA_KEY      = os.getenv("NOVITA_API_KEY", "")
NOVITA_IMG_BASE = "https://api.novita.ai/v3/async"

NOVITA_MODELS = {
    "novita_pro":     "epicphotogasm_x_131265.safetensors",              # explicit photorealistic
    "novita_photo":   "epicphotogasm_xPlusPlus_135412.safetensors",      # explicit photorealistic ++
    "novita_realism": "epicrealism_naturalSinRC1VAE_106430.safetensors", # photorealistic
    "novita_anime":   "meinahentai_v4_70340.safetensors",                # anime NSFW
    "novita_asian":   "majicmixRealistic_v6_65516.safetensors",           # Asian photorealism
    "novita_hybrid":  "revAnimated_v122.safetensors",                      # anime-realistic hybrid
    # Legacy aliases
    "novita_flux":    "epicphotogasm_xPlusPlus_135412.safetensors",
    "novita_pony":    "epicphotogasm_x_131265.safetensors",
}

NOVITA_IMG_SIZES = {
    "widescreen": (768, 512),
    "cinematic":  (768, 432),
    "portrait":   (512, 768),
    "square":     (512, 512),
}

def _novita_generate_image(prompt: str, aspect: str, style: str,
                           engine: str = "novita_photo", studio: str = "levram") -> dict:
    import json as _json, time, urllib.error
    if not NOVITA_KEY:
        raise RuntimeError("NOVITA_API_KEY not set")

    model   = NOVITA_MODELS.get(engine, NOVITA_MODELS["novita_flux"])
    w, h    = NOVITA_IMG_SIZES.get(aspect, NOVITA_IMG_SIZES["widescreen"])
    full    = f"{prompt}, {style}".strip(", ") if style else prompt
    is_flux = "flux" in engine

    body = _json.dumps({
        "extra": {"response_image_type": "jpeg"},
        "request": {
            "model_name":      model,
            "prompt":          full,
            "negative_prompt": "" if is_flux else "blurry, low quality, watermark, censored",
            "width":           w,
            "height":          h,
            "image_num":       1,
            "steps":           20,
            "seed":            -1,
            "clip_skip":       1,
            "guidance_scale":  7.5,
            "sampler_name":    "Euler a",
            "loras":           [],
            "embeddings":      [],
        }
    }).encode()

    headers = {
        "Authorization": f"Bearer {NOVITA_KEY}",
        "Content-Type":  "application/json",
    }

    req = urllib.request.Request(f"{NOVITA_IMG_BASE}/txt2img", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            submit = _json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Novita submit {e.code}: {e.read().decode()[:300]}")

    task_id = submit.get("task_id")
    if not task_id:
        raise RuntimeError(f"Novita returned no task_id: {submit}")

    # Poll until done
    for _ in range(120):
        time.sleep(1)
        poll_req = urllib.request.Request(
            f"https://api.novita.ai/v3/async/task-result?task_id={task_id}",
            headers={"Authorization": f"Bearer {NOVITA_KEY}"},
        )
        with urllib.request.urlopen(poll_req, timeout=20) as r:
            result = _json.loads(r.read())
        status = result.get("task", {}).get("status", "")
        if status == "TASK_STATUS_SUCCEED":
            imgs = result.get("images") or []
            if not imgs:
                raise RuntimeError("Novita succeeded but returned no images")
            img_url = imgs[0].get("image_url") or imgs[0].get("url") or imgs[0]
            print(f"[Novita] image record: {imgs[0]}")
            image_bytes = _download_url(img_url)
            _, out_url  = _save_bytes(image_bytes, prefix=f"novita_{engine.split('_')[-1]}", studio=studio)
            return {"imageUrl": out_url, "prompt": full, "engine": engine, "model": model}
        if status in ("TASK_STATUS_FAILED", "TASK_STATUS_CANCELED"):
            raise RuntimeError(f"Novita task {status}: {result}")

    raise RuntimeError("Novita generation timed out")


# ── Upload bytes to fal.ai storage → returns public URL ──────
def _fal_upload(data: bytes, media_type: str) -> str:
    import fal_client
    return fal_client.upload(data, media_type)


# ── Consistent Character — locks appearance across scenes ────
def _generate_consistent_character(prompt: str, face_refs: list[RefImage], aspect: str, style: str = "") -> dict:
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

    full_prompt = f"{style}: {prompt}" if style and style not in prompt else prompt
    image_size = FAL_SIZES.get(aspect, "landscape_16_9")
    result = fal_client.run("fal-ai/flux-pulid", arguments={
        "reference_image_url": subject_url,
        "prompt":              full_prompt,
        "image_size":          image_size,
        "num_inference_steps": 35,
        "guidance_scale":      6.0,
        "id_weight":           0.8,
        "negative_prompt":     "cartoon, illustration, stylized, anime, unrealistic, extra fingers, too many fingers, six fingers, fused fingers, deformed hands, mutated hands, malformed hands",
        "enable_safety_checker": False,
    })
    imgs        = result.get("images") or []
    img_url     = (imgs[0].get("url") if imgs else None) or result.get("image", {}).get("url") or ""
    if not img_url:
        raise RuntimeError(f"No image URL from flux-pulid: {list(result.keys())}")
    image_bytes = _download_url(img_url)
    _, output_url = _save_bytes(image_bytes, prefix="consistent")
    return {"imageUrl": output_url, "prompt": prompt, "engine": "consistent_character", "model": "fal-ai/flux-pulid"}


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
    imgs = result.get("images") or []
    if not imgs:
        raise RuntimeError(f"InstantID returned no images: {result}")
    image_bytes = _download_url(imgs[0].get("url") or imgs[0].get("image_url") or imgs[0])
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
async def generate_image(payload: ImageGenPayload, x_studio: str = Header(default="levram")):
    engine = payload.engine
    loop   = asyncio.get_event_loop()

    face1  = payload.face_references_1
    face2  = payload.face_references_2

    # ── Face reference path ───────────────────────────────────
    # Novita and Venice are txt2img-only — skip face-ref routing entirely
    _FACE_REF_ENGINES = not (engine in NOVITA_MODELS or engine == "venice_flux")
    if (face1 or face2) and _FACE_REF_ENGINES:
        prompt = payload.prompt
        if payload.reference_images:
            prompt = await loop.run_in_executor(
                None, _enhance_prompt_with_refs, prompt, payload.reference_images, payload.style
            )
        try:
            if FAL_DISABLED:
                # Single person — WaveSpeed PuLID
                if face1 and not face2:
                    result = await loop.run_in_executor(
                        None, _ws_pulid, prompt, face1, payload.aspect, payload.style, x_studio
                    )
                    return {"success": True, **result}

                # Two people — cheap base image then face swap each person in
                base_result = await loop.run_in_executor(
                    None, _ws_generate_image, prompt, payload.aspect, payload.style, "ws_flux", "", "", x_studio
                )
                base_path  = str(IMAGE_DIR / Path(base_result["imageUrl"]).name)
                saved_path, swap1_url = await loop.run_in_executor(
                    None, _ws_face_swap, base_path, face1[0], x_studio
                )
                if face2:
                    _, final_url = await loop.run_in_executor(
                        None, _ws_face_swap, saved_path, face2[0], x_studio
                    )
                else:
                    final_url = swap1_url
                return {"success": True, "imageUrl": final_url, "engine": "ws_faceswap-2p", "model": "wavespeed-ai/image-face-swap"}

            # ── fal.ai path (FAL_DISABLED = False) ───────────────
            # Consistent Character — engine-selected, locks appearance across scenes
            if engine == "consistent_character" and face1:
                result = await loop.run_in_executor(
                    None, _generate_consistent_character, prompt, face1, payload.aspect, payload.style
                )
                return {"success": True, **result}

            # Single person — route to WaveSpeed PuLID (avoids fal.ai dependency)
            if face1 and not face2:
                result = await loop.run_in_executor(
                    None, _ws_pulid, prompt, face1, payload.aspect, payload.style, x_studio
                )
                return {"success": True, **result}

            # Two people — generate composition then face-swap each person in
            base_engine = engine if engine in FAL_MODELS else "fal_flux"
            base_result = await loop.run_in_executor(
                None, _generate_fal, prompt, payload.aspect, payload.style, base_engine, "", ""
            )
            base_path = str(IMAGE_DIR / Path(base_result["imageUrl"]).name)

            saved_path, swap1_url = await loop.run_in_executor(
                None, _face_swap, base_path, face1[0]
            )

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

    # LoRA disabled — character locking uses WaveSpeed PuLID (face reference method)
    lora_url = lora_trigger = ""

    # Venice always routes directly regardless of FAL_DISABLED
    if engine == "venice_flux":
        if not VENICE_KEY:
            raise HTTPException(status_code=400, detail="VENICE_API_KEY not set — add it to your environment variables")
        fn = lambda: _venice_generate_image(prompt, payload.aspect, payload.style, x_studio)
    elif engine in NOVITA_MODELS:
        if not NOVITA_KEY:
            raise HTTPException(status_code=400, detail="NOVITA_API_KEY not set")
        fn = lambda: _novita_generate_image(prompt, payload.aspect, payload.style, engine, x_studio)
    elif engine in WS_IMG_MODELS:
        # WaveSpeed engines always route to WaveSpeed regardless of FAL_DISABLED
        fn = lambda: _ws_generate_image(prompt, payload.aspect, payload.style, engine, lora_url, lora_trigger, x_studio)
    elif FAL_DISABLED:
        # Route everything to WaveSpeed
        if engine == "consistent_character":
            raise HTTPException(status_code=400, detail="Consistent Character requires a Person 1 face photo")
        if engine == "comfy":
            raise HTTPException(status_code=400, detail="ComfyUI is local-only and not available on Railway")
        if engine == "dalle3":
            fn = lambda: _generate_dalle3(prompt, payload.aspect, payload.style)
        else:
            ws_engine = engine if engine in WS_IMG_MODELS else ("ws_flux_uncensored" if x_studio == "redlight" else "ws_flux")
            fn = lambda: _ws_generate_image(prompt, payload.aspect, payload.style, ws_engine, lora_url, lora_trigger, x_studio)
    elif engine in FAL_MODELS or (lora_url and engine not in ("dalle3", "comfy")):
        fn = lambda: _generate_fal(prompt, payload.aspect, payload.style,
                                   engine, lora_url, lora_trigger)
    elif engine == "dalle3":
        fn = lambda: _generate_dalle3(prompt, payload.aspect, payload.style)
    elif engine == "comfy":
        fn = lambda: _generate_comfy(prompt, payload.aspect, payload.style, payload.character)
    elif engine == "consistent_character":
        raise HTTPException(status_code=400, detail="Consistent Character requires a Person 1 face photo — drop one in the face reference box and try again.")
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
        "default": "ws_flux",
        "engines": [
            {"id": "ws_pulid",           "label": "★ PuLID — Character Lock ⚡",  "provider": "WaveSpeed", "speed": "fast",   "quality": "best",  "note": "Drop a face photo → FLUX PuLID locks identity. $0.03/img"},
            {"id": "ws_flux",            "label": "FLUX Dev ⚡",                   "provider": "WaveSpeed", "speed": "fast",   "quality": "high",  "note": "$0.012/img"},
            {"id": "ws_flux_schnell",    "label": "FLUX Schnell ⚡ (draft)",       "provider": "WaveSpeed", "speed": "turbo",  "quality": "good",  "note": "Fastest + cheapest draft. $0.003/img"},
            {"id": "ws_flux_uncensored", "label": "FLUX Uncensored 🌶",            "provider": "WaveSpeed", "speed": "fast",   "quality": "high",  "note": "No content filter — Redlight mode. $0.012/img"},
            {"id": "dalle3",          "label": "DALL-E 3",                        "provider": "OpenAI",    "speed": "medium", "quality": "high",  "note": "Uses OpenAI key"},
            # fal.ai engines — inactive while FAL_DISABLED = True
            # {"id": "consistent_character", "label": "Consistent Character (fal)",  "provider": "fal.ai"},
            # {"id": "fal_flux_lora",        "label": "FLUX LoRA (fal)",            "provider": "fal.ai"},
            # {"id": "fal_flux",             "label": "FLUX Dev (fal)",             "provider": "fal.ai"},
            # {"id": "fal_flux_schnell",     "label": "FLUX Schnell (fal)",         "provider": "fal.ai"},
            # {"id": "fal_flux_pro",         "label": "FLUX Pro (fal)",             "provider": "fal.ai"},
            # {"id": "fal_sd3",              "label": "Stable Diffusion 3 (fal)",   "provider": "fal.ai"},
        ],
    }


@router.get("/image-gen/gallery")
def get_gallery(x_studio: str = Header(default="levram")):
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    all_imgs = sorted(IMAGE_DIR.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    is_rl = x_studio == "redlight"
    images = [f for f in all_imgs if f.name.startswith("rl_") == is_rl]
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

        swap_fn = _ws_face_swap if FAL_DISABLED else _face_swap

        if face1:
            saved_path, swap_url = await loop.run_in_executor(
                None, swap_fn, current_path, face1[0]
            )
            current_path = saved_path

        if face2:
            _, swap_url = await loop.run_in_executor(
                None, swap_fn, current_path, face2[0]
            )

        provider = "wavespeed-ai/image-face-swap" if FAL_DISABLED else "fal-ai/face-swap"
        return {"success": True, "imageUrl": swap_url, "engine": "faceswap", "model": provider}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
