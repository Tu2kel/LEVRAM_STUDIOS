from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import asyncio
import base64 as _b64
import os
import uuid
import urllib.request

from backend.routes.characters import _get_character, _get_b64_refs

router = APIRouter()

IMAGE_DIR = Path("output/renders/images")

# ── WaveSpeed ─────────────────────────────────────────────────
WAVESPEED_API_BASE = "https://api.wavespeed.ai/api/v3"

WS_IMG_SIZES = {
    "widescreen": {"width": 1280, "height": 720},
    "cinematic":  {"width": 1280, "height": 544},
    "portrait":   {"width": 720,  "height": 1280},
    "square":     {"width": 1024, "height": 1024},
}

# Runway Gen-4 hosted on WaveSpeed (same key)
WS_RUNWAY_MODELS = {
    "runway_gen4":       "runwayml/gen4-image",
    "runway_gen4_turbo": "runwayml/gen4-image-turbo",
}

RUNWAY_ASPECTS = {
    "widescreen": "16:9",
    "cinematic":  "16:9",
    "portrait":   "9:16",
    "square":     "1:1",
}

# ── Nano Banana 2 (Gemini 3.1 Flash Image) ───────────────────
NB_IMG_SIZES = {
    "widescreen": {"width": 1280, "height": 720},
    "cinematic":  {"width": 1280, "height": 544},
    "portrait":   {"width": 720,  "height": 1280},
    "square":     {"width": 1024, "height": 1024},
}

# ── Venice ────────────────────────────────────────────────────
VENICE_KEY      = os.getenv("VENICE_API_KEY", "")
VENICE_IMG_BASE = "https://api.venice.ai/api/v1"

VENICE_IMG_SIZES = {
    "widescreen": (1280, 720),
    "cinematic":  (1280, 544),
    "portrait":   (720,  1280),
    "square":     (1024, 1024),
}

# ── Novita (Redlight only) ────────────────────────────────────
NOVITA_KEY      = os.getenv("NOVITA_API_KEY", "")
NOVITA_IMG_BASE = "https://api.novita.ai/v3/async"

NOVITA_MODELS = {
    "novita_realism": "epicrealism_naturalSinRC1VAE_106430.safetensors",
    "novita_anime":   "meinahentai_v4_70340.safetensors",
    "novita_asian":   "majicmixRealistic_v6_65516.safetensors",
}

NOVITA_IMG_SIZES = {
    "widescreen": (768, 512),
    "cinematic":  (768, 432),
    "portrait":   (512, 768),
    "square":     (512, 512),
}


# ── Data models ───────────────────────────────────────────────
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
    engine: str = "runway_gen4_turbo"
    reference_images:   list[RefImage] = []
    face_references_1:  list[RefImage] = []
    face_references_2:  list[RefImage] = []
    face_references:    list[RefImage] = []  # legacy compat


# ── Core helpers ──────────────────────────────────────────────
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


def _ws_to_public_url(b64data: str, media_type: str, prefix: str = "ref") -> str:
    """Save base64 bytes to output dir and return a public Railway URL."""
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


# ══════════════════════════════════════════════════════════════
# Runway Gen-4 — Primary character lock (via WaveSpeed)
# ══════════════════════════════════════════════════════════════
def _runway_gen4_image(prompt: str, face_refs: list, aspect: str,
                       style: str = "", engine: str = "runway_gen4_turbo",
                       studio: str = "levram") -> dict:
    model_id     = WS_RUNWAY_MODELS.get(engine, WS_RUNWAY_MODELS["runway_gen4_turbo"])
    aspect_ratio = RUNWAY_ASPECTS.get(aspect, "16:9")
    full_prompt  = f"{prompt}, {style}".strip(", ") if style else prompt

    ref_urls = []
    for ref in face_refs[:3]:
        try:
            ref_urls.append(_ws_to_public_url(ref.base64, ref.mediaType, prefix="runwayref"))
        except Exception:
            pass

    outputs = _ws_submit_poll(model_id, {
        "prompt":           full_prompt,
        "aspect_ratio":     aspect_ratio,
        "resolution":       "1080p",
        "reference_images": ref_urls,
        "seed":             0,
    }, timeout_secs=180)

    if not outputs:
        raise RuntimeError("Runway Gen-4 returned no image")

    image_bytes = _download_url(outputs[0])
    prefix      = "runway_gen4t" if "turbo" in engine else "runway_gen4"
    _, out_url  = _save_bytes(image_bytes, prefix=prefix, studio=studio)
    return {"imageUrl": out_url, "prompt": full_prompt, "engine": engine, "model": model_id}


