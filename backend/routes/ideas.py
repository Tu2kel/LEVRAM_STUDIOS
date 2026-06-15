from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
from math import ceil
import json, uuid, asyncio, os

from backend.db import ideas_col

router = APIRouter()
DATA_FILE = Path("data/ideas.json")


class IdeaPayload(BaseModel):
    title: str
    source: str = ""
    rawIdea: str
    tags: list[str] = []
    genre: str = "sci-fi action"
    target_minutes: float = 8.0
    scene_seconds: int = 5


class DevelopRequest(BaseModel):
    character_name: str = ""
    target_minutes: float = 8.0
    scene_seconds: int = 5


def _ensure():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text(json.dumps({"ideas": []}, indent=2))


def _load():
    _ensure()
    return json.loads(DATA_FILE.read_text())


def _save(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


def _strip(doc):
    d = dict(doc)
    d.pop("_id", None)
    return d


@router.get("/ideas")
async def get_ideas():
    if ideas_col is not None:
        docs = await ideas_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "ideas": [_strip(d) for d in docs]}
    return {"success": True, "ideas": _load()["ideas"]}


@router.post("/ideas")
async def save_idea(payload: IdeaPayload):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    idea = {"id": str(uuid.uuid4()), "title": payload.title, "source": payload.source,
            "rawIdea": payload.rawIdea, "tags": payload.tags, "status": "raw",
            "genre": payload.genre, "target_minutes": payload.target_minutes,
            "scene_seconds": payload.scene_seconds,
            "story": None,
            "createdAt": now, "updatedAt": now}
    if ideas_col is not None:
        await ideas_col.insert_one(idea)
        docs = await ideas_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "idea": _strip(idea), "ideas": [_strip(d) for d in docs]}
    data = _load()
    data["ideas"].insert(0, idea)
    _save(data)
    return {"success": True, "idea": idea, "ideas": data["ideas"]}


@router.delete("/ideas/{idea_id}")
async def delete_idea(idea_id: str):
    if ideas_col is not None:
        await ideas_col.delete_one({"id": idea_id})
        docs = await ideas_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "ideas": [_strip(d) for d in docs]}
    data = _load()
    data["ideas"] = [i for i in data["ideas"] if i["id"] != idea_id]
    _save(data)
    return {"success": True, "ideas": data["ideas"]}


def _get_idea(idea_id: str) -> dict | None:
    data = _load()
    return next((i for i in data["ideas"] if i["id"] == idea_id), None)


async def _get_idea_any(idea_id: str) -> dict | None:
    """Read from MongoDB if available, else fall back to JSON file."""
    if ideas_col is not None:
        doc = await ideas_col.find_one({"id": idea_id})
        return _strip(doc) if doc else None
    return _get_idea(idea_id)


