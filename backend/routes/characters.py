import io
import os
import uuid
import json
import zipfile
import asyncio
import urllib.request
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.db import characters_col

router = APIRouter()

DATA_FILE = Path("data/characters.json")
REFS_DIR  = Path("output/renders/characters")


# ── Data model ────────────────────────────────────────────────

class CharacterPayload(BaseModel):
    name: str
    gender: str = ""
    age: str = ""
    appearance: str = ""
    wardrobe: str = ""
    voice: str = ""
    default_voice_profile: str = ""
    personality: str = ""
    notes: str = ""
    reference_image_url: str = ""
    reference_images: list = []       # list of /output/... URLs for LoRA training
    voice_source: str = "edge_tts"
    elevenlabs_voice_id: str = ""
    rvc_model_path: str = ""
    rvc_index_path: str = ""
    rvc_source_type: str = "pretrained"
    default_fx_preset: str = "clean"
    lora_url: str = ""                # fal.ai diffusers LoRA URL after training
    lora_trigger: str = ""            # trigger word prepended to every prompt
    lora_status: str = ""             # none | training | ready | failed


# ── JSON fallback helpers ─────────────────────────────────────

def _json_load():
    if not DATA_FILE.exists():
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps({"characters": []}, indent=2))
    return json.loads(DATA_FILE.read_text())


def _json_save(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


async def _get_character(character_id: str) -> dict | None:
    if characters_col is not None:
        doc = await characters_col.find_one({"id": character_id})
        return _strip(doc) if doc else None
    data = _json_load()
    return next((c for c in data["characters"] if c.get("id") == character_id), None)


async def _patch_character(character_id: str, fields: dict):
    fields["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if characters_col is not None:
        await characters_col.update_one({"id": character_id}, {"$set": fields})
    else:
        data = _json_load()
        idx = next((i for i, c in enumerate(data["characters"]) if c.get("id") == character_id), None)
        if idx is not None:
            data["characters"][idx].update(fields)
            _json_save(data)


# ── CRUD ──────────────────────────────────────────────────────

@router.get("/characters")
@router.get("/api/characters")
async def get_characters():
    if characters_col is not None:
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "characters": [_strip(d) for d in docs]}
    data = _json_load()
    return {"success": True, "characters": data.get("characters", [])}


@router.post("/characters")
async def create_character(payload: CharacterPayload):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Character name is required")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    character = {"id": str(uuid.uuid4()), **payload.model_dump(), "createdAt": now, "updatedAt": now}
    character["name"] = character["name"].strip()
    if not character.get("lora_trigger"):
        character["lora_trigger"] = character["name"].upper().replace(" ", "_")
    if characters_col is not None:
        await characters_col.insert_one(character)
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "character": _strip(character), "characters": [_strip(d) for d in docs]}
    data = _json_load()
    data["characters"].append(character)
    _json_save(data)
    return {"success": True, "character": character, "characters": data["characters"]}


