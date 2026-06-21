import io
import os
import re
import uuid
import json
import zipfile
import asyncio
import urllib.request
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.db import characters_col, char_b64_col

router = APIRouter()

DATA_FILE    = Path("data/characters.json")
B64_DATA_FILE = Path("data/character_b64.json")
REFS_DIR     = Path("output/renders/characters")


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
    reference_images: list = []           # face photos — WaveSpeed PuLID face lock
    body_reference_images: list = []      # full body shots — Seedream shape lock
    body_reference_images_b64: list = []  # base64 backup for Railway ephemeral FS
    preview_images: list = []         # [{url, label}] — BYO character look images
    active_preview_index: int = 0     # which preview_images entry flux-pulid uses
    voice_source: str = "edge_tts"
    elevenlabs_voice_id: str = ""
    rvc_model_path: str = ""
    rvc_index_path: str = ""
    rvc_source_type: str = "pretrained"
    default_fx_preset: str = "clean"
    lora_url: str = ""                # fal.ai diffusers LoRA URL after training
    lora_trigger: str = ""            # trigger word prepended to every prompt
    lora_status: str = ""             # none | training | ready | failed
    lora_request_id: str = ""         # fal.ai request ID for in-progress training


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


# ── Body-ref b64 helpers (separate collection to keep character docs small) ───

def _b64_json_load() -> dict:
    if not B64_DATA_FILE.exists():
        B64_DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        B64_DATA_FILE.write_text(json.dumps({}, indent=2))
    return json.loads(B64_DATA_FILE.read_text())


def _b64_json_save(data: dict):
    B64_DATA_FILE.write_text(json.dumps(data, indent=2))


async def _get_b64_refs(character_id: str) -> list:
    if char_b64_col is not None:
        doc = await char_b64_col.find_one({"character_id": character_id})
        return doc.get("refs", []) if doc else []
    return _b64_json_load().get(character_id, [])


async def _set_b64_refs(character_id: str, refs: list):
    if char_b64_col is not None:
        if refs:
            await char_b64_col.update_one(
                {"character_id": character_id},
                {"$set": {"character_id": character_id, "refs": refs}},
                upsert=True,
            )
        else:
            await char_b64_col.delete_one({"character_id": character_id})
    else:
        data = _b64_json_load()
        if refs:
            data[character_id] = refs
        else:
            data.pop(character_id, None)
        _b64_json_save(data)


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
async def get_characters(x_studio: str = Header(default="levram")):
    if characters_col is not None:
        try:
            if x_studio == "levram":
                query = {"$or": [{"studio": "levram"}, {"studio": {"$exists": False}}]}
            else:
                query = {"studio": x_studio}
            # Exclude heavy base64 backup field — roster only needs metadata, not image bytes
            _proj = {"body_reference_images_b64": 0}
            docs = await asyncio.wait_for(
                characters_col.find(query, _proj).to_list(None),
                timeout=4.0
            )
            untagged = [d for d in docs if not d.get("studio")]
            if untagged:
                ids = [d["id"] for d in untagged]
                asyncio.ensure_future(
                    characters_col.update_many({"id": {"$in": ids}}, {"$set": {"studio": "levram"}})
                )
            return {"success": True, "characters": [_strip(d) for d in docs]}
        except Exception:
            pass  # MongoDB slow/unreachable — fall through to JSON
    data = _json_load()
    chars = [c for c in data.get("characters", []) if c.get("studio", "levram") == x_studio]
    return {"success": True, "characters": chars}


@router.get("/characters/count")
@router.get("/api/characters/count")
async def get_characters_count(x_studio: str = Header(default="levram")):
    """Lightweight count — used by dashboard stats, avoids loading full character docs."""
    if characters_col is not None:
        try:
            if x_studio == "levram":
                query = {"$or": [{"studio": "levram"}, {"studio": {"$exists": False}}]}
            else:
                query = {"studio": x_studio}
            count = await asyncio.wait_for(
                characters_col.count_documents(query),
                timeout=4.0,
            )
            return {"count": count}
        except Exception:
            pass
    data = _json_load()
    count = sum(1 for c in data.get("characters", []) if c.get("studio", "levram") == x_studio)
    return {"count": count}