async def _patch_idea_any(idea_id: str, updates: dict):
    """Write to MongoDB if available, else fall back to JSON file."""
    updates["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if ideas_col is not None:
        await ideas_col.update_one({"id": idea_id}, {"$set": updates})
        return
    data = _load()
    for i in data["ideas"]:
        if i["id"] == idea_id:
            i.update(updates)
    _save(data)


def _patch_idea(idea_id: str, updates: dict):
    data = _load()
    for i in data["ideas"]:
        if i["id"] == idea_id:
            i.update(updates)
            i["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _save(data)


@router.post("/ideas/{idea_id}/develop")
async def develop_idea(idea_id: str, body: DevelopRequest):
    idea = await _get_idea_any(idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")

    target_sec  = body.target_minutes * 60
    num_scenes  = ceil((target_sec / body.scene_seconds) * 1.1)  # 10% buffer

    story = await _gpt_develop(
        concept        = idea["rawIdea"],
        genre          = idea.get("genre", "sci-fi action"),
        character_name = body.character_name,
        num_scenes     = num_scenes,
        scene_seconds  = body.scene_seconds,
        target_minutes = body.target_minutes,
    )

    scenes = story.get("scenes", [])
    story["num_scenes"]    = num_scenes
    story["scene_seconds"] = body.scene_seconds
    story["est_seconds"]   = len(scenes) * body.scene_seconds
    story["est_minutes"]   = round(story["est_seconds"] / 60, 1)
    story["reel_60s"]      = _top_scene_indices(scenes, 60,  body.scene_seconds)
    story["reel_30s"]      = _top_scene_indices(scenes, 30,  body.scene_seconds)
    story["reel_15s"]      = _top_scene_indices(scenes, 15,  body.scene_seconds)

    await _patch_idea_any(idea_id, {"story": story, "status": "developed",
                                    "target_minutes": body.target_minutes,
                                    "scene_seconds": body.scene_seconds})
    return {"success": True, "story": story}


@router.patch("/ideas/{idea_id}")
async def update_idea(idea_id: str, body: dict):
    """Update core idea fields — title, rawIdea, genre, tags, target_minutes, scene_seconds."""
    allowed = {"title", "rawIdea", "genre", "tags", "target_minutes", "scene_seconds"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    updates["updatedAt"] = now
    if ideas_col is not None:
        await ideas_col.update_one({"id": idea_id}, {"$set": updates})
        doc = await ideas_col.find_one({"id": idea_id}, {"_id": 0})
        return {"success": True, "idea": doc}
    _patch_idea(idea_id, updates)
    idea = _get_idea(idea_id)
    return {"success": True, "idea": idea}


@router.patch("/ideas/{idea_id}/story")
async def update_story(idea_id: str, body: dict):
    idea = await _get_idea_any(idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    story = dict(idea.get("story") or {})
    story.update(body)
    await _patch_idea_any(idea_id, {"story": story})
    return {"success": True, "story": story}


@router.post("/ideas/{idea_id}/approve")
async def approve_idea(idea_id: str):
    idea = await _get_idea_any(idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    await _patch_idea_any(idea_id, {"status": "approved"})
    return {"success": True, "idea_id": idea_id}


# ── GPT developer ──────────────────────────────────────────────

async def _gpt_develop(
    concept: str, genre: str, character_name: str,
    num_scenes: int, scene_seconds: int, target_minutes: float,
) -> dict:
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    loop   = asyncio.get_event_loop()

    system = (
        "You are a cinematic story developer for LEVRAM Studios. "
        "Return ONLY valid JSON — no markdown fences, no commentary."
    )
    user = (
        f"Concept: {concept}\n"
        f"Genre: {genre}\n"
        f"Main character: {character_name or 'unnamed'}\n"
        f"Target runtime: {target_minutes} minutes\n"
        f"Scenes needed: {num_scenes} scenes × {scene_seconds}s each\n\n"
        f"Return a JSON object with:\n"
        f"  title         – story title\n"
        f"  logline       – one sentence summary\n"
        f"  act_structure – brief 3-act breakdown (string)\n"
        f"  scenes        – array of exactly {num_scenes} scene objects, each with:\n"
        f"    index        (int, 0-based)\n"
        f"    act          (1, 2, or 3)\n"
        f"    description  (one sentence)\n"
        f"    image_prompt (detailed visual prompt — setting, action, lighting, costume)\n"
        f"    dialogue     (optional short spoken line or narration, or empty string)\n"
        f"    reel_weight  (int 1-10 — impact value for highlight reel)\n"
        f"    emotion      (single word: tension, triumph, mystery, etc.)\n"
    )

    def _call():
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.85,
            max_tokens=6000,
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)

    return await loop.run_in_executor(None, _call)


def _top_scene_indices(scenes: list, reel_sec: int, scene_sec: int) -> list[int]:
    capacity = max(1, reel_sec // scene_sec)
    ranked   = sorted(scenes, key=lambda s: s.get("reel_weight", 0), reverse=True)
    return sorted(s.get("index", 0) for s in ranked[:capacity])
