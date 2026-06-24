from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid
from typing import Optional

from backend.db import scenes_col, ideas_col
from backend.config import VENICE_CREATIVE_MODEL

router = APIRouter()

SCENES_DIR    = Path("data/scenes")
PROJECTS_DIR  = Path("data/project_shots")   # persistent per-project shot backup


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


TIMELINE_FILE = Path("data/timelines/main_timeline.json")


def _json_load_all() -> list[dict]:
    """Load scenes from both the scenes/ directory and the orchestrator timeline file."""
    seen_ids: set = set()
    scenes: list[dict] = []

    # Primary: orchestrator timeline (most complete, has shotDesc, obedience_score, etc.)
    if TIMELINE_FILE.exists():
        try:
            shots = json.loads(TIMELINE_FILE.read_text()).get("shots", [])
            for s in shots:
                sid = s.get("id", "")
                if sid:
                    seen_ids.add(sid)
                scenes.append(s)
        except Exception:
            pass

    # Secondary: legacy shot-builder files in data/scenes/
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    for f in sorted(SCENES_DIR.glob("*.json"), reverse=True):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                d = json.load(fh)
            sid = d.get("id", "")
            if sid and sid in seen_ids:
                continue  # orchestrator version takes precedence
            d["file"] = str(f)
            scenes.append(d)
            if sid:
                seen_ids.add(sid)
        except Exception:
            continue
    return scenes


def _json_find(scene_id: str) -> tuple[dict | None, Path | None]:
    # Check timeline first
    if TIMELINE_FILE.exists():
        try:
            shots = json.loads(TIMELINE_FILE.read_text()).get("shots", [])
            for s in shots:
                if s.get("id") == scene_id:
                    return s, TIMELINE_FILE
        except Exception:
            pass
    matches = sorted(SCENES_DIR.glob(f"*_{scene_id}_*.json"), reverse=True)
    if not matches:
        return None, None
    path = matches[0]
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), path


def _timeline_upsert(scene_id: str, updated: dict):
    """Replace a single shot in the timeline JSON file in-place."""
    shots: list = []
    if TIMELINE_FILE.exists():
        try:
            shots = json.loads(TIMELINE_FILE.read_text()).get("shots", [])
        except Exception:
            shots = []
    replaced = False
    for i, s in enumerate(shots):
        if s.get("id") == scene_id:
            shots[i] = updated
            replaced = True
            break
    if not replaced:
        shots.append(updated)
    TIMELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    TIMELINE_FILE.write_text(json.dumps({"shots": shots}, indent=2))


IDEAS_FILE = Path("data/ideas.json")


def _story_scenes_to_shots(idea: dict) -> list[dict]:
    """Convert an idea's story.scenes list into storyboard-compatible shot dicts."""
    story   = idea.get("story") or {}
    raw     = story.get("scenes") or []
    project = idea.get("project") or idea.get("title") or ""
    char1   = idea.get("character_name") or ""
    char2   = idea.get("character_name_2") or ""
    shots   = []
    for i, sc in enumerate(raw):
        shot_id = f"{idea.get('id','idea')}_{i:03d}"
        shots.append({
            "id":           shot_id,
            "shot_number":  f"SC-{i+1:03d}",
            "project":      project,
            "shotDesc":     sc.get("description") or sc.get("shot_description") or "",
            "shot_description": sc.get("description") or sc.get("shot_description") or "",
            "shot_prompt":  sc.get("image_prompt") or "",
            "dialogue":     sc.get("dialogue") or "",
            "motion_prompt": sc.get("motion") or sc.get("motion_prompt") or "",
            "character":    sc.get("character") or char1,
            "character2":   sc.get("character2") or char2,
            "location":     sc.get("location") or "",
            "act":          sc.get("act") or "",
            "emotion":      sc.get("emotion") or "",
            "_from_idea":   True,   # flag: not yet in scenes collection
        })
    return shots


