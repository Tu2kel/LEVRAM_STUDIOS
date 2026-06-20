from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid
from typing import Optional

from backend.db import scenes_col

router = APIRouter()

SCENES_DIR = Path("data/scenes")


class ScenePayload(BaseModel):
    saga: str = ""
    project: str = ""
    scene_number: str = ""
    shot_type: str = ""
    camera_mood: str = ""
    color_palette: str = ""
    ai_engine: str = ""
    shot_description: str = ""
    shot_prompt: str = ""
    negative_prompt: str = ""
    character: str = ""
    duration: str = ""
    voice_character: str = ""
    voice_preset: str = ""
    rawUrl: str | None = None
    fxUrl: str | None = None


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


def _build(scene: ScenePayload, scene_id: str, now: str, existing: dict | None = None) -> dict:
    data = scene.model_dump()
    data["id"] = scene_id
    data["prompt_version"] = "v1_cinematic"
    data["prompt_score"] = min(100, 40 + len(data.get("shot_prompt", "")) // 8)
    data["updated_at"] = now
    data["saved_at"] = (existing or {}).get("saved_at", now)
    return data


# ─── JSON fallback helpers ─────────────────────────────────────

def _json_save(scene_id: str, data: dict):
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    saga_slug = (data.get("saga") or data.get("project") or "default").replace(" ", "_").replace("/", "_")
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    file_path = SCENES_DIR / f"{saga_slug}_{scene_id}_{ts}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return str(file_path)


def _json_load_all() -> list[dict]:
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    scenes = []
    for f in sorted(SCENES_DIR.glob("*.json"), reverse=True):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                d = json.load(fh)
                d["file"] = str(f)
                scenes.append(d)
        except Exception:
            continue
    return scenes


def _json_find(scene_id: str) -> tuple[dict | None, Path | None]:
    matches = sorted(SCENES_DIR.glob(f"*_{scene_id}_*.json"), reverse=True)
    if not matches:
        return None, None
    path = matches[0]
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), path


# ─── Routes ───────────────────────────────────────────────────


@router.post("/save-scene")
async def save_scene(scene: ScenePayload):
    scene_id = scene.scene_number.strip() or f"SC-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    data = _build(scene, scene_id, now)

    if scenes_col is not None:
        await scenes_col.delete_many({"id": scene_id})
        await scenes_col.insert_one(data)
        return {"success": True, "scene": _strip(data)}

    file_path = _json_save(scene_id, data)
    return {"success": True, "scene": data, "file": file_path}


@router.get("/scenes")
async def list_scenes(project: str = ""):
    if scenes_col is not None:
        query = {"project": project} if project else {}
        docs = await scenes_col.find(query).sort("shot_number", 1).to_list(None)
        return {"success": True, "count": len(docs), "scenes": [_strip(d) for d in docs]}

    all_scenes = _json_load_all()
    if project:
        all_scenes = [s for s in all_scenes if s.get("project", "") == project]
    return {"success": True, "count": len(all_scenes), "scenes": all_scenes}


@router.delete("/scenes/clear")
async def clear_project_scenes(project: str):
    """Delete all scenes for a given project — called before a fresh pipeline run."""
    if not project:
        return {"success": False, "detail": "project required"}
    if scenes_col is not None:
        result = await scenes_col.delete_many({"project": project})
        return {"success": True, "deleted": result.deleted_count}
    deleted = 0
    if SCENES_DIR.exists():
        slug = project.replace(" ", "_").replace("/", "_")
        for f in SCENES_DIR.glob(f"{slug}_*.json"):
            f.unlink()
            deleted += 1
    return {"success": True, "deleted": deleted}


@router.delete("/scenes/clear-all")
async def clear_all_scenes():
    """Erase every scene in the database — full timeline wipe."""
    if scenes_col is not None:
        result = await scenes_col.delete_many({})
        return {"success": True, "deleted": result.deleted_count}
    deleted = 0
    if SCENES_DIR.exists():
        for f in SCENES_DIR.glob("*.json"):
            f.unlink()
            deleted += 1
    return {"success": True, "deleted": deleted}