# ══════════════════════════════════════════════════════════════
# Ideogram Character — Single-image identity lock
# ══════════════════════════════════════════════════════════════
def _ideogram_character(prompt: str, face_refs: list, aspect: str,
                         style: str = "", studio: str = "levram") -> dict:
    full_prompt = f"{prompt}, {style}".strip(", ") if style else prompt

    payload: dict = {
        "prompt":     full_prompt,
        "style_type": "REALISTIC",
    }

    if face_refs:
        try:
            ref_url = _ws_to_public_url(face_refs[0].base64, face_refs[0].mediaType, prefix="ideogram_ref")
            payload["image_url"] = ref_url
        except Exception:
            pass

    size = WS_IMG_SIZES.get(aspect, WS_IMG_SIZES["widescreen"])
    payload["width"]  = size["width"]
    payload["height"] = size["height"]

    outputs = _ws_submit_poll("ideogram-ai/ideogram-character", payload, timeout_secs=180)
    if not outputs:
        raise RuntimeError("Ideogram Character returned no image")

    image_bytes = _download_url(outputs[0])
    _, out_url  = _save_bytes(image_bytes, prefix="ideogram", studio=studio)
    return {"imageUrl": out_url, "prompt": full_prompt, "engine": "ideogram_character", "model": "ideogram-ai/ideogram-character"}


# ══════════════════════════════════════════════════════════════
# Nano Banana 2 (Gemini 3.1 Flash Image) — Multi-character lock
# ══════════════════════════════════════════════════════════════
def _ws_nano_banana(prompt: str, face_refs: list, aspect: str,
                    style: str = "", studio: str = "levram") -> dict:
    full_prompt = f"{prompt}, {style}".strip(", ") if style else prompt
    size = NB_IMG_SIZES.get(aspect, NB_IMG_SIZES["widescreen"])

    payload: dict = {
        "prompt": full_prompt,
        "width":  size["width"],
        "height": size["height"],
    }

    if face_refs:
        ref_urls = []
        for ref in face_refs[:5]:
            try:
                ref_urls.append(_ws_to_public_url(ref.base64, ref.mediaType, prefix="nbref"))
            except Exception:
                pass
        if ref_urls:
            payload["reference_images"] = ref_urls

    outputs = _ws_submit_poll("google/nano-banana-2/text-to-image", payload, timeout_secs=180)
    if not outputs:
        raise RuntimeError("Nano Banana 2 returned no image")

    image_bytes = _download_url(outputs[0])
    _, out_url  = _save_bytes(image_bytes, prefix="nanobana", studio=studio)
    return {"imageUrl": out_url, "prompt": full_prompt, "engine": "ws_nano_banana", "model": "google/nano-banana-2/text-to-image"}


# ══════════════════════════════════════════════════════════════
# Full Lock — Seedream body + WaveSpeed face swap
# ══════════════════════════════════════════════════════════════
def _ws_seedream_edit(prompt: str, body_ref_urls: list, studio: str = "levram") -> list:
    outputs = _ws_submit_poll("bytedance/seedream-v5.0-lite/edit-sequential", {
        "prompt":     f"1 image. Show Figure 1 in the following scene: {prompt}. Preserve the character's exact appearance, face, outfit, and features.",
        "images":     body_ref_urls,
        "max_images": 1,
    }, timeout_secs=180)
    if not outputs:
        raise RuntimeError("WaveSpeed Seedream Edit returned no image")
    return outputs


def _ws_face_swap(base_image_path: str, face_ref, studio: str = "levram") -> tuple:
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


