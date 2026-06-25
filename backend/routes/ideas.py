from fastapi import APIRouter, BackgroundTasks, Header, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
from math import ceil
import json, uuid, asyncio, os

from backend.db import ideas_col, characters_col
from backend.config import VENICE_CREATIVE_MODEL

router = APIRouter()
DATA_FILE = Path("data/ideas.json")
_DEV_JOBS: dict = {}   # in-memory fast path; MongoDB is the durable fallback


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
    character2_name: str = ""
    character2_id: str = ""
    location_name: str = ""
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
async def delete_idea(idea_id: str, x_studio: str = Header(default="levram")):
    if ideas_col is not None:
        await ideas_col.delete_one({"id": idea_id})
        docs = await ideas_col.find({"studio": x_studio}).sort("createdAt", -1).to_list(None)
        return {"success": True, "ideas": [_strip(d) for d in docs]}
    data = _load()
    data["ideas"] = [i for i in data["ideas"] if i["id"] != idea_id]
    _save(data)
    scoped = [i for i in data["ideas"] if i.get("studio", "levram") == x_studio]
    return {"success": True, "ideas": scoped}


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


async def _fetch_char_appearance(char_id: str) -> str:
    """Return a one-paragraph physical description for image prompt injection."""
    if not char_id:
        return ""
    try:
        if characters_col is not None:
            doc = await characters_col.find_one({"id": char_id})
        else:
            from pathlib import Path as _P; import json as _j
            chars = _j.loads(_P("data/characters.json").read_text()).get("characters", [])
            doc = next((c for c in chars if c.get("id") == char_id), None)
        if not doc:
            return ""
        parts = [p for p in [doc.get("appearance", ""), doc.get("wardrobe", "")] if p]
        return " ".join(parts)
    except Exception:
        return ""


async def _run_develop(idea_id: str, body: DevelopRequest, idea: dict):
    async def _upd(**kw):
        _DEV_JOBS[idea_id] = kw          # always write in-memory — never throws
        try:
            await _patch_idea_any(idea_id, {"_dev_job": kw})   # best-effort MongoDB
        except Exception as _e:
            print(f"[DEV_JOB] MongoDB status write failed (non-fatal): {_e}")

    try:
        await _upd(status="running", step="Analyzing concept…")
        target_sec = int(body.target_minutes * 60)
        num_scenes = max(10, round(target_sec / 7))

        await _upd(status="running", step="Looking up character appearances…")
        char1_appearance = await _fetch_char_appearance(body.character_id)
        char2_appearance = await _fetch_char_appearance(body.character2_id)

        await _upd(status="running", step="Fetching location context…")
        from backend.routes.ai import get_location_context
        location_context = await get_location_context(body.location_name)

        await _upd(status="running", step=f"Writing story — {num_scenes} scenes, {body.target_minutes} min…")
        story = await _gpt_develop(
            concept           = idea["rawIdea"],
            genre             = idea.get("genre", "sci-fi action"),
            character_name    = body.character_name,
            char2_name        = body.character2_name,
            char1_appearance  = char1_appearance,
            char2_appearance  = char2_appearance,
            num_scenes        = num_scenes,
            scene_seconds     = body.scene_seconds,
            target_minutes    = body.target_minutes,
            location_name     = body.location_name,
            location_context  = location_context,
        )

        await _upd(status="running", step="Calculating reel cuts…")
        scenes = story.get("scenes", [])
        actual_total_sec = sum(int(s.get("duration_seconds", 7)) for s in scenes)
        n = len(scenes)
        story["num_scenes"]    = n
        story["actual_scenes"] = n
        story["target_minutes"]= body.target_minutes
        story["est_seconds"]   = actual_total_sec
        story["est_minutes"]   = round(actual_total_sec / 60, 1)
        story["reel_60s"]      = _top_scene_indices(scenes, 60, 5)
        story["reel_30s"]      = _top_scene_indices(scenes, 30, 5)
        story["reel_15s"]      = _top_scene_indices(scenes, 15, 5)

        await _upd(status="running", step="Saving to database…")
        patch = {"story": story, "status": "developed",
                 "target_minutes": body.target_minutes,
                 "scene_seconds": body.scene_seconds}
        if body.character_id:
            patch["character_id"]   = body.character_id
            patch["character_name"] = body.character_name
        if body.character2_id:
            patch["character2_id"]   = body.character2_id
            patch["character2_name"] = body.character2_name
        await _patch_idea_any(idea_id, patch)

        await _upd(status="complete", step=f"Done — {n} scenes built", scene_count=n,
                   story_title=story.get("title", ""))
    except Exception as e:
        print(f"[DEV_JOB] _run_develop failed: {e}")
        try:
            await _upd(status="failed", error=str(e)[:400], step=f"Error: {str(e)[:80]}")
        except Exception:
            _DEV_JOBS[idea_id] = {"status": "failed", "error": str(e)[:400], "step": f"Error: {str(e)[:80]}"}


