from fastapi import APIRouter, Header, HTTPException
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
    character_id: str = ""
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
async def get_ideas(x_studio: str = Header(default="levram")):
    if ideas_col is not None:
        docs = await ideas_col.find({
            "$or": [{"studio": x_studio}, {"studio": {"$exists": False}}]
        }).sort("createdAt", -1).to_list(None)
        # Backfill missing studio field
        for doc in docs:
            if not doc.get("studio"):
                await ideas_col.update_one({"id": doc["id"]}, {"$set": {"studio": x_studio}})
        return {"success": True, "ideas": [_strip(d) for d in docs]}
    ideas = [i for i in _load()["ideas"] if i.get("studio", "levram") == x_studio]
    return {"success": True, "ideas": ideas}


@router.post("/ideas")
async def save_idea(payload: IdeaPayload, x_studio: str = Header(default="levram")):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    idea = {"id": str(uuid.uuid4()), "title": payload.title, "source": payload.source,
            "rawIdea": payload.rawIdea, "tags": payload.tags, "status": "raw",
            "genre": payload.genre, "target_minutes": payload.target_minutes,
            "scene_seconds": payload.scene_seconds,
            "story": None, "studio": x_studio,
            "createdAt": now, "updatedAt": now}
    if ideas_col is not None:
        await ideas_col.insert_one(idea)
        docs = await ideas_col.find({"studio": x_studio}).sort("createdAt", -1).to_list(None)
        return {"success": True, "idea": _strip(idea), "ideas": [_strip(d) for d in docs]}
    data = _load()
    data["ideas"].insert(0, idea)
    _save(data)
    scoped = [i for i in data["ideas"] if i.get("studio", "levram") == x_studio]
    return {"success": True, "idea": idea, "ideas": scoped}


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

    target_sec  = int(body.target_minutes * 60)

    story = await _gpt_develop(
        concept        = idea["rawIdea"],
        genre          = idea.get("genre", "sci-fi action"),
        character_name = body.character_name,
        num_scenes     = 0,           # unused — Venice decides scene count
        scene_seconds  = body.scene_seconds,
        target_minutes = body.target_minutes,
    )

    scenes = story.get("scenes", [])
    actual_total_sec = sum(s.get("duration_seconds", 5) for s in scenes)
    num_scenes  = len(scenes)
    story["num_scenes"]      = num_scenes
    story["actual_scenes"]   = num_scenes
    story["target_minutes"]  = body.target_minutes
    story["est_seconds"]     = actual_total_sec
    story["est_minutes"]     = round(actual_total_sec / 60, 1)
    story["reel_60s"]        = _top_scene_indices(scenes, 60,  5)
    story["reel_30s"]        = _top_scene_indices(scenes, 30,  5)
    story["reel_15s"]        = _top_scene_indices(scenes, 15,  5)

    patch = {"story": story, "status": "developed",
             "target_minutes": body.target_minutes,
             "scene_seconds": body.scene_seconds}
    if body.character_id:
        patch["character_id"]   = body.character_id
        patch["character_name"] = body.character_name
    await _patch_idea_any(idea_id, patch)
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


def _count_lyric_lines(concept: str) -> int:
    """Count numbered lyric lines in concept (lines after a LYRICS: marker)."""
    lines = concept.splitlines()
    in_lyrics = False
    count = 0
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if "LYRICS" in stripped.upper() and stripped.upper().endswith(":"):
            in_lyrics = True
            continue
        if in_lyrics and stripped:
            count += 1
    return count


# ── GPT developer ──────────────────────────────────────────────