@router.post("/characters")
async def create_character(payload: CharacterPayload, x_studio: str = Header(default="levram")):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Character name is required")
    name_clean = payload.name.strip()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Dedup: return existing character if same name+studio already exists
    if characters_col is not None:
        if x_studio == "levram":
            dedup_query = {
                "name": {"$regex": f"^{re.escape(name_clean)}$", "$options": "i"},
                "$or": [{"studio": "levram"}, {"studio": {"$exists": False}}],
            }
        else:
            dedup_query = {
                "name": {"$regex": f"^{re.escape(name_clean)}$", "$options": "i"},
                "studio": x_studio,
            }
        existing_doc = await characters_col.find_one(dedup_query)
        if existing_doc:
            docs = await characters_col.find({"studio": x_studio}).to_list(None)
            return {"success": True, "character": _strip(existing_doc), "characters": [_strip(d) for d in docs]}
    else:
        data = _json_load()
        existing_doc = next(
            (c for c in data["characters"]
             if c.get("name", "").strip().lower() == name_clean.lower()
             and c.get("studio", "levram") == x_studio),
            None,
        )
        if existing_doc:
            chars = [c for c in data["characters"] if c.get("studio", "levram") == x_studio]
            return {"success": True, "character": existing_doc, "characters": chars}

    character = {"id": str(uuid.uuid4()), **payload.model_dump(), "studio": x_studio, "createdAt": now, "updatedAt": now}
    character["name"] = name_clean
    if not character.get("lora_trigger"):
        character["lora_trigger"] = name_clean.upper().replace(" ", "_")
    if characters_col is not None:
        await characters_col.insert_one(character)
        docs = await characters_col.find({"studio": x_studio}).to_list(None)
        return {"success": True, "character": _strip(character), "characters": [_strip(d) for d in docs]}
    data = _json_load()
    data["characters"].append(character)
    _json_save(data)
    chars = [c for c in data["characters"] if c.get("studio", "levram") == x_studio]
    return {"success": True, "character": character, "characters": chars}


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
    import base64 as _b64
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    ref_dir = REFS_DIR / character_id / "refs"
    ref_dir.mkdir(parents=True, exist_ok=True)

    ext      = Path(file.filename).suffix or ".png"
    filename = f"ref_{uuid.uuid4().hex[:8]}{ext}"
    dest     = ref_dir / filename
    raw_bytes = await file.read()
    dest.write_bytes(raw_bytes)

    url  = f"/output/renders/characters/{character_id}/refs/{filename}"
    refs = list(char.get("reference_images") or [])
    refs.append(url)

    # Store base64 in MongoDB so reference survives Railway deploys (ephemeral filesystem)
    refs_b64 = list(char.get("reference_images_b64") or [])
    refs_b64.append({
        "filename": filename,
        "url":      url,
        "data":     _b64.b64encode(raw_bytes).decode("utf-8"),
        "mime":     file.content_type or "image/png",
    })

    await _patch_character(character_id, {
        "reference_images":     refs,
        "reference_image_url":  refs[0],
        "reference_images_b64": refs_b64,
    })
    return {"success": True, "url": url, "total_refs": len(refs)}


@router.post("/characters/{character_id}/upload-body-reference")
async def upload_body_reference(character_id: str, file: UploadFile = File(...)):
    import base64 as _b64
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    ref_dir = REFS_DIR / character_id / "body-refs"
    ref_dir.mkdir(parents=True, exist_ok=True)

    ext      = Path(file.filename).suffix or ".png"
    filename = f"body_{uuid.uuid4().hex[:8]}{ext}"
    dest     = ref_dir / filename
    raw_bytes = await file.read()
    dest.write_bytes(raw_bytes)

    url   = f"/output/renders/characters/{character_id}/body-refs/{filename}"
    refs  = list(char.get("body_reference_images") or [])
    refs.append(url)

    refs_b64 = await _get_b64_refs(character_id)
    refs_b64.append({
        "filename": filename,
        "url":      url,
        "data":     _b64.b64encode(raw_bytes).decode("utf-8"),
        "mime":     file.content_type or "image/png",
    })
    await _set_b64_refs(character_id, refs_b64)

    await _patch_character(character_id, {"body_reference_images": refs})
    return {"success": True, "url": url, "total_body_refs": len(refs)}


@router.delete("/characters/{character_id}/body-reference/{filename}")
async def delete_body_reference(character_id: str, filename: str):
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    file_path = REFS_DIR / character_id / "body-refs" / filename
    if file_path.exists():
        file_path.unlink()
    refs     = [r for r in (char.get("body_reference_images") or []) if filename not in r]
    refs_b64 = [e for e in await _get_b64_refs(character_id) if e.get("filename") != filename]
    await _set_b64_refs(character_id, refs_b64)
    await _patch_character(character_id, {"body_reference_images": refs})
    return {"success": True, "remaining": len(refs)}