async def _idea_story_fallback(project: str) -> list[dict]:
    """Pull story scenes from the ideas collection when scenes collection is empty."""
    all_shots: list[dict] = []

    if ideas_col is not None:
        query = {"story.scenes": {"$exists": True, "$ne": []}}
        if project:
            query["$or"] = [{"project": project}, {"title": project}]
        async for idea in ideas_col.find(query):
            shots = _story_scenes_to_shots(idea)
            if project:
                shots = [s for s in shots if s.get("project") == project]
            all_shots.extend(shots)
    else:
        if IDEAS_FILE.exists():
            try:
                raw = json.loads(IDEAS_FILE.read_text())
                ideas = raw if isinstance(raw, list) else raw.get("ideas", [])
                for idea in ideas:
                    if not (idea.get("story") or {}).get("scenes"):
                        continue
                    shots = _story_scenes_to_shots(idea)
                    if project:
                        shots = [s for s in shots if s.get("project") == project]
                    all_shots.extend(shots)
            except Exception:
                pass

    return all_shots


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


def _project_backup_fallback(project: str) -> list[dict]:
    """Last-resort: read imported shots from the persistent per-project backup JSON."""
    if not project:
        return []
    slug = project.replace(" ", "_").replace("/", "_")
    backup = PROJECTS_DIR / f"{slug}.json"
    if not backup.exists():
        return []
    try:
        shots = json.loads(backup.read_text(encoding="utf-8"))
        print(f"[scenes] loaded {len(shots)} shots from backup: {backup}")
        return shots
    except Exception as _e:
        print(f"[scenes] backup read failed: {_e}")
        return []


@router.get("/scenes")
async def list_scenes(project: str = ""):
    if scenes_col is not None:
        query = {"project": project} if project else {}
        docs = await scenes_col.find(query).sort("shot_number", 1).to_list(None)
        scenes = [_strip(d) for d in docs]
        if not scenes:
            scenes = await _idea_story_fallback(project)
        if not scenes:
            scenes = _project_backup_fallback(project)
        return {"success": True, "count": len(scenes), "scenes": scenes}

    all_scenes = _json_load_all()
    if project:
        all_scenes = [s for s in all_scenes if s.get("project", "") == project]
    if not all_scenes:
        all_scenes = await _idea_story_fallback(project)
    if not all_scenes:
        all_scenes = _project_backup_fallback(project)
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


@router.patch("/scene/{scene_id}")
async def patch_scene(scene_id: str, payload: dict):
    """Partial update — merges only the supplied fields, preserves everything else."""
    if not payload:
        raise HTTPException(status_code=400, detail="No fields provided")
    payload.pop("_id", None)
    payload["updated_at"] = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if scenes_col is not None:
        result = await scenes_col.find_one_and_update(
            {"id": scene_id}, {"$set": payload}, upsert=True, return_document=True
        )
        if not result:
            result = await scenes_col.find_one({"id": scene_id}) or {}
        await _sync_idea_scene(scene_id, payload)
        return {"success": True, "scene": _strip(result)}

    existing, path = _json_find(scene_id)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
    existing.update(payload)
    if path == TIMELINE_FILE:
        _timeline_upsert(scene_id, existing)
    else:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2)
    await _sync_idea_scene(scene_id, payload)
    return {"success": True, "scene": existing}


# Storyboard field → idea story scene field
_PATCH_FIELD_MAP = {
    "shotDesc":        "description",
    "shot_description":"description",
    "description":     "description",
    "shot_prompt":     "image_prompt",
    "dialogue":        "dialogue",
    "motion_prompt":   "motion_prompt",
    "motion":          "motion_prompt",
    "character":       "character",
    "character2":      "character2",
    "location":        "location",
    "emotion":         "emotion",
}