async def _full_lock_generate(
    character_id: str, prompt: str, face_refs: list,
    aspect: str, style: str, studio: str,
) -> dict:
    char = await _get_character(character_id)
    if not char:
        raise RuntimeError("Character not found. Check the character_id.")

    body_refs_local = char.get("body_reference_images") or []
    domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    loop   = asyncio.get_event_loop()

    public_body_urls = []
    if domain:
        for ref_url in body_refs_local:
            local_path = Path(ref_url.lstrip("/"))
            if local_path.exists():
                public_body_urls.append(f"https://{domain}{ref_url}")

    if not public_body_urls:
        b64_refs = await _get_b64_refs(character_id)
        for entry in b64_refs[:3]:
            try:
                pub_url = _ws_to_public_url(
                    entry["data"], entry.get("mime", "image/jpeg"), prefix="bodyref"
                )
                public_body_urls.append(pub_url)
            except Exception:
                pass

    if not public_body_urls:
        raise RuntimeError(
            f"No body reference images for '{char.get('name', character_id)}'. "
            "Upload full-body photos in Character Lab → Body Reference section first."
        )

    outputs = await loop.run_in_executor(
        None, lambda: _ws_seedream_edit(prompt, public_body_urls[:3], studio)
    )
    if not outputs:
        raise RuntimeError("Seedream body lock returned no image.")

    seedream_bytes      = _download_url(outputs[0])
    saved_path, out_url = _save_bytes(seedream_bytes, prefix="locked_body", studio=studio)

    if face_refs:
        _, out_url = await loop.run_in_executor(
            None, lambda: _ws_face_swap(saved_path, face_refs[0], studio)
        )

    return {
        "imageUrl": out_url,
        "prompt":   prompt,
        "engine":   "full_lock",
        "model":    "seedream-edit-sequential + wavespeed-face-swap",
    }


# ══════════════════════════════════════════════════════════════
# Venice — Uncensored (Redlight mode)
# ══════════════════════════════════════════════════════════════
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
        headers={"Authorization": f"Bearer {VENICE_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = _json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Venice {e.code}: {e.read().decode()[:400]}")

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