@router.post("/ideas/{idea_id}/develop")
async def develop_idea(idea_id: str, body: DevelopRequest, background_tasks: BackgroundTasks):
    idea = await _get_idea_any(idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")

    _DEV_JOBS[idea_id] = {"status": "starting", "step": "Reading idea…"}
    try:
        await _patch_idea_any(idea_id, {"_dev_job": {"status": "starting", "step": "Reading idea…"}})
    except Exception:
        pass
    background_tasks.add_task(_run_develop, idea_id, body, idea)
    return {"success": True, "job_id": idea_id}


@router.get("/ideas/develop-status/{job_id}")
async def develop_status(job_id: str):
    # In-memory first (same worker, instant), then idea document (cross-worker)
    if job_id in _DEV_JOBS:
        return _DEV_JOBS[job_id]
    try:
        idea = await _get_idea_any(job_id)
        if idea and idea.get("_dev_job"):
            return idea["_dev_job"]
    except Exception:
        pass
    return {"status": "starting", "step": "Starting…"}


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


class ReviseRequest(BaseModel):
    revision_notes: str
    character_name: str = ""
    character2_name: str = ""
    location_name: str = ""


@router.post("/ideas/{idea_id}/revise")
async def revise_idea(idea_id: str, body: ReviseRequest):
    """Apply director's notes to an existing developed story — preserves title, logline, act structure."""
    idea = await _get_idea_any(idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")
    story = idea.get("story")
    if not story:
        raise HTTPException(400, "Story not yet developed — run /develop first")

    from openai import OpenAI
    venice_key = os.getenv("VENICE_API_KEY")
    if venice_key:
        client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
        model = VENICE_CREATIVE_MODEL
    else:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model  = "gpt-4o-mini"

    # Pull structural directives from the original idea so Lena knows the intent
    idea_concept = idea.get("source", "") or idea.get("rawIdea", "")
    lena_director_rule = ""
    if idea_concept:
        idea_structure = _extract_user_structure(idea_concept)
        idea_arc       = _extract_escalation_arc(idea_concept)
        idea_lyrics    = _extract_lyric_lines(idea_concept)
        lena_parts     = []
        if idea_structure:
            lena_parts.append(f"ORIGINAL DIRECTOR'S STRUCTURE:\n{idea_structure}")
        if idea_arc:
            lena_parts.append(f"ESCALATION ARC:\n{idea_arc}")
        if idea_lyrics:
            lena_parts.append(f"VOICE/LYRIC SEQUENCE ({len(idea_lyrics)} lines):\n" +
                              "\n".join(f"  {i+1}. {l}" for i, l in enumerate(idea_lyrics)))
        if lena_parts:
            lena_director_rule = (
                "\n\nDIRECTOR'S ORIGINAL INTENT — preserve across all revisions:\n"
                + "\n\n".join(lena_parts)
                + "\n\nDo NOT alter the escalation arc, lyric sequence, or scene start point "
                  "unless the director's notes explicitly ask for it."
            )

    system = f"""You are the LEVRAM Studios Story Reviser — Lena.

Your job: apply a director's notes as TARGETED edits to an existing story breakdown.

STRICT RULES:
- PRESERVE the title, logline, and act_structure EXACTLY — do not rename, retitle, or reimagine the story
- PRESERVE the total scene count unless the notes explicitly ask to add or remove scenes
- ONLY change what the notes specify — everything else stays identical
- If notes say "make Act 2 more intense", only edit Act 2 scenes
- If notes say "rewrite scene 5", only touch scene 5
- If the story has verbatim lyric dialogue, preserve those lyrics exactly — only change description/shot_prompt
- Never write cliché villain/hero dialogue (no "bow before me", "feel my power", "I will reign forever")
- Return the FULL story JSON — same schema as input — with only the requested changes applied
{lena_director_rule}

Return ONLY valid JSON. No markdown. No commentary.
Schema: {{ title, logline, act_structure, num_scenes, scenes: [...], est_seconds, est_minutes, reel_60s, reel_30s, reel_15s }}
Scene fields: index, act, description, dialogue, shot_prompt, image_prompt, emotion, duration_seconds, reel_weight"""

    cast_note = ""
    if body.character_name:
        cast_note += f"\nPrimary character: {body.character_name}"
    if body.character2_name:
        cast_note += f"\nSecondary character: {body.character2_name}"
    if body.location_name:
        cast_note += f"\nLocation: {body.location_name}"

    story_json = json.dumps({
        "title":        story.get("title", ""),
        "logline":      story.get("logline", ""),
        "act_structure":story.get("act_structure", ""),
        "num_scenes":   story.get("num_scenes", 0),
        "scenes":       story.get("scenes", []),
        "est_seconds":  story.get("est_seconds", 0),
        "est_minutes":  story.get("est_minutes", 0),
        "reel_60s":     story.get("reel_60s", []),
        "reel_30s":     story.get("reel_30s", []),
        "reel_15s":     story.get("reel_15s", []),
    }, ensure_ascii=False)

    user_msg = f"""Existing story:
{story_json}
{cast_note}

Director's Notes:
{body.revision_notes}

Apply these notes as targeted edits. Return the full revised story JSON."""

    loop = asyncio.get_event_loop()
    try:
        resp = await loop.run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user_msg},
                ],
                temperature=0.7,
            ),
        )
        text = resp.choices[0].message.content.strip()
        # Strip markdown fences if model adds them
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        revised = json.loads(text)
    except Exception as e:
        raise HTTPException(500, f"Hermes revision failed: {e}")

    # Ensure title is preserved even if model disobeys
    revised["title"]        = story.get("title", revised.get("title", ""))
    revised["logline"]      = revised.get("logline") or story.get("logline", "")
    revised["act_structure"]= revised.get("act_structure") or story.get("act_structure", "")
    revised["target_minutes"] = story.get("target_minutes", 0)
    revised["num_scenes"]   = len(revised.get("scenes", story.get("scenes", [])))

    await _patch_idea_any(idea_id, {"story": revised, "status": "developed"})
    return {"success": True, "story": revised}