@router.put("/scene/{scene_id}")
async def update_scene(scene_id: str, scene: ScenePayload):
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if scenes_col is not None:
        existing_doc = await scenes_col.find_one({"id": scene_id})
        data = _build(scene, scene_id, now, existing_doc)
        result = await scenes_col.find_one_and_update(
            {"id": scene_id}, {"$set": data}, return_document=True
        )
        if not result:
            raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
        return {"success": True, "scene": _strip(result)}

    existing, path = _json_find(scene_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
    data = _build(scene, scene_id, now, existing)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return {"success": True, "scene": data, "file": str(path)}


class RegenImageRequest(BaseModel):
    prompt: Optional[str] = None
    character_id: Optional[str] = None


class AiRegenRequest(BaseModel):
    character_id: str
    scene_description: Optional[str] = ""
    original_prompt: Optional[str] = ""


@router.post("/scene/{scene_id}/regen-image")
async def regen_scene_image(scene_id: str, body: RegenImageRequest):
    """Regenerate the keyframe image for a single scene."""
    # Fetch existing scene
    scene_doc = None
    if scenes_col is not None:
        scene_doc = await scenes_col.find_one({"id": scene_id})
        if scene_doc:
            scene_doc = {k: v for k, v in scene_doc.items() if k != "_id"}
    else:
        scene_doc, _ = _json_find(scene_id)

    if not scene_doc:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")

    prompt = (
        body.prompt
        or scene_doc.get("shotPrompt")
        or scene_doc.get("shot_prompt")
        or scene_doc.get("shotDesc")
        or scene_doc.get("shot_description")
        or ""
    )
    if not prompt:
        raise HTTPException(status_code=400, detail="No prompt found for this scene")

    # Resolve character_id — from request or look up by name
    char_id = body.character_id or ""
    if not char_id:
        char_name = scene_doc.get("character", "")
        if char_name and scenes_col is not None:
            from backend.db import characters_col
            if characters_col is not None:
                char_doc = await characters_col.find_one({"name": char_name})
                if char_doc:
                    char_id = char_doc.get("id", "")

    # Generate new image
    try:
        from backend.routes.orchestrate import _gen_image, _sanitize_img
        prompt = _sanitize_img(prompt)
        image_url = await _gen_image(prompt, char_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image gen failed: {str(e)[:200]}")

    # Persist updated imageUrl back to scene
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    updates = {"imageUrl": image_url, "renderOutputUrl": image_url, "updated_at": now}

    if scenes_col is not None:
        await scenes_col.update_one({"id": scene_id}, {"$set": updates})
    else:
        _, path = _json_find(scene_id)
        if path:
            with open(path, "r", encoding="utf-8") as f:
                d = json.load(f)
            d.update(updates)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(d, f, indent=2)

    # Also update the local timeline JSON so timeline.html stays in sync
    TIMELINE_FILE = Path("data/timelines/main_timeline.json")
    if TIMELINE_FILE.exists():
        try:
            data = json.loads(TIMELINE_FILE.read_text())
            shots = data.get("shots", [])
            for s in shots:
                if s.get("id") == scene_id:
                    s["imageUrl"] = image_url
                    s["renderOutputUrl"] = image_url
                    break
            TIMELINE_FILE.write_text(json.dumps({"shots": shots}, indent=2))
        except Exception:
            pass

    return {"success": True, "imageUrl": image_url, "scene_id": scene_id}


@router.post("/scene/{scene_id}/ai-regen")
async def ai_regen_scene(scene_id: str, body: AiRegenRequest):
    """Hermes rewrites the shot_prompt focused on the selected character, then regenerates the image."""
    import os, asyncio
    from openai import OpenAI

    # Fetch character from DB
    from backend.db import characters_col
    char_doc = None
    if characters_col is not None:
        char_doc = await characters_col.find_one({"id": body.character_id})
    if not char_doc:
        raise HTTPException(status_code=404, detail="Character not found")

    char_name   = char_doc.get("name", "Character")
    appearance  = char_doc.get("appearance", "")
    wardrobe    = char_doc.get("wardrobe", "")
    char_visual = " ".join(filter(None, [appearance, wardrobe]))

    venice_key = os.getenv("VENICE_API_KEY")
    if not venice_key:
        raise HTTPException(status_code=500, detail="VENICE_API_KEY not set")

    client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")

    rewrite_prompt = (
        f"You are a cinematographer writing image generation prompts for LEVRAM Studios.\n\n"
        f"Scene action: {body.scene_description}\n"
        f"Camera subject: {char_name}\n"
        f"Their appearance: {char_visual}\n\n"
        f"Write ONE dense paragraph image generation prompt. RULES:\n"
        f"- FULL BODY SHOT — head to toe. Never a portrait, never a headshot, never cropped.\n"
        f"- {char_name} must be in a DYNAMIC POSE matching the scene action — not standing neutrally.\n"
        f"- Include the scene ENVIRONMENT (darkness, fire, wasteland, shadows, etc.) — never a plain background.\n"
        f"- Dramatic cinematic lighting (rim light, volumetric, low-key) — never flat or studio lighting.\n"
        f"- Low angle or Dutch angle preferred to convey power and threat.\n"
        f"- Open with {char_name}'s full physical description, then pose, then environment, then lighting.\n"
        f"- Photorealistic, hyperdetailed, 8K cinematic film still.\n"
        f"- No labels, no character name headers — pure visual description only.\n"
        f"Return the prompt paragraph only. Nothing else."
    )

    loop = asyncio.get_event_loop()

    def _call_hermes():
        resp = client.chat.completions.create(
            model="hermes-3-llama-3.1-405b",
            messages=[
                {"role": "system", "content": "You write cinematic image generation prompts. Return the prompt only — no commentary, no labels."},
                {"role": "user", "content": rewrite_prompt},
            ],
            temperature=0.75, max_tokens=400,
        )
        return resp.choices[0].message.content.strip()

    new_prompt = await loop.run_in_executor(None, _call_hermes)

    # Generate image with new prompt + character face lock
    try:
        from backend.routes.orchestrate import _gen_image, _sanitize_img
        new_prompt_clean = _sanitize_img(new_prompt)
        image_url = await _gen_image(new_prompt_clean, body.character_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image gen failed: {str(e)[:200]}")

    # Persist updates
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    updates = {"imageUrl": image_url, "renderOutputUrl": image_url, "shotPrompt": new_prompt, "updated_at": now}
    if scenes_col is not None:
        await scenes_col.update_one({"id": scene_id}, {"$set": updates})

    TIMELINE_FILE = Path("data/timelines/main_timeline.json")
    if TIMELINE_FILE.exists():
        try:
            data = json.loads(TIMELINE_FILE.read_text())
            for s in data.get("shots", []):
                if s.get("id") == scene_id:
                    s.update(updates)
                    break
            TIMELINE_FILE.write_text(json.dumps(data, indent=2))
        except Exception:
            pass

    return {"success": True, "imageUrl": image_url, "new_prompt": new_prompt, "scene_id": scene_id}


@router.delete("/scene/{scene_id}")
async def delete_scene(scene_id: str):
    if scenes_col is not None:
        result = await scenes_col.delete_many({"id": scene_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
        return {"success": True, "scene_id": scene_id}

    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    matches = list(SCENES_DIR.glob(f"*_{scene_id}_*.json"))
    if not matches:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
    deleted = []
    for f in matches:
        f.unlink()
        deleted.append(str(f))
    return {"success": True, "scene_id": scene_id, "deleted": deleted}