# ══════════════════════════════════════════════════════════════
# Novita — Redlight explicit content
# ══════════════════════════════════════════════════════════════
def _novita_generate_image(prompt: str, aspect: str, style: str,
                           engine: str = "novita_realism", studio: str = "levram") -> dict:
    import json as _json, time, urllib.error
    if not NOVITA_KEY:
        raise RuntimeError("NOVITA_API_KEY not set")

    model = NOVITA_MODELS.get(engine, NOVITA_MODELS["novita_realism"])
    w, h  = NOVITA_IMG_SIZES.get(aspect, NOVITA_IMG_SIZES["widescreen"])
    full  = f"{prompt}, {style}".strip(", ") if style else prompt

    body = _json.dumps({
        "extra": {"response_image_type": "jpeg"},
        "request": {
            "model_name":      model,
            "prompt":          full,
            "negative_prompt": "blurry, low quality, watermark, censored",
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

    headers = {"Authorization": f"Bearer {NOVITA_KEY}", "Content-Type": "application/json"}
    req = urllib.request.Request(f"{NOVITA_IMG_BASE}/txt2img", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            submit = _json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Novita submit {e.code}: {e.read().decode()[:300]}")

    task_id = submit.get("task_id")
    if not task_id:
        raise RuntimeError(f"Novita returned no task_id: {submit}")

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
            image_bytes = _download_url(img_url)
            _, out_url  = _save_bytes(image_bytes, prefix=f"novita_{engine.split('_')[-1]}", studio=studio)
            return {"imageUrl": out_url, "prompt": full, "engine": engine, "model": model}
        if status in ("TASK_STATUS_FAILED", "TASK_STATUS_CANCELED"):
            raise RuntimeError(f"Novita task {status}: {result}")

    raise RuntimeError("Novita generation timed out")


# ── Prompt enhancement via GPT-4o Vision ─────────────────────
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
        for ref in refs[:10]:
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


# ══════════════════════════════════════════════════════════════
# Route
# ══════════════════════════════════════════════════════════════
_RL_ENGINES   = {"venice_flux", "novita_realism", "novita_anime", "novita_asian"}
_MAIN_ENGINES = {"runway_gen4_turbo", "runway_gen4", "full_lock", "ideogram_character", "ws_nano_banana"}

@router.post("/image-gen/generate")
async def generate_image(payload: ImageGenPayload, x_studio: str = Header(default="levram")):
    engine = payload.engine
    loop   = asyncio.get_event_loop()

    face1  = payload.face_references_1 or payload.face_references
    face2  = payload.face_references_2

    # Enhance prompt with scene reference images
    prompt = payload.prompt
    if payload.reference_images:
        prompt = await loop.run_in_executor(
            None, _enhance_prompt_with_refs, prompt, payload.reference_images, payload.style
        )

    # ── Redlight engines ──────────────────────────────────────
    if engine == "venice_flux":
        if not VENICE_KEY:
            raise HTTPException(400, "VENICE_API_KEY not set")
        fn = lambda: _venice_generate_image(prompt, payload.aspect, payload.style, x_studio)

    elif engine in NOVITA_MODELS:
        if not NOVITA_KEY:
            raise HTTPException(400, "NOVITA_API_KEY not set")
        fn = lambda: _novita_generate_image(prompt, payload.aspect, payload.style, engine, x_studio)

    # ── Full body + face lock ─────────────────────────────────
    elif engine == "full_lock":
        if not payload.character_id:
            raise HTTPException(400, "full_lock requires a character_id — select a character first.")
        if not os.getenv("WAVESPEED_KEY"):
            raise HTTPException(400, "WAVESPEED_KEY not set")
        try:
            result = await _full_lock_generate(
                payload.character_id, prompt, face1, payload.aspect, payload.style, x_studio
            )
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(500, str(e))

    # ── Runway Gen-4 — with or without face refs ──────────────
    elif engine in WS_RUNWAY_MODELS:
        refs = (face1 + face2)[:3] if face2 else face1[:3]
        try:
            result = await loop.run_in_executor(
                None, _runway_gen4_image, prompt, refs, payload.aspect, payload.style, engine, x_studio
            )
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(500, str(e))

    # ── Ideogram Character — single-image identity lock ───────
    elif engine == "ideogram_character":
        try:
            result = await loop.run_in_executor(
                None, _ideogram_character, prompt, face1, payload.aspect, payload.style, x_studio
            )
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(500, str(e))

    # ── Nano Banana 2 — multi-character (up to 5) ─────────────
    elif engine == "ws_nano_banana":
        refs = (face1 + face2)[:5] if face2 else face1[:5]
        try:
            result = await loop.run_in_executor(
                None, _ws_nano_banana, prompt, refs, payload.aspect, payload.style, x_studio
            )
            return {"success": True, **result}
        except Exception as e:
            raise HTTPException(500, str(e))

    else:
        raise HTTPException(400, f"Unknown engine: {engine}")

    try:
        result = await loop.run_in_executor(None, fn)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/image-gen/models")
def list_models():
    return {
        "success": True,
        "default": "runway_gen4_turbo",
        "engines": [
            # ── Main Studio ───────────────────────────────────────────────────────
            {"id": "runway_gen4_turbo",  "label": "★ Runway Gen-4 Turbo 🔒",     "provider": "Runway / WaveSpeed", "speed": "fast",   "quality": "best", "note": "Primary character lock. Up to 3 refs. ~$0.05/img."},
            {"id": "runway_gen4",        "label": "★ Runway Gen-4 🔒",           "provider": "Runway / WaveSpeed", "speed": "medium", "quality": "best", "note": "Max quality character lock. Up to 3 refs. ~$0.10/img."},
            {"id": "full_lock",          "label": "Full Lock — Body + Face 🔒",  "provider": "WaveSpeed",          "speed": "slow",   "quality": "best", "note": "Seedream body lock → face swap. Requires body refs in Character Lab."},
            {"id": "ideogram_character", "label": "Ideogram Character 🔒",       "provider": "WaveSpeed",          "speed": "medium", "quality": "best", "note": "Single-image identity lock. Face + hair map. $0.10–$0.20/img."},
            {"id": "ws_nano_banana",     "label": "Nano Banana 2 🔒",            "provider": "WaveSpeed",          "speed": "fast",   "quality": "best", "note": "Gemini 3.1 Flash Image. Up to 5 characters. $0.07–$0.15/img."},
            # ── Redlight ─────────────────────────────────────────────────────────
            {"id": "venice_flux",        "label": "Venice.ai 🔴",               "provider": "Venice",             "speed": "medium", "quality": "high", "note": "Uncensored. Free 15/day, Pro $18/mo."},
            {"id": "novita_realism",     "label": "Novita Realism 🔴",          "provider": "Novita",             "speed": "medium", "quality": "high", "note": "Photorealistic. ~$0.015/img."},
            {"id": "novita_anime",       "label": "Novita Anime 🔴",            "provider": "Novita",             "speed": "medium", "quality": "good", "note": "Anime style. ~$0.015/img."},
            {"id": "novita_asian",       "label": "Novita Asian 🔴",            "provider": "Novita",             "speed": "medium", "quality": "high", "note": "Asian facial structure lock. ~$0.015/img."},
        ],
    }