def _count_lyric_lines(concept: str) -> int:
    """Count lyric lines in concept (after LYRICS: marker or VOICE PROMPTS marker)."""
    return len(_extract_lyric_lines(concept))


def _extract_lyric_lines(concept: str) -> list:
    """Return the actual lyric lines in order from the concept text."""
    lines = concept.splitlines()
    in_lyrics = False
    result = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        upper = stripped.upper()
        if ("LYRICS" in upper or "VOICE PROMPT" in upper) and upper.endswith(":"):
            in_lyrics = True
            continue
        if in_lyrics and stripped:
            result.append(stripped)
    return result


def _extract_escalation_arc(concept: str) -> str:
    """Pull the ESCALATION ARC block (or any ARC/STRUCTURE/NOTES block) from the concept."""
    arc_markers = {"ESCALATION ARC", "ARC", "SCENE STRUCTURE", "STORY NOTES",
                   "DIRECTOR NOTES", "STRUCTURE", "SCENE ARC", "PROGRESSION"}
    lines = concept.splitlines()
    in_arc = False
    arc_lines = []
    for line in lines:
        stripped = line.strip()
        upper = stripped.upper().rstrip(":")
        if any(m in upper for m in arc_markers):
            in_arc = True
            continue
        if in_arc:
            if stripped and stripped.endswith(":") and stripped.isupper():
                break
            if any(k in stripped.upper() for k in ("LYRICS", "VOICE PROMPT", "DIALOGUE PROMPT")):
                break
            if stripped:
                arc_lines.append(stripped)
    return "\n".join(arc_lines).strip()


def _extract_user_structure(concept: str) -> str:
    """
    Pull ALL structural instructions the user embedded in the concept:
    escalation arc, start instructions, no-intro flags, scene notes, etc.
    Returns a block to inject into Hermes so it follows the director's intent.
    """
    section_markers = {
        "ESCALATION ARC", "ARC", "SCENE STRUCTURE", "STORY NOTES",
        "DIRECTOR NOTES", "STRUCTURE", "SCENE ARC", "PROGRESSION",
        "START AT", "NO INTRO", "SCENE SETUP", "SETUP",
    }
    # Also grab any sentence containing strong directive language
    directive_phrases = [
        "no intro", "start immediately", "start at lyric", "start at scene",
        "do not add", "skip the intro", "don't add intro", "action already",
        "entire song", "entire chorus", "backs up", "escalation happens",
        "progressively", "by the last lyric", "by the end",
    ]
    lines = concept.splitlines()
    in_section = False
    collected = []
    for line in lines:
        stripped = line.strip()
        upper = stripped.upper().rstrip(":")
        # Detect section headers
        if any(m in upper for m in section_markers) and (stripped.endswith(":") or stripped.isupper()):
            in_section = True
            collected.append(f"[{stripped}]")
            continue
        if in_section:
            # Stop at next section header or lyrics block
            if stripped.endswith(":") and stripped.isupper():
                in_section = False
            elif any(k in stripped.upper() for k in ("LYRICS:", "VOICE PROMPT", "DIALOGUE PROMPT")):
                in_section = False
            else:
                if stripped:
                    collected.append(stripped)
            continue
        # Grab individual directive sentences anywhere in concept
        lower = stripped.lower()
        if any(p in lower for p in directive_phrases):
            collected.append(stripped)
    return "\n".join(collected).strip()


# ── Story developer ─────────────────────────────────────────────

def _parse_json_response(raw: str) -> any:
    raw = raw.strip()
    # Strip markdown fences
    if "```" in raw:
        for block in raw.split("```")[1:]:
            block = block.lstrip("json").strip()
            if block.startswith("{") or block.startswith("["):
                raw = block
                break
    return json.loads(raw.strip())