async def _sync_idea_scene(scene_id: str, payload: dict):
    """Mirror storyboard edits back to idea.story.scenes so re-develop preserves changes."""
    # Scene IDs from idea story have format {idea_id}_{idx:03d}
    parts = scene_id.rsplit("_", 1)
    if len(parts) != 2:
        return
    idea_id, idx_str = parts
    if not idx_str.isdigit():
        return
    idx = int(idx_str)

    idea_updates = {}
    for storyboard_field, idea_field in _PATCH_FIELD_MAP.items():
        if storyboard_field in payload and storyboard_field != "updated_at":
            idea_updates[f"story.scenes.{idx}.{idea_field}"] = payload[storyboard_field]
    if not idea_updates:
        return

    if ideas_col is not None:
        await ideas_col.update_one({"id": idea_id}, {"$set": idea_updates})
    else:
        if IDEAS_FILE.exists():
            try:
                raw  = json.loads(IDEAS_FILE.read_text())
                data = raw if isinstance(raw, list) else raw.get("ideas", [])
                for idea in data:
                    if idea.get("id") == idea_id:
                        scenes = (idea.get("story") or {}).get("scenes", [])
                        if idx < len(scenes):
                            for storyboard_field, idea_field in _PATCH_FIELD_MAP.items():
                                if storyboard_field in payload:
                                    scenes[idx][idea_field] = payload[storyboard_field]
                        break
                IDEAS_FILE.write_text(json.dumps(
                    raw if isinstance(raw, list) else {"ideas": data}, indent=2
                ))
            except Exception:
                pass


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
    character_id:   str = ""
    character_id_2: str = ""
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
    """Hermes refines the shot prompt within the story's context, then regenerates the image."""
    import os, asyncio
    from openai import OpenAI

    # Fetch the scene so we know its project and existing prompt
    scene_doc = None
    if scenes_col is not None:
        scene_doc = await scenes_col.find_one({"id": scene_id})
    scene_project   = (scene_doc or {}).get("project", "")
    existing_prompt = (scene_doc or {}).get("shotPrompt", "") or body.original_prompt or ""
    scene_desc      = (scene_doc or {}).get("shotDesc", "") or body.scene_description or ""
    shot_number     = (scene_doc or {}).get("shot_number", "")

    # Pull story context from the parent idea (same project name)
    from backend.db import characters_col, ideas_col
    story_title   = scene_project
    story_logline = ""
    story_genre   = "sci-fi action"
    if ideas_col is not None and scene_project:
        idea_doc = await ideas_col.find_one({"title": scene_project})
        if not idea_doc:
            idea_doc = await ideas_col.find_one({"title": {"$regex": scene_project, "$options": "i"}})
        if idea_doc:
            story_title   = idea_doc.get("title", scene_project)
            story_genre   = idea_doc.get("genre", "sci-fi action")
            story_obj     = idea_doc.get("story", {})
            story_logline = story_obj.get("logline", "") if isinstance(story_obj, dict) else ""

    # Fetch primary character (optional)
    char_doc     = None
    char_name    = ""
    char_visual  = ""
    if body.character_id and characters_col is not None:
        char_doc = await characters_col.find_one({"id": body.character_id})
        if char_doc:
            char_name   = char_doc.get("name", "")
            char_visual = " ".join(filter(None, [char_doc.get("appearance", ""), char_doc.get("wardrobe", "")]))

    # Optional second character
    char2_doc    = None
    char2_name   = ""
    char2_visual = ""
    if body.character_id_2 and characters_col is not None:
        char2_doc = await characters_col.find_one({"id": body.character_id_2})
        if char2_doc:
            char2_name   = char2_doc.get("name", "")
            char2_visual = " ".join(filter(None, [char2_doc.get("appearance", ""), char2_doc.get("wardrobe", "")]))

    venice_key = os.getenv("VENICE_API_KEY")
    if not venice_key:
        raise HTTPException(status_code=500, detail="VENICE_API_KEY not set")

    client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")

    _story_block = ""
    if story_logline:
        _story_block = f"PROJECT: {story_title} ({story_genre})\nSTORY LOGLINE: {story_logline}\n\n"
    elif story_title:
        _story_block = f"PROJECT: {story_title} ({story_genre})\n\n"

    if char_name:
        _two_char_block = f"Second character also present: {char2_name} — {char2_visual}\n" if char2_name else ""
        rewrite_prompt = (
            f"You are a cinematographer rewriting image generation prompts for LEVRAM Studios.\n\n"
            f"{_story_block}"
            f"SHOT: {shot_number}\n"
            f"SCENE ACTION: {scene_desc}\n\n"
            f"EXISTING PROMPT TO REFINE:\n{existing_prompt}\n\n"
            f"PRIMARY CHARACTER: {char_name}\n"
            f"APPEARANCE: {char_visual}\n"
            f"{_two_char_block}\n"
            f"YOUR TASK: Rewrite so {char_name} is the clear subject with accurate appearance. "
            f"KEEP the same scene action, location, and emotional tone — do NOT invent a new scenario.\n\n"
            f"RULES:\n"
            f"- FULL BODY SHOT — head to toe, face visible. Never cropped.\n"
            f"- {char_name} in a DYNAMIC POSE matching the scene action exactly.\n"
            f"{'- ' + char2_name + ' also visible in frame.' + chr(10) if char2_name else ''}"
            f"- Keep the same ENVIRONMENT from the original prompt — do not replace it.\n"
            f"- Dramatic cinematic lighting (rim light, volumetric, low-key).\n"
            f"- Photorealistic, hyperdetailed, 8K cinematic film still.\n"
            f"- No labels, no character name headers — pure visual description only.\n"
            f"Return the refined prompt paragraph only. Nothing else."
        )
    else:
        # No character — pure scene/environment regen
        rewrite_prompt = (
            f"You are a cinematographer rewriting image generation prompts for LEVRAM Studios.\n\n"
            f"{_story_block}"
            f"SHOT: {shot_number}\n"
            f"SCENE ACTION: {scene_desc}\n\n"
            f"EXISTING PROMPT TO REFINE:\n{existing_prompt}\n\n"
            f"YOUR TASK: Improve the visual quality and cinematic feel of this prompt. "
            f"KEEP the same scene action, location, and emotional tone — do NOT invent a new scenario.\n\n"
            f"RULES:\n"
            f"- Keep the same ENVIRONMENT and mood from the original prompt.\n"
            f"- Enhance lighting description (rim light, volumetric, atmospheric).\n"
            f"- Photorealistic, hyperdetailed, 8K cinematic film still.\n"
            f"- No labels, no character name headers — pure visual description only.\n"
            f"Return the refined prompt paragraph only. Nothing else."
        )

    loop = asyncio.get_event_loop()

    def _call_hermes():
        resp = client.chat.completions.create(
            model=VENICE_CREATIVE_MODEL,
            messages=[
                {"role": "system", "content": "You write cinematic image generation prompts. Return the prompt only — no commentary, no labels."},
                {"role": "user", "content": rewrite_prompt},
            ],
            temperature=0.75, max_tokens=400,
        )
        return resp.choices[0].message.content.strip()

    new_prompt = await loop.run_in_executor(None, _call_hermes)

    # Generate image — with face lock if character provided, plain if not
    try:
        from backend.routes.orchestrate import _gen_image, _apply_char2_swap, _sanitize_img
        new_prompt_clean = _sanitize_img(new_prompt)
        if body.character_id:
            image_url = await _gen_image(new_prompt_clean, body.character_id)
            if body.character_id_2:
                image_url = await _apply_char2_swap(image_url, body.character_id_2)
        else:
            from backend.routes.image_gen import _venice_generate_image, _novita_generate_image
            for _fn in [
                lambda: _venice_generate_image(new_prompt_clean, "cinematic", "cinematic photorealistic"),
                lambda: _novita_generate_image(new_prompt_clean, "cinematic", "cinematic photorealistic", "novita_photo"),
            ]:
                try:
                    result = await loop.run_in_executor(None, _fn)
                    image_url = result["imageUrl"]
                    break
                except Exception:
                    continue
            else:
                raise Exception("All providers failed for characterless regen")
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