async def _gpt_develop(
    concept: str, genre: str, character_name: str,
    num_scenes: int, scene_seconds: int, target_minutes: float,
) -> dict:
    from openai import OpenAI
    loop = asyncio.get_event_loop()

    is_adult = "adult" in genre.lower()
    if is_adult and os.getenv("VENICE_API_KEY"):
        # Adult content → Venice uncensored (no content policy restrictions)
        client = OpenAI(
            api_key=os.getenv("VENICE_API_KEY"),
            base_url="https://api.venice.ai/api/v1",
        )
        model = "venice-uncensored"
    else:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = "gpt-4o-mini"

    # Count lyric lines — if present, scene count is locked to lyric count
    lyric_lines  = _count_lyric_lines(concept)
    target_sec   = int(target_minutes * 60)

    adult_rules = (
        "\nADULT CONTENT RULES:\n"
        "A. Descriptions MUST be sexually explicit — body contact, undressing, explicit acts. No euphemisms.\n"
        "B. Escalate: Act 1 = tension/flirting, Act 2 = foreplay/undressing, Act 3 = explicit sex acts.\n"
        "C. Dialogue: original, in-character, explicit. NEVER song lyrics. Max 12 words per line.\n"
    ) if is_adult else ""

    if lyric_lines:
        scene_count_rule = f"SCENE COUNT LOCKED AT {lyric_lines} — one scene per lyric line, in order."
    else:
        scene_count_rule = (
            f"TARGET DURATION: {target_minutes} min ({target_sec}s total). "
            f"You decide how many scenes are needed. Each scene has a duration_seconds (5–10). "
            f"The sum of all duration_seconds must be approximately {target_sec}s. "
            f"Do not pad — every scene must advance the story."
        )

    system = (
        "You are a scene breakdown writer for LEVRAM Studios.\n"
        "RULES:\n"
        "1. Execute the concept LITERALLY — no extra lore, no invented settings.\n"
        "2. If LYRICS section present: one lyric line per scene VERBATIM as dialogue. No paraphrasing.\n"
        "   If NO LYRICS: write original in-character dialogue. NEVER use real song lyrics.\n"
        f"3. {scene_count_rule}\n"
        "4. Keep tone/genre exactly as described.\n"
        "5. Return ONLY valid JSON — no markdown, no commentary, no explanation.\n"
        "6. Keep scene objects compact — description is ONE sentence, dialogue is ONE line.\n"
        + adult_rules
    )
    user = (
        f"Concept: {concept}\n"
        f"Genre: {genre}\n"
        f"Main character: {character_name or 'unnamed'}\n\n"
        f"Return a JSON object with:\n"
        f"  title         – story title from concept\n"
        f"  logline       – one sentence\n"
        f"  act_structure – one sentence 3-act summary\n"
        f"  scenes        – array of scene objects, each with:\n"
        f"    index            (int, 0-based)\n"
        f"    act              (1, 2, or 3)\n"
        f"    description      (1 sentence — physical action, {'explicit' if is_adult else 'literal'})\n"
        f"    dialogue         ({'VERBATIM lyric line' if lyric_lines else 'one spoken line, max 12 words'})\n"
        f"    reel_weight      (int 1–10)\n"
        f"    emotion          (one word)\n"
        f"    duration_seconds (int 5–10)\n"
        f"\nNO image_prompt field. Keep it compact. Output complete valid JSON.\n"
    )

    def _call():
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.85,
                max_tokens=16000,
            )
            raw = resp.choices[0].message.content.strip()
            # Strip markdown fences
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            raw = raw.strip()
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"GPT returned invalid JSON: {e} — raw start: {raw[:200]}")
        except Exception as e:
            raise RuntimeError(f"GPT develop failed: {type(e).__name__}: {e}")

    try:
        return await loop.run_in_executor(None, _call)
    except Exception as e:
        raise HTTPException(500, detail=str(e))


def _top_scene_indices(scenes: list, reel_sec: int, scene_sec: int) -> list[int]:
    capacity = max(1, reel_sec // scene_sec)
    ranked   = sorted(scenes, key=lambda s: s.get("reel_weight", 0), reverse=True)
    return sorted(s.get("index", 0) for s in ranked[:capacity])