@router.post("/characters/{character_id}/add-reference-url")
async def add_reference_url(character_id: str, body: dict):
    """Add an already-stored image (e.g. from Image Gen) as a character reference by URL path."""
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    refs = list(char.get("reference_images") or [])
    if url not in refs:
        refs.append(url)
    await _patch_character(character_id, {
        "reference_images":    refs,
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

async def _submit_lora_training(character_id: str, char: dict):
    """Submit training job to fal.ai and store request_id. No polling — status
    endpoint checks fal.ai on demand so server restarts can't break recovery."""
    try:
        import fal_client

        api_key = os.getenv("FAL_KEY")
        if not api_key:
            await _patch_character(character_id, {"lora_status": "failed: FAL_KEY not set"})
            return
        os.environ["FAL_KEY"] = api_key

        refs      = char.get("reference_images") or []
        refs_b64  = char.get("reference_images_b64") or []
        buf       = io.BytesIO()
        added     = 0
        import base64 as _b64mod
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for ref_url in refs:
                local_path = Path(ref_url.lstrip("/"))
                if local_path.exists():
                    zf.write(local_path, local_path.name)
                    added += 1
                else:
                    # Railway restarted and wiped the filesystem — recover from b64 backup
                    entry = next((e for e in refs_b64 if e.get("url") == ref_url), None)
                    if entry and entry.get("data"):
                        img_bytes = _b64mod.b64decode(entry["data"])
                        zf.writestr(entry.get("filename", f"ref_{uuid.uuid4().hex[:8]}.jpg"), img_bytes)
                        added += 1

        if added == 0:
            await _patch_character(character_id, {
                "lora_status": "failed: no reference images found — re-upload refs and try again"
            })
            return
        buf.seek(0)

        loop    = asyncio.get_running_loop()
        zip_url = await loop.run_in_executor(
            None, lambda: fal_client.upload(buf.read(), content_type="application/zip")
        )
        trigger = char.get("lora_trigger") or char["name"].upper().replace(" ", "_")

        handle = await loop.run_in_executor(
            None,
            lambda: fal_client.submit(
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
        await _patch_character(character_id, {
            "lora_request_id": handle.request_id,
            "lora_status":     "training",
        })

    except Exception as e:
        await _patch_character(character_id, {"lora_status": f"failed: {str(e)[:120]}", "lora_request_id": ""})


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
    background_tasks.add_task(_submit_lora_training, character_id, char)
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

    # If training with a stored request_id, check fal.ai directly for recovery
    if char.get("lora_status") == "training" and char.get("lora_request_id"):
        try:
            import fal_client
            api_key = os.getenv("FAL_KEY")
            if api_key:
                os.environ["FAL_KEY"] = api_key
                loop       = asyncio.get_running_loop()
                request_id = char["lora_request_id"]
                status_obj = await loop.run_in_executor(
                    None,
                    lambda: fal_client.status("fal-ai/flux-lora-fast-training", request_id, with_logs=False),
                )
                if status_obj.status == "COMPLETED":
                    result   = await loop.run_in_executor(
                        None, lambda: fal_client.result("fal-ai/flux-lora-fast-training", request_id)
                    )
                    lora_url = result.get("diffusers_lora_file", {}).get("url", "")
                    if lora_url:
                        await _patch_character(character_id, {
                            "lora_url":        lora_url,
                            "lora_trigger":    char.get("lora_trigger", ""),
                            "lora_status":     "ready",
                            "lora_request_id": "",
                        })
                    else:
                        await _patch_character(character_id, {"lora_status": "failed: no lora URL", "lora_request_id": ""})
                    char = await _get_character(character_id)
                elif status_obj.status in ("FAILED", "CANCELLED"):
                    await _patch_character(character_id, {
                        "lora_status":     f"failed: job {status_obj.status.lower()}",
                        "lora_request_id": "",
                    })
                    char = await _get_character(character_id)
        except Exception:
            pass  # return existing status if fal.ai check fails

    return {
        "success":         True,
        "name":            char.get("name"),
        "lora_status":     char.get("lora_status") or "none",
        "lora_url":        char.get("lora_url") or "",
        "lora_trigger":    char.get("lora_trigger") or "",
        "reference_count": len(char.get("reference_images") or []),
    }


@router.post("/characters/{character_id}/reset-lora")
async def reset_lora(character_id: str):
    """Clear a stuck training status so the character can be retrained."""
    char = await _get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    await _patch_character(character_id, {
        "lora_status":     "none",
        "lora_request_id": "",
        "lora_url":        "",
    })
    return {"success": True, "message": "LoRA status reset. You can now retrain."}


# ── Character-lab preview ─────────────────────────────────────

@router.post("/character-lab/generate")
async def generate_character_preview(payload: dict):
    prompt    = payload.get("prompt") or ""
    char_data = payload.get("character") or {}
    char_id   = char_data.get("id") or ""

    # Always pull lora fields from DB — form payload never includes them
    db_char = None
    if char_id:
        db_char = await _get_character(char_id)

    lora_status_val = (db_char or char_data).get("lora_status") or ""
    lora_url        = (db_char or char_data).get("lora_url") or ""
    trigger         = (db_char or char_data).get("lora_trigger") or ""

    if lora_status_val == "training":
        return {
            "success":  False,
            "training": True,
            "message":  "LoRA training in progress. Preview will be available once training completes.",
        }

    try:
        import fal_client
        api_key = os.getenv("FAL_KEY")
        if not api_key:
            raise RuntimeError("no FAL_KEY")
        os.environ["FAL_KEY"] = api_key

        loop = asyncio.get_running_loop()

        if lora_url:
            # LoRA trained — most accurate likeness
            full_prompt = f"{trigger}, {prompt}" if trigger else prompt
            result = await loop.run_in_executor(
                None, lambda: fal_client.run("fal-ai/flux-lora", arguments={
                    "prompt":                full_prompt,
                    "loras":                 [{"path": lora_url, "scale": 1.0}],
                    "image_size":            "portrait_16_9",
                    "num_inference_steps":   30,
                    "guidance_scale":        3.5,
                    "enable_safety_checker": False,
                })
            )
            engine = "fal_flux_lora"

        else:
            # No LoRA — resolve face reference: BYO preview_images first, then LoRA refs
            import base64 as _b64
            face_url  = None
            face_bytes = None

            preview_imgs  = (db_char or {}).get("preview_images") or []
            active_idx    = int((db_char or {}).get("active_preview_index") or 0)
            byo_entry     = preview_imgs[active_idx] if preview_imgs else None

            if byo_entry:
                byo_url = byo_entry.get("url", "")
                if byo_url.startswith("http"):
                    face_url = byo_url
                else:
                    byo_path = Path(byo_url.lstrip("/"))
                    if byo_path.exists():
                        face_bytes = byo_path.read_bytes()
                        face_url   = await loop.run_in_executor(
                            None, lambda: fal_client.upload(face_bytes, "image/jpeg")
                        )

            if not face_url:
                refs     = (db_char or {}).get("reference_images") or []
                ref_path = next(
                    (Path(r.lstrip("/")) for r in refs if Path(r.lstrip("/")).exists()),
                    None
                )
                if ref_path:
                    ref_bytes = ref_path.read_bytes()
                    face_url  = await loop.run_in_executor(
                        None, lambda: fal_client.upload(ref_bytes, "image/jpeg")
                    )

            if face_url:
                result = await loop.run_in_executor(
                    None, lambda: fal_client.run("fal-ai/flux-pulid", arguments={
                        "reference_image_url": face_url,
                        "prompt":              prompt,
                        "image_size":          "portrait_4_3",
                        "num_inference_steps": 28,
                        "guidance_scale":      4.0,
                        "id_weight":           1.0,
                        "negative_prompt":     "cartoon, illustration, painting, stylized, anime, unrealistic, disfigured, back turned, rear view, from behind, back to camera, silhouette",
                        "enable_safety_checker": False,
                    })
                )
                engine = "flux_pulid"
            else:
                # No refs at all — plain Flux
                result = await loop.run_in_executor(
                    None, lambda: fal_client.run("fal-ai/flux/dev", arguments={
                        "prompt":                prompt,
                        "image_size":            "portrait_16_9",
                        "num_inference_steps":   28,
                        "guidance_scale":        3.5,
                        "num_images":            1,
                        "enable_safety_checker": False,
                    })
                )
                engine = "fal_flux"

        imgs = result.get("images") or []
        remote_url = (
            imgs[0].get("url") if imgs else None
        ) or result.get("image", {}).get("url") or result.get("url")
        if not remote_url:
            raise RuntimeError(f"No image URL in response keys: {list(result.keys())}")

        out_dir  = Path("output/renders/images")
        out_dir.mkdir(parents=True, exist_ok=True)
        ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"character-preview_{ts}_{uuid.uuid4().hex[:8]}.png"
        def _dl():
            req = urllib.request.Request(remote_url, headers={"User-Agent": "LEVRAM/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        image_bytes = await loop.run_in_executor(None, _dl)
        (out_dir / filename).write_bytes(image_bytes)
        local_url = "/output/renders/images/" + filename

        if char_id and not char_data.get("reference_image_url"):
            await _patch_character(char_id, {"reference_image_url": local_url})

        return {
            "success":   True,
            "image_url": local_url,
            "prompt":    prompt,
            "engine":    engine,
        }

    except Exception as e:
        return {"success": False, "error": str(e)[:200]}