_ENHANCE_STYLES = {
    "cinematic": (
        "Rewrite this as a cinematic film-still description for AI image generation. "
        "Detailed visual composition, lighting quality, color grade, camera angle, atmosphere. "
        "No dialogue. Pure visual language."
    ),
    "action": (
        "Rewrite as a high-energy action beat: dynamic pose, motion blur suggestion, impact, "
        "environment chaos, tension. Optimized for AI image generation."
    ),
    "dramatic": (
        "Rewrite as an intense dramatic moment: emotional weight on the face, body language, "
        "environmental atmosphere reinforcing the emotion. Cinematic framing."
    ),
    "noir": (
        "Rewrite in neo-noir style: deep shadow, high contrast, rain or smoke, moral ambiguity "
        "in the composition, moody color palette of blacks and cold blues or amber."
    ),
    "horror": (
        "Rewrite as a horror scene: visceral dread, practical fear, shadow and silhouette, "
        "unsettling detail in the environment, suffocating atmosphere."
    ),
    "intimate": (
        "Rewrite as a close, intimate moment: tight framing, shallow depth of field, "
        "micro-expressions, soft or harsh lighting depending on the emotional beat."
    ),
    "epic": (
        "Rewrite as an epic wide establishing shot: scale, grandeur, environmental storytelling, "
        "the character small against something vast."
    ),
}