def _extract_json_array(raw: str) -> list:
    """Robustly extract a JSON array from model output even with leading/trailing text."""
    raw = raw.strip()
    # Strip markdown fences first
    if "```" in raw:
        for block in raw.split("```")[1:]:
            block = block.lstrip("json").strip()
            if block.startswith("["):
                raw = block
                break
    # Find the first [ and walk to its matching ]
    start = raw.find("[")
    if start == -1:
        raise ValueError(f"No JSON array found in model output: {raw[:200]}")
    depth = 0
    for i, ch in enumerate(raw[start:], start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return json.loads(raw[start : i + 1])
    # Fallback: try to parse whatever we have (may raise)
    raise ValueError(f"Unclosed JSON array in model output: {raw[:200]}")


async def _gpt_develop(
    concept: str, genre: str, character_name: str,
    num_scenes: int, scene_seconds: int, target_minutes: float,
    char2_name: str = "", char1_appearance: str = "", char2_appearance: str = "",
    location_name: str = "", location_context: str = "",
) -> dict:
    from openai import OpenAI
    loop = asyncio.get_event_loop()

    _ADULT_KEYWORDS = {"adult", "erotic", "explicit", "xxx", "nsfw"}
    _LESBIAN_KEYWORDS = {"lesbian", "sapphic", "female", "women", "girls", "femme", "wlw"}
    _COMEDY_KEYWORDS = {"comedy", "comedic", "skit", "sitcom", "parody", "spoof", "funny", "humor", "humour", "lighthearted", "light-hearted", "rom-com", "romcom", "farce", "satire"}
    genre_words = set(genre.lower().replace(",", " ").replace("-", " ").split())
    is_adult   = bool(_ADULT_KEYWORDS.intersection(genre_words)) or bool(_LESBIAN_KEYWORDS.intersection(genre_words))
    is_lesbian = bool(_LESBIAN_KEYWORDS.intersection(genre_words))
    is_comedy  = bool(_COMEDY_KEYWORDS.intersection(genre_words))

    venice_key = os.getenv("VENICE_API_KEY")
    if is_adult and venice_key:
        # RL content — Hermes 405B, fully uncensored
        client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
        model = VENICE_CREATIVE_MODEL
    elif venice_key:
        # Main studio — Hermes 405B, largest uncensored creative writing model on Venice
        client = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
        model = VENICE_CREATIVE_MODEL
    else:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model  = "gpt-4o-mini"

    lyric_lines    = _count_lyric_lines(concept)
    all_lyrics     = _extract_lyric_lines(concept) if lyric_lines else []
    arc_text       = _extract_escalation_arc(concept)
    user_structure = _extract_user_structure(concept)

    # Detect if the concept is a screenplay excerpt (has sluglines / dialogue formatting)
    _concept_upper = concept.upper()
    _is_screenplay = (
        any(marker in _concept_upper for marker in ["INT.", "EXT.", "INT/EXT", "I/E."])
        or _concept_upper.count("\n\n") > 4
    )

    # Universal director rule — injected into every system prompt
    _director_rule = ""
    if _is_screenplay and not lyric_lines:
        _director_rule = (
            "\n\nDIRECTOR'S INSTRUCTIONS — MANDATORY:\n"
            "The concept is a SCREENPLAY EXCERPT — this is the INCITING INCIDENT only, not the complete story.\n"
            "SCENE 1 must adapt this exact excerpt faithfully (same location, same action beats).\n"
            "Acts 2 and 3 explore what happens AFTER this scene: immediate psychological aftermath, "
            "trauma response, personality shift, B-roll memory fragments, escalating consequences.\n"
            "DO NOT resolve the story with a villain death or hero victory — this is Act 1 of a longer arc.\n"
            "DO NOT compress the excerpt into 1 scene — adapt its beats across 3-6 scenes for Act 1.\n"
            "Keep the villain alive and in control at the end of this film."
        )
    elif user_structure or arc_text or lyric_lines:
        _director_rule = (
            "\n\nDIRECTOR'S INSTRUCTIONS — MANDATORY:\n"
            "The concept below contains explicit structural instructions from the director. "
            "Follow them EXACTLY. Do NOT:\n"
            "- Add intro or setup scenes not requested\n"
            "- Substitute your own story structure\n"
            "- Reinterpret the concept into a generic format\n"
            "- Ignore start-point, escalation arc, or scene-by-scene choreography the director provided\n"
            "If the director says 'start at lyric 1' or 'no intro', scene 1 IS lyric 1 or action beat 1.\n"
            "If an escalation arc is provided, each scene's physical action must match that arc beat-for-beat."
        )
        if user_structure:
            _director_rule += f"\n\nDIRECTOR'S STRUCTURE:\n{user_structure}"

    # Build performer reference block — goes into every scene prompt
    p1 = character_name or ""
    p2 = char2_name or ""
    performer_block = ""
    if p1:
        performer_block += f"PERFORMER 1 — {p1}: {char1_appearance}\n" if char1_appearance else f"PERFORMER 1 — {p1}\n"
    if p2:
        performer_block += f"PERFORMER 2 — {p2}: {char2_appearance}\n" if char2_appearance else f"PERFORMER 2 — {p2}\n"

    # Prefix for every description so names stay consistent
    cast_prefix = ""
    if p1 and p2:
        cast_prefix = f"Scene features {p1} and {p2}. "
    elif p1:
        cast_prefix = f"Scene features {p1}. "

    _gender_rule = (
        "\nBOTH PERFORMERS ARE BIOLOGICAL WOMEN — female anatomy ONLY: vagina, vulva, clitoris, labia, breasts, nipples. "
        "NEVER write cock/penis/dick for either character — they do not have penises. "
        "If penetration occurs, use a strap-on or fingers — NEVER a penis. "
        "No men appear anywhere in this film."
    ) if is_lesbian else ""

    adult_sys = (
        "PROFESSIONAL ADULT FILM — West Coast Productions / Evil Angel style. "
        "BANNED WORDS IN EVERY SCENE: 'unspoken desires', 'charged air', 'electricity', 'tension', 'flirtatious', 'tease', 'banter', 'longing'. "
        "Write ONLY what is physically happening right now: exact body positions, clothing state, who is touching what. "
        "Use character names in EVERY description — never 'they' alone. "
        "Act 1 = they meet and immediately begin removing clothing and touching each other's bodies. "
        "Act 2 = explicit oral sex — who is going down on whom, mouth position, body response. "
        "Act 3 = full explicit acts — exact positions, penetration (fingers/strap-on), orgasm. "
        "Dialogue: raw, sexual, direct. Max 10 words. No poetry, no metaphor."
        + _gender_rule
    ) if is_adult else ""

    comedy_sys = (
        "You are a comedy scene writer for LEVRAM Studios. Original IP. "
        "Write compact JSON only — no markdown, no commentary. "
        "Description: 1 vivid specific sentence — exactly what the camera sees. Focus on comedic body language, facial expressions, timing, and physical humor. "
        "Tone: light, warm, expressive — think sitcom or sketch comedy. NO violence, gore, or dark imagery. "
        "Dialogue is ENCOURAGED in comedy — snappy, character-specific, max 10 words. Natural and funny, not theatrical. NO profanity — dialogue must be clean (YouTube-safe). "
        "BANNED DIALOGUE: villain clichés, dramatic proclamations, anything dark or threatening. "
        "Write what a real person actually says in that exact comedic moment."
        + _director_rule
    ) if is_comedy and not is_adult else ""

    cinematic_sys = (
        "You are a cinematic scene writer for LEVRAM Studios. Original IP. Prestige quality. "
        "Write compact JSON only — no markdown, no commentary. "
        "Description: 1 vivid specific sentence — exactly what the camera sees. "
        "Gore, blood, violence, injury, and death are ALLOWED and should be written with physical specificity when the scene calls for it. "
        "Describe wounds, impacts, blood, and brutality directly — do not soften or cut away. "
        "Dialogue is OPTIONAL — empty string '' for action, physical confrontation, choking, dying, silent moments. "
        "When a character IS speaking: specific to their voice, this exact moment, max 10 words. NO profanity — dialogue must be clean (YouTube-safe). "
        "BANNED DIALOGUE — never write these or anything like them: "
        "'bow before me', 'feel my power', 'this is the beginning/end', 'the world is mine', "
        "'I will reign forever', 'you cannot stop me', 'witness my power', 'all shall know my name', "
        "'this is only the beginning', 'your time is up', 'tremble before me', 'I am inevitable', "
        "'dawn of a new era', 'this storm hides', 'the world will know'. "
        "Write what a real person says in that exact moment — specific, earned, human."
        + _director_rule
    ) if not is_adult and not is_comedy else ""

    base_system = (
        comedy_sys if is_comedy and not is_adult else
        cinematic_sys if not is_adult else
        "You are a scene breakdown writer for LEVRAM Studios. "
        "Write compact JSON only — no markdown, no commentary. "
        + _director_rule
    ) + adult_sys

    # ── Step 1: Header (title, logline, act_structure) ──────────
    def _call_header():
        performers = character_name or "unnamed"
        if char2_name:
            performers += f" and {char2_name}"
        loc_line = f"\nLocation: {location_name}" if location_name else ""
        u = (
            f"Concept: {concept}\nGenre: {genre}\nPerformers: {performers}{loc_line}\n\n"
            f"Return JSON with ONLY these fields:\n"
            f"  title (from concept), logline (1 sentence), act_structure (1 sentence 3-act summary)"
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": base_system}, {"role": "user", "content": u}],
            temperature=0.7, max_tokens=300,
        )
        return _parse_json_response(resp.choices[0].message.content)

    # Build image prompt prefix from performer appearances (used in shot_prompt)
    def _build_shot_prompt_prefix():
        parts = []
        if char1_appearance:
            name = character_name or "Performer 1"
            parts.append(f"{name}: {char1_appearance}")
        if char2_appearance:
            name = char2_name or "Performer 2"
            parts.append(f"{name}: {char2_appearance}")
        return ". ".join(parts)

    shot_prompt_prefix = _build_shot_prompt_prefix()

    # ── Step 2: Scenes per act (3 separate small calls) ──────────
    def _call_act(act_num: int, beat_count: int, start_index: int, act_desc: str, act_lyrics: list = None):
        if lyric_lines and act_lyrics:
            numbered = "\n".join(f"  {i+1}. {l}" for i, l in enumerate(act_lyrics))
            dialogue_rule = (
                f"dialogue — MUST be the EXACT lyric line assigned to this scene (in order). "
                f"Lyrics for this act in order:\n{numbered}\n"
                f"Scene {start_index+1} uses lyric 1, scene {start_index+2} uses lyric 2, etc. Copy verbatim."
            )
        elif lyric_lines:
            dialogue_rule = "VERBATIM lyric line for this scene (in order from the concept)"
        elif is_adult:
            dialogue_rule = "one explicit in-character raw line, max 10 words"
        else:
            dialogue_rule = (
                "dialogue — OPTIONAL spoken line (empty string '' if scene has no natural speech). "
                "Action scenes, physical confrontations, silent moments = empty string. "
                "When included: character-specific, max 10 words, NO stock villain/hero phrases"
            )

        performer_ctx = ""
        if performer_block:
            performer_ctx = f"\nPerformers:\n{performer_block}"

        desc_rule = (
            f"description (USE CHARACTER NAMES — '{p1}' and '{p2 or 'partner'}'. "
            f"1 direct sentence stating exactly what {p1}{' and ' + p2 if p2 else ''} are physically doing — "
            f"explicit adult film action, no euphemisms, no romance language)"
        ) if is_adult else (
            f"description (1 sentence — what is physically happening, use character names)"
        )

        _img_gender = "two women, female bodies only, no men — " if is_lesbian else ""
        shot_prompt_instruction = (
            f"shot_prompt (image gen VISUAL prompt — {_img_gender}"
            f"describe exactly what camera sees: {p1} and {p2 or 'partner'} physical appearance and clothing state, "
            f"their body positions, setting, lighting. "
            f"Use photographic terms: 'medium shot', 'close-up', 'boudoir lighting', 'unclothed'. "
            f"DO NOT write anatomical slang — describe visually. 1 dense paragraph. No labels.)"
        ) if is_adult else (
            f"shot_prompt (image gen prompt — subject by name, comedic expression and body language, setting with warm bright natural lighting, camera angle; NO darkness, NO dramatic rim lighting, NO monsters or creatures — this is a COMEDY; 1 dense paragraph)"
        ) if is_comedy else (
            f"shot_prompt (image gen prompt — subject by name, action, setting, dramatic cinematic lighting, camera angle; 1 dense paragraph)"
        )

        _per_act_gender = (
            f"\nGENDER RULE: Both {p1} and {p2} are WOMEN with female bodies only. "
            f"NO penises. NO male anatomy. Penetration = fingers or strap-on only."
        ) if is_lesbian and p1 and p2 else ""

        # Lyric mode: 1 scene per lyric line — NO multi-angle coverage
        # Standard mode with 2 chars: 3 shots per dramatic beat (CU1, CU2, wide)
        if lyric_lines:
            # Each lyric = exactly 1 scene. No multi-shot coverage.
            arc_instruction = ""
            if arc_text:
                arc_instruction = f"\nESCALATION ARC — follow this exactly, do not invent new structure:\n{arc_text}\n"
            coverage_instruction = (
                f"\nLYRIC MODE — output EXACTLY {beat_count} scene objects, one per lyric line.\n"
                f"Do NOT add intro scenes. Scene 1 starts at the first lyric, in the middle of the action.\n"
                f"Each scene's physical action must match the escalation arc described in the concept.\n"
                + arc_instruction
            )
            angle_field = ""
            total_label = str(beat_count)
        elif not is_adult and p1 and p2:
            expected_total = beat_count * 3
            coverage_instruction = (
                f"\nCAMERA COVERAGE — for every dramatic beat output EXACTLY 3 consecutive scene objects:\n"
                f"  SHOT A: angle_type 'cu_char1'  — close-up on {p1}: their face, expression, action\n"
                f"  SHOT B: angle_type 'cu_char2'  — close-up on {p2}: their reaction or counter-action\n"
                f"  SHOT C: angle_type 'wide'       — pull back: both characters visible, environment around them\n"
                f"  character field = who this shot focuses on: '{p1}', '{p2}', or 'both' for wide shots\n"
                f"EXCEPTION — establishing/transition beats: 1 shot only, angle_type 'establishing', character 'both'\n"
                f"EXCEPTION — peak action/climax beats: add 4th shot, angle_type 'impact', character = whoever lands the blow\n"
                f"Total output ≈ {expected_total} objects ({beat_count} beats × 3). Flat array, beat shots consecutive.\n"
            )
            angle_field = "angle_type (string: cu_char1|cu_char2|wide|establishing|impact), character (string: who this shot focuses on),"
            total_label = f"~{expected_total}"
        else:
            coverage_instruction = ""
            angle_field = ""
            total_label = str(beat_count)

        _loc_block = (f"\nLOCATION LOCK — every shot_prompt in this act MUST include these environment descriptors verbatim:\n{location_context}\n") if location_context else ""

        u = (
            f"Concept: {concept}\nGenre: {genre}"
            f"\nPerformer 1 — {p1 or 'unnamed'}: {char1_appearance}"
            + (f"\nPerformer 2 — {p2}: {char2_appearance}" if p2 else "")
            + _per_act_gender
            + _loc_block
            + coverage_instruction
            + f"\nAct {act_num} focus: {act_desc}\n\n"
            f"Return a JSON array of {total_label} scene objects.\n"
            f"Index starts at {start_index}. Each object:\n"
            f"  index (int), act ({act_num}), {angle_field} "
            f"{desc_rule}, "
            f"dialogue ({dialogue_rule}), "
            f"{shot_prompt_instruction}, "
            f"reel_weight (1-10), emotion (1 word), duration_seconds (3-5)\n"
            f"NO other fields. Return the array only (not wrapped in an object)."
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": base_system}, {"role": "user", "content": u}],
            temperature=0.85, max_tokens=6000,
        )
        return _extract_json_array(resp.choices[0].message.content)

    def _build_story():
        try:
            header = _call_header()
        except Exception as e:
            raise RuntimeError(f"Story header failed: {e}")

        if lyric_lines:
            a1 = max(1, lyric_lines // 3)
            a2 = max(1, lyric_lines // 3)
            a3 = lyric_lines - a1 - a2
            # Split actual lyrics across acts so each act gets its assigned lines
            lyrics_a1 = all_lyrics[:a1]
            lyrics_a2 = all_lyrics[a1:a1 + a2]
            lyrics_a3 = all_lyrics[a1 + a2:]
            # Act descriptions derived from escalation arc in concept (not generic templates)
            if arc_text:
                # Split arc text into 3 roughly equal parts for each act
                arc_parts = [s.strip() for s in arc_text.replace("Lines", "\nLines").split("\n") if s.strip()]
                act_descs = [
                    arc_parts[0] if len(arc_parts) > 0 else f"Opening — action already in progress. Genre: {genre}.",
                    arc_parts[1] if len(arc_parts) > 1 else f"Escalation. Genre: {genre}.",
                    arc_parts[2] if len(arc_parts) > 2 else f"Climax and resolution. Genre: {genre}.",
                ]
            else:
                act_descs = [
                    f"Act 1 — opening confrontation, action already in progress. Genre: {genre}.",
                    f"Act 2 — escalation, tension rising. Genre: {genre}.",
                    f"Act 3 — climax, decisive moment. Genre: {genre}.",
                ]
            lyric_sets = [lyrics_a1, lyrics_a2, lyrics_a3]
        elif not is_adult:
            # LS: beats per act (each beat → 3 shots). Cap at 8 beats/act → 24 shots/act → 72 total
            beats_per_act = max(6, min(8, num_scenes // 9))
            a1 = beats_per_act
            a2 = beats_per_act
            a3 = beats_per_act - 1  # act 3 slightly shorter — avoids ending bloat
            act_descs = [
                f"Setup — establish the world, the characters, the stakes. Specific to: {genre}. Show don't tell.",
                f"Confrontation and rising tension. Physical action, conflict escalation. Genre: {genre}. Visceral and specific.",
                f"Climax and aftermath. The decisive moment and its consequences. Genre: {genre}. Earned, not generic.",
            ]
            lyric_sets = [None, None, None]
        else:
            a1 = num_scenes // 3
            a2 = num_scenes // 3
            a3 = num_scenes - a1 - a2
            act_descs = [
                "Introduction — they meet and immediately begin removing each other's clothing and touching each other's bodies. No flirting banter — direct physical contact from scene 1.",
                "Escalation — explicit oral sex begins. Describe exactly who is performing oral on whom, mouth and tongue on genitals, moaning, body arching.",
                "Climax — penetrative acts (fingers, strap-on), multiple positions, building to orgasm. Explicit and direct throughout.",
            ]
            lyric_sets = [None, None, None]

        all_scenes = []
        idx = 0
        for act_num, count, desc, act_lyr in [(1, a1, act_descs[0], lyric_sets[0]),
                                               (2, a2, act_descs[1], lyric_sets[1]),
                                               (3, a3, act_descs[2], lyric_sets[2])]:
            try:
                scenes = _call_act(act_num, count, idx, desc, act_lyrics=act_lyr)
                if not isinstance(scenes, list):
                    # Hermes wrapped the array — try common keys before giving up
                    for _key in ("scenes", "results", "story", "data", "shots"):
                        if isinstance(scenes.get(_key), list):
                            scenes = scenes[_key]
                            break
                    else:
                        raise ValueError(
                            f"Act {act_num}: Hermes returned a dict with no recognizable array key. "
                            f"Keys: {list(scenes.keys()) if isinstance(scenes, dict) else type(scenes)}"
                        )
                if not scenes:
                    raise ValueError(f"Act {act_num}: Hermes returned 0 scenes — likely a JSON parse failure or empty response")
                all_scenes.extend(scenes)
                idx += len(scenes)
            except Exception as e:
                raise RuntimeError(f"Act {act_num} scene generation failed: {e}")

        # Autonomous QC: editor trims redundancy, clean_dialogue strips clichés
        all_scenes = _editor_pass(all_scenes, is_adult, is_lesbian, p1, p2, client, model)

        return {**header, "scenes": all_scenes}

    try:
        return await loop.run_in_executor(None, _build_story)
    except Exception as e:
        raise HTTPException(500, detail=str(e))


def _top_scene_indices(scenes: list, reel_sec: int, scene_sec: int) -> list[int]:
    capacity = max(1, reel_sec // scene_sec)
    ranked   = sorted(scenes, key=lambda s: s.get("reel_weight", 0), reverse=True)
    return sorted(s.get("index", 0) for s in ranked[:capacity])


# ── Autonomous QC passes ─────────────────────────────────────────

_BANNED_DIALOGUE = [
    "bow before", "feel my power", "this is the beginning", "this is the end",
    "the world is mine", "i will reign", "you cannot stop me", "witness my power",
    "all shall know", "this is only the beginning", "your time is up",
    "tremble before", "i am inevitable", "dawn of a new era", "the world will know",
    "this storm", "destiny", "reckoning", "bow down", "kneel before",
    "i was born for", "nothing can stop", "my true power", "unleash",
]

def _clean_dialogue(scenes: list) -> list:
    """Strip cliché dialogue without a Hermes call — runs instantly."""
    import re
    for s in scenes:
        dlg = s.get("dialogue", "")
        if not dlg:
            continue
        low = dlg.lower()
        if any(phrase in low for phrase in _BANNED_DIALOGUE):
            s["dialogue"] = ""
    return scenes


def _editor_pass(
    all_scenes: list,
    is_adult: bool,
    is_lesbian: bool,
    p1: str,
    p2: str,
    client,
    model: str,
) -> list:
    """
    Hermes reviews the full scene list and outputs only the index numbers to keep.
    Token-efficient: input summaries only, output is a number array.
    """
    max_total = 75 if not is_adult else 42

    # Skip editor if already within bounds and act 3 isn't bloated
    act3 = [s for s in all_scenes if s.get("act") == 3]
    if len(all_scenes) <= max_total and len(act3) / max(len(all_scenes), 1) <= 0.32:
        return _clean_dialogue(all_scenes)

    summaries = [
        {"i": s.get("index", idx), "act": s.get("act", 1),
         "emotion": s.get("emotion", ""), "reel_weight": s.get("reel_weight", 5),
         "desc": (s.get("description", "") or "")[:60]}
        for idx, s in enumerate(all_scenes)
    ]

    if is_adult:
        rules = (
            f"Adult film pacing rules:\n"
            f"1. Keep max {max_total} total scenes\n"
            f"2. Act 1 ≤ 30% of kept total — by scene 4 explicit contact must begin\n"
            f"3. Act 2 = ~40% — oral sex scenes\n"
            f"4. Act 3 = ~30% — penetrative acts, climax\n"
            f"5. Cut any pure setup/flirting scenes beyond the first 3\n"
            f"6. Prefer high reel_weight scenes when cutting\n"
        )
    else:
        rules = (
            f"Cinematic film pacing rules:\n"
            f"1. Keep max {max_total} total scenes\n"
            f"2. Act 3 must be ≤ 28% of total — cut redundant ending/aftermath beats\n"
            f"3. No more than 2 consecutive scenes with identical emotion — cut duplicates\n"
            f"4. Prefer high reel_weight when cutting\n"
            f"5. Never cut the first or last scene of any act\n"
            f"6. Wide/establishing shots (angle_type 'wide') should not be consecutive — cut one if so\n"
        )

    prompt = (
        f"You are a film editor for LEVRAM Studios. Review this scene list.\n"
        f"{rules}\n"
        f"Scene list (index, act, emotion, weight, description):\n"
        f"{json.dumps(summaries)}\n\n"
        f"Return ONLY a JSON array of index numbers (i values) to KEEP. Example: [0,1,2,4,5,...]\n"
        f"No commentary. No other text."
    )

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a film editor. Return only a JSON array of integers."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3, max_tokens=800,
        )
        raw = resp.choices[0].message.content.strip()
        keep_indices = set(json.loads(raw.strip().lstrip("```json").lstrip("```").rstrip("```")))
        kept = [s for s in all_scenes if s.get("index", all_scenes.index(s)) in keep_indices]
        if len(kept) < 6:
            kept = all_scenes  # editor returned too few — use original
    except Exception:
        kept = all_scenes  # editor failed — use original

    # Re-index so indices are sequential
    for i, s in enumerate(kept):
        s["index"] = i

    return _clean_dialogue(kept)