@router.put("/characters/{character_id}")
async def update_character(character_id: str, payload: CharacterPayload):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Character name is required")
    updates = {**payload.model_dump(), "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    updates["name"] = updates["name"].strip()
    if characters_col is not None:
        result = await characters_col.find_one_and_update(
            {"id": character_id}, {"$set": updates}, return_document=True
        )
        if not result:
            raise HTTPException(status_code=404, detail="Character not found")
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "character": _strip(result), "characters": [_strip(d) for d in docs]}
    data = _json_load()
    idx = next((i for i, c in enumerate(data["characters"]) if c.get("id") == character_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Character not found")
    data["characters"][idx].update(updates)
    _json_save(data)
    return {"success": True, "character": data["characters"][idx], "characters": data["characters"]}


@router.delete("/characters/{character_id}")
async def delete_character(character_id: str):
    if characters_col is not None:
        result = await characters_col.delete_one({"id": character_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Character not found")
        docs = await characters_col.find({}).to_list(None)
        return {"success": True, "characters": [_strip(d) for d in docs]}
    data = _json_load()
    before = len(data["characters"])
    data["characters"] = [c for c in data["characters"] if c.get("id") != character_id]
    if len(data["characters"]) == before:
        raise HTTPException(status_code=404, detail="Character not found")
    _json_save(data)
    return {"success": True, "characters": data["characters"]}


# ── Reference image upload ────────────────────────────────────

@router.post("/characters/{character_id}/upload-reference")
async def upload_reference(character_id: str, file: UploadFile = File(...)):
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    ref_dir = REFS_DIR / character_id / "refs"
    ref_dir.mkdir(parents=True, exist_ok=True)

    ext      = Path(file.filename).suffix or ".png"
    filename = f"ref_{uuid.uuid4().hex[:8]}{ext}"
    dest     = ref_dir / filename
    dest.write_bytes(await file.read())

    url  = f"/output/renders/characters/{character_id}/refs/{filename}"
    refs = list(char.get("reference_images") or [])
    refs.append(url)
    await _patch_character(character_id, {
        "reference_images": refs,
        "reference_image_url": refs[0],
    })
    return {"success": True, "url": url, "total_refs": len(refs)}


@router.delete("/characters/{character_id}/reference/{filename}")
async def delete_reference(character_id: str, filename: str):
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    file_path = REFS_DIR / character_id / "refs" / filename
    if file_path.exists():
        file_path.unlink()
    refs = [r for r in (char.get("reference_images") or []) if filename not in r]
    await _patch_character(character_id, {"reference_images": refs})
    return {"success": True, "remaining": len(refs)}


# ── LoRA training (background) ────────────────────────────────

async def _run_lora_training(character_id: str, char: dict):
    try:
        import fal_client

        api_key = os.getenv("FAL_KEY")
        if not api_key:
            await _patch_character(character_id, {"lora_status": "failed: FAL_KEY not set"})
            return
        os.environ["FAL_KEY"] = api_key

        refs = char.get("reference_images") or []
        buf  = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for ref_url in refs:
                local_path = Path(ref_url.lstrip("/"))
                if local_path.exists():
                    zf.write(local_path, local_path.name)
        buf.seek(0)

        zip_url = fal_client.upload(buf.read(), content_type="application/zip")
        trigger = char.get("lora_trigger") or char["name"].upper().replace(" ", "_")

        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: fal_client.run(
                "fal-ai/flux-lora-fast-training",
                arguments={
                    "images_data_url": zip_url,
                    "trigger_word":    trigger,
                    "steps":           1000,
                    "is_style":        False,
                    "create_masks":    True,
                },
            ),
        )

        lora_url = result.get("diffusers_lora_file", {}).get("url", "")
        if lora_url:
            await _patch_character(character_id, {
                "lora_url":     lora_url,
                "lora_trigger": trigger,
                "lora_status":  "ready",
            })
        else:
            await _patch_character(character_id, {"lora_status": "failed: no lora URL returned"})

    except Exception as e:
        await _patch_character(character_id, {"lora_status": f"failed: {str(e)[:120]}"})


@router.post("/characters/{character_id}/train-lora")
async def train_lora(character_id: str, background_tasks: BackgroundTasks):
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    refs = char.get("reference_images") or []
    if len(refs) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 5 reference images. You have {len(refs)}. Upload more via /characters/{character_id}/upload-reference"
        )
    await _patch_character(character_id, {"lora_status": "training"})
    background_tasks.add_task(_run_lora_training, character_id, char)
    return {
        "success": True,
        "status":  "training",
        "message": f"LoRA training started for {char['name']} using {len(refs)} images. "
                   f"Takes ~10 min. Poll /characters/{character_id}/lora-status to check.",
    }


@router.get("/characters/{character_id}/lora-status")
async def lora_status(character_id: str):
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return {
        "success":        True,
        "name":           char.get("name"),
        "lora_status":    char.get("lora_status") or "none",
        "lora_url":       char.get("lora_url") or "",
        "lora_trigger":   char.get("lora_trigger") or "",
        "reference_count": len(char.get("reference_images") or []),
    }


# ── Character-lab preview ─────────────────────────────────────

@router.post("/character-lab/generate")
async def generate_character_preview(payload: dict):
    prompt    = payload.get("prompt") or ""
    char_data = payload.get("character") or {}
    char_id   = char_data.get("id") or ""
    lora_url  = char_data.get("lora_url") or ""
    trigger   = char_data.get("lora_trigger") or ""

    try:
        import fal_client
        api_key = os.getenv("FAL_KEY")
        if not api_key:
            raise RuntimeError("no FAL_KEY")
        os.environ["FAL_KEY"] = api_key

        if lora_url:
            full_prompt = f"{trigger}, {prompt}" if trigger else prompt
            model_id    = "fal-ai/flux-lora"
            args = {
                "prompt":                full_prompt,
                "loras":                 [{"path": lora_url, "scale": 1.0}],
                "image_size":            "portrait_16_9",
                "num_inference_steps":   30,
                "guidance_scale":        3.5,
                "enable_safety_checker": False,
            }
        else:
            full_prompt = prompt
            model_id    = "fal-ai/flux/dev"
            args = {
                "prompt":                full_prompt,
                "image_size":            "portrait_16_9",
                "num_inference_steps":   28,
                "guidance_scale":        3.5,
                "num_images":            1,
                "enable_safety_checker": False,
            }

        loop   = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, lambda: fal_client.run(model_id, arguments=args)
        )
        remote_url = result["images"][0]["url"]

        out_dir  = Path("output/renders/images")
        out_dir.mkdir(parents=True, exist_ok=True)
        ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"character-preview_{ts}_{uuid.uuid4().hex[:8]}.png"
        req = urllib.request.Request(remote_url, headers={"User-Agent": "LEVRAM/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            (out_dir / filename).write_bytes(r.read())
        local_url = "/output/renders/images/" + filename

        if char_id and not char_data.get("reference_image_url"):
            await _patch_character(char_id, {"reference_image_url": local_url})

        return {
            "success":   True,
            "image_url": local_url,
            "prompt":    full_prompt,
            "engine":    "fal_flux_lora" if lora_url else "fal_flux",
        }

    except Exception:
        pass  # fall through to ComfyUI

    from backend.services.comfy_service import generate_comfy_keyframe
    item = {
        "id": "character-preview", "shotId": "character-preview",
        "shot": {
            "character":   char_data.get("name", "Character Preview"),
            "shotDesc":    prompt, "shotPrompt": prompt,
            "renderStyle": "cinematic photorealistic",
            "scene":       "Character Lab", "shot_number": "CHARACTER-PREVIEW",
        },
    }
    render_result = generate_comfy_keyframe(item, width=512, height=768)
    image_url = (render_result.get("outputUrl") or render_result.get("renderOutputUrl")
                 or render_result.get("image_url") or render_result.get("url"))
    return {
        "success": True, "image_url": image_url,
        "prompt": prompt, "engine": "comfyui", "data": render_result,
    }