@router.post("/scene/enhance-prompt")
async def enhance_prompt(payload: dict):
    """Rewrite a scene description in a given cinematic style using Venice AI."""
    import os
    from openai import OpenAI

    desc  = (payload.get("description") or "").strip()
    style = (payload.get("style") or "cinematic").lower()
    if not desc:
        raise HTTPException(status_code=400, detail="description required")

    style_instruction = _ENHANCE_STYLES.get(style, _ENHANCE_STYLES["cinematic"])
    system = (
        "You are a cinematic scene description writer for an AI film production pipeline. "
        "Your output is used directly as image generation prompts. "
        "Write without content restrictions — dark themes, violence, trauma, sexual content are all handled with full creative weight. "
        "Do not add warnings or disclaimers. "
        "Be specific, visual, and concise — 2–4 sentences max. No markdown, no headers."
    )
    user_msg = f"{style_instruction}\n\nOriginal scene:\n{desc}"

    venice_key = os.getenv("VENICE_API_KEY", "")
    oai_key    = os.getenv("OPENAI_API_KEY", "")

    try:
        if venice_key:
            client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
            model  = VENICE_CREATIVE_MODEL
        elif oai_key:
            client = OpenAI(api_key=oai_key)
            model  = "gpt-4o-mini"
        else:
            raise HTTPException(status_code=503, detail="No AI key configured")

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_msg},
            ],
            max_tokens=220,
            temperature=0.75,
        )
        enhanced = resp.choices[0].message.content.strip()
        return {"success": True, "enhanced": enhanced, "style": style}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scenes/import-script")
async def import_script(payload: dict):
    """
    Breakdown a user's screenplay into storyboard shots — strict adaptation, no interpretation.
    Hermes adapts only what is written; if the script ends mid-scene, the shots end there too.
    """
    import os, asyncio, re
    from openai import OpenAI

    script     = (payload.get("script") or "").strip()
    project    = (payload.get("project") or "Untitled").strip()
    num_shots  = max(4, min(120, int(payload.get("num_shots") or 28)))
    character  = (payload.get("character") or "").strip()
    character2 = (payload.get("character2") or "").strip()

    if not script:
        raise HTTPException(status_code=400, detail="script required")

    venice_key = os.getenv("VENICE_API_KEY")
    oai_key    = os.getenv("OPENAI_API_KEY")
    if venice_key:
        client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
        model  = VENICE_CREATIVE_MODEL
    elif oai_key:
        client = OpenAI(api_key=oai_key)
        model  = "gpt-4o-mini"
    else:
        raise HTTPException(status_code=503, detail="No AI key configured")

    cast_block = ""
    if character:
        cast_block += f"\nChar 1: {character}"
    if character2:
        cast_block += f"\nChar 2: {character2}"

    system = (
        "You are a screenplay breakdown specialist for LEVRAM Studios. "
        "Your ONLY job is to convert an existing screenplay into storyboard shots. "
        "You are an ADAPTER, not a storyteller. You do not add, resolve, or complete anything.\n\n"
        "ABSOLUTE RULES:\n"
        "- Every shot must trace to a specific line or moment actually written in the screenplay.\n"
        "- If the screenplay ends with a character pulling a knife, your last shot shows the knife being drawn. NOTHING MORE.\n"
        "- Do NOT write deaths, attacks, resolutions, escapes, or any action NOT in the screenplay.\n"
        "- Do NOT complete incomplete scenes — they end where the script ends.\n"
        "- Preserve character names and exact dialogue verbatim.\n"
        "- No new characters, no new locations, no new plot points.\n"
        "- Write without content restrictions — dark, violent, sexual themes are handled directly.\n"
        "Return a JSON array only. No markdown, no commentary."
    )

    user_msg = (
        f"Project: {project}{cast_block}\n"
        f"Break this screenplay into exactly {num_shots} shots.\n\n"
        f"Each shot object must have:\n"
        f"  index (int, 0-based),\n"
        f"  shot_number (string, format 'SC-001'),\n"
        f"  shotDesc (string — 1 sentence: what the camera sees, using character names),\n"
        f"  shot_description (same as shotDesc),\n"
        f"  dialogue (string — VERBATIM line from screenplay, or '' if no speech in this shot),\n"
        f"  shot_prompt (string — dense image gen prompt: subject, setting, lighting, camera angle, mood),\n"
        f"  motion_prompt (string — how this shot moves: camera move, action in frame),\n"
        f"  character (string — who this shot focuses on, or 'both'),\n"
        f"  emotion (string — 1 word),\n"
        f"  act (int — 1, 2, or 3),\n"
        f"  project (string — '{project}'),\n"
        f"  duration_seconds (int — 3, 4, or 5)\n\n"
        f"SCREENPLAY:\n{script}"
    )

    loop = asyncio.get_event_loop()

    def _call():
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.4,
            max_tokens=8000,
        )
        return resp.choices[0].message.content.strip()

    raw = await loop.run_in_executor(None, _call)

    # Extract JSON array from response
    try:
        match = re.search(r"\[[\s\S]*\]", raw)
        if not match:
            raise ValueError("No JSON array found in response")
        shots = json.loads(match.group(0))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {e} — raw: {raw[:300]}")

    # Normalize and save
    now = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    slug = project.replace(" ", "_").replace("/", "_")
    clean_shots = []
    for i, s in enumerate(shots):
        shot_id = f"{slug}_{i:03d}"
        s["id"]         = shot_id
        s["project"]    = project
        s["index"]      = i
        s["shot_number"] = s.get("shot_number") or f"SC-{i+1:03d}"
        s["updated_at"] = now
        s.pop("_id", None)
        clean_shots.append(s)

    # Persist to MongoDB scenes collection
    if scenes_col is not None:
        await scenes_col.delete_many({"project": project})
        if clean_shots:
            await scenes_col.insert_many([dict(s) for s in clean_shots])
    else:
        # Write to timeline JSON
        TIMELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing = {"shots": []}
        if TIMELINE_FILE.exists():
            try:
                existing = json.loads(TIMELINE_FILE.read_text())
            except Exception:
                pass
        kept = [sh for sh in existing.get("shots", []) if sh.get("project") != project]
        TIMELINE_FILE.write_text(json.dumps({"shots": kept + clean_shots}, indent=2))

    # ── Persistent backup: always write project shots to disk regardless of DB state ──
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        (PROJECTS_DIR / f"{slug}.json").write_text(
            json.dumps(clean_shots, indent=2), encoding="utf-8"
        )
        print(f"[import-script] backup written → data/project_shots/{slug}.json")
    except Exception as _bk_err:
        print(f"[import-script] backup write failed (non-fatal): {_bk_err}")

    # ── Sync to idea.story.scenes — upsert so project doesn't need a pre-existing idea ──
    if ideas_col is not None and clean_shots:
        try:
            synced_scenes = [{
                "description":      s.get("shotDesc") or s.get("shot_description") or "",
                "image_prompt":     s.get("shot_prompt") or s.get("shotDesc") or "",
                "dialogue":         s.get("dialogue") or "",
                "motion_prompt":    s.get("motion_prompt") or "",
                "character":        s.get("character") or "",
                "character2":       s.get("character2") or "",
                "location":         s.get("location") or "",
                "emotion":          s.get("emotion") or "",
                "duration_seconds": s.get("duration_seconds") or 5,
            } for s in clean_shots]
            await ideas_col.update_one(
                {"title": project},
                {"$set": {
                    "story.scenes": synced_scenes,
                    "status":       "developed",
                    "title":        project,
                    "project":      project,
                    "updatedAt":    now,
                }},
                upsert=True,
            )
            print(f"[import-script] idea.story.scenes synced for '{project}'")
        except Exception as _sync_err:
            print(f"[import-script] idea sync failed (non-fatal): {_sync_err}")

    return {"success": True, "shots": [_strip(s) for s in clean_shots]}


@router.delete("/scene/{scene_id}")
async def delete_scene(scene_id: str):
    found_anywhere = False

    # 1. MongoDB
    if scenes_col is not None:
        try:
            result = await scenes_col.delete_many({"id": scene_id})
            if result.deleted_count > 0:
                found_anywhere = True
        except Exception as e:
            print(f"[SCENE DELETE] MongoDB failed ({e}), continuing to file fallback")

    # 2. Main timeline JSON (where orchestrator/storyboard shots live)
    if TIMELINE_FILE.exists():
        try:
            data = json.loads(TIMELINE_FILE.read_text())
            shots = data.get("shots", [])
            before = len(shots)
            shots = [s for s in shots if s.get("id") != scene_id]
            if len(shots) < before:
                found_anywhere = True
                # Renumber
                for i, s in enumerate(shots, 1):
                    s["shot_number"] = f"SC-{i:03d}"
                TIMELINE_FILE.write_text(json.dumps({"shots": shots}, indent=2))
        except Exception as e:
            print(f"[SCENE DELETE] Timeline file error ({e})")

    # 3. Idea Vault embedded story.scenes  (ID format: {idea_id}_{index:03d})
    if not found_anywhere and "_" in scene_id:
        try:
            parts     = scene_id.rsplit("_", 1)
            idea_id   = parts[0]
            scene_idx = int(parts[1])

            if ideas_col is not None:
                idea = await ideas_col.find_one({"id": idea_id})
            else:
                from pathlib import Path as _P
                _ideas_file = _P("data/ideas.json")
                _all = json.loads(_ideas_file.read_text()).get("ideas", []) if _ideas_file.exists() else []
                idea = next((x for x in _all if x.get("id") == idea_id), None)

            if idea:
                scenes = list((idea.get("story") or {}).get("scenes", []))
                if 0 <= scene_idx < len(scenes):
                    scenes.pop(scene_idx)
                    if ideas_col is not None:
                        await ideas_col.update_one(
                            {"id": idea_id},
                            {"$set": {"story.scenes": scenes}}
                        )
                    else:
                        _ideas_file = _P("data/ideas.json")
                        _data = json.loads(_ideas_file.read_text())
                        for _idea in _data.get("ideas", []):
                            if _idea.get("id") == idea_id:
                                (_idea.get("story") or {})["scenes"] = scenes
                        _ideas_file.write_text(json.dumps(_data, indent=2))
                    found_anywhere = True
        except Exception as e:
            print(f"[SCENE DELETE] Idea story splice failed ({e})")

    # 4. Legacy shot-builder files
    SCENES_DIR.mkdir(parents=True, exist_ok=True)
    for f in SCENES_DIR.glob(f"*_{scene_id}_*.json"):
        try:
            f.unlink()
            found_anywhere = True
        except Exception:
            pass

    if not found_anywhere:
        raise HTTPException(status_code=404, detail=f"Scene {scene_id} not found")
    return {"success": True, "scene_id": scene_id}


@router.post("/scene/write-scene")
async def write_scene(payload: dict):
    """AI agent: given a scene description + characters, writes dialogue and camera motion."""
    import os
    from openai import OpenAI

    description = (payload.get("description") or "").strip()
    char1       = (payload.get("character") or "").strip()
    char2       = (payload.get("character2") or "").strip()
    tone        = (payload.get("tone") or "cinematic dark superhero").strip()

    if not description:
        raise HTTPException(status_code=400, detail="description required")

    cast_line = ""
    if char1 and char2:
        cast_line = f"Characters in scene: {char1} and {char2}."
    elif char1:
        cast_line = f"Character in scene: {char1}."

    system = (
        "You are a screenwriter and cinematographer for a dark superhero film production pipeline. "
        "Given a visual scene description, you write two things:\n"
        "1. DIALOGUE: spoken lines for the characters in this scene (or 'No dialogue — silent scene' if none fits)\n"
        "2. MOTION: a single sentence describing camera motion and action choreography for video generation "
        "(e.g. 'Slow push-in on face, rack focus to hand as veins pulse outward — hold on close-up')\n\n"
        "Tone: dark, cinematic, grounded — no jokes, no exposition dumps.\n"
        "Output ONLY valid JSON: {\"dialogue\": \"...\", \"motion\": \"...\"}\n"
        "No markdown, no code blocks, no extra text."
    )
    user_msg = f"Tone: {tone}\n{cast_line}\n\nScene:\n{description}"

    venice_key = os.getenv("VENICE_API_KEY", "")
    oai_key    = os.getenv("OPENAI_API_KEY", "")

    try:
        if venice_key:
            client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
            model  = VENICE_CREATIVE_MODEL
        elif oai_key:
            client = OpenAI(api_key=oai_key)
            model  = "gpt-4o-mini"
        else:
            raise HTTPException(status_code=503, detail="No AI key configured")

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_msg},
            ],
            max_tokens=300,
            temperature=0.8,
        )
        raw = resp.choices[0].message.content.strip()
        # Strip code fences if model wraps anyway
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        return {
            "success":  True,
            "dialogue": result.get("dialogue", ""),
            "motion":   result.get("motion", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
