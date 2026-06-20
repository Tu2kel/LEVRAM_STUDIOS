from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
from math import ceil
import json, uuid, asyncio, os

from backend.db import ideas_col, characters_col

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
    character2_name: str = ""
    character2_id: str = ""
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


@router.post("/ideas/{idea_id}/develop")
async def develop_idea(idea_id: str, body: DevelopRequest):
    idea = await _get_idea_any(idea_id)
    if not idea:
        raise HTTPException(404, "Idea not found")

    target_sec = int(body.target_minutes * 60)
    num_scenes = max(10, round(target_sec / 7))

    # Look up full character appearance so image prompts know what the performers look like
    char1_appearance = await _fetch_char_appearance(body.character_id)
    char2_appearance = await _fetch_char_appearance(body.character2_id)

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
    )

    scenes = story.get("scenes", [])
    actual_total_sec = sum(int(s.get("duration_seconds", 7)) for s in scenes)
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
        patch["character_id"]    = body.character_id
        patch["character_name"]  = body.character_name
    if body.character2_id:
        patch["character2_id"]   = body.character2_id
        patch["character2_name"] = body.character2_name
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
) -> dict:
    from openai import OpenAI
    loop = asyncio.get_event_loop()

    _ADULT_KEYWORDS = {"adult", "erotic", "explicit", "xxx", "nsfw"}
    _LESBIAN_KEYWORDS = {"lesbian", "sapphic", "female", "women", "girls", "femme", "wlw"}
    genre_words = set(genre.lower().replace(",", " ").split())
    is_adult  = bool(_ADULT_KEYWORDS.intersection(genre_words)) or bool(_LESBIAN_KEYWORDS.intersection(genre_words))
    is_lesbian = bool(_LESBIAN_KEYWORDS.intersection(genre_words))
    if is_adult and os.getenv("VENICE_API_KEY"):
        client = OpenAI(api_key=os.getenv("VENICE_API_KEY"), base_url="https://api.venice.ai/api/v1")
        model = "hermes-3-llama-3.1-405b"
    else:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        model = "gpt-4o-mini"

    lyric_lines = _count_lyric_lines(concept)

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

    cinematic_sys = (
        "You are a cinematic scene writer for LEVRAM Studios. Original IP. Prestige quality. "
        "Write compact JSON only — no markdown, no commentary. "
        "Description: 1 vivid specific sentence — exactly what the camera sees. No generic descriptions. "
        "Dialogue is OPTIONAL — leave empty string '' when the scene calls for silence, action, or physical intensity with no speech. "
        "A character being choked, fighting, falling, or dying does NOT speak. "
        "When dialogue IS written: make it specific to THIS character's voice and THIS exact moment. "
        "BANNED DIALOGUE — never write these or anything like them: "
        "'bow before me', 'feel my power', 'this is the beginning/end', 'the world is mine', "
        "'I will reign forever', 'you cannot stop me', 'witness my power', 'all shall know my name', "
        "'this is only the beginning', 'your time is up', 'tremble before me', 'I am inevitable'. "
        "Write lines a real person says in that specific moment — not a comic book cliché."
    ) if not is_adult else ""

    base_system = (
        cinematic_sys if not is_adult else
        "You are a scene breakdown writer for LEVRAM Studios. "
        "Write compact JSON only — no markdown, no commentary. "
    ) + adult_sys

    # ── Step 1: Header (title, logline, act_structure) ──────────
    def _call_header():
        performers = character_name or "unnamed"
        if char2_name:
            performers += f" and {char2_name}"
        u = (
            f"Concept: {concept}\nGenre: {genre}\nPerformers: {performers}\n\n"
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
    def _call_act(act_num: int, act_scene_count: int, start_index: int, act_desc: str):
        if lyric_lines:
            dialogue_rule = "VERBATIM lyric line for this scene"
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
            f"shot_prompt (image gen prompt — subject by name, action, setting, lighting, camera angle; 1 dense paragraph)"
        )

        _per_act_gender = (
            f"\nGENDER RULE: Both {p1} and {p2} are WOMEN with female bodies only. "
            f"NO penises. NO male anatomy. Penetration = fingers or strap-on only."
        ) if is_lesbian and p1 and p2 else ""

        u = (
            f"Concept: {concept}\nGenre: {genre}"
            f"\nPerformer 1 — {p1 or 'unnamed'}: {char1_appearance}"
            + (f"\nPerformer 2 — {p2}: {char2_appearance}" if p2 else "")
            + _per_act_gender
            + f"\nAct {act_num} focus: {act_desc}\n\n"
            f"Return a JSON array of EXACTLY {act_scene_count} scene objects.\n"
            f"Index starts at {start_index}. Each object:\n"
            f"  index (int), act ({act_num}), "
            f"{desc_rule}, "
            f"dialogue ({dialogue_rule}), "
            f"{shot_prompt_instruction}, "
            f"reel_weight (1-10), emotion (1 word), duration_seconds (5-10)\n"
            f"NO other fields. Return the array only (not wrapped in an object)."
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": base_system}, {"role": "user", "content": u}],
            temperature=0.85, max_tokens=4000,
        )
        return _extract_json_array(resp.choices[0].message.content)

    def _build_story():
        try:
            header = _call_header()
        except Exception as e:
            raise RuntimeError(f"Story header failed: {e}")

        if lyric_lines:
            # Lyric mode — distribute lines across 3 acts
            a1 = max(1, lyric_lines // 3)
            a2 = max(1, lyric_lines // 3)
            a3 = lyric_lines - a1 - a2
        else:
            a1 = num_scenes // 3
            a2 = num_scenes // 3
            a3 = num_scenes - a1 - a2

        act_descs = [
            "Introduction — they meet and immediately begin removing each other's clothing and touching each other's bodies. No flirting banter — direct physical contact from scene 1." if is_adult else f"Setup — establish the world, the characters, the stakes. Specific to: {genre}. Show don't tell.",
            "Escalation — explicit oral sex begins. Describe exactly who is performing oral on whom, mouth and tongue on genitals, moaning, body arching." if is_adult else f"Confrontation and rising tension. Physical action, conflict escalation. Genre: {genre}. Visceral and specific.",
            "Climax — penetrative acts (fingers, strap-on), multiple positions, building to orgasm. Explicit and direct throughout." if is_adult else f"Climax and aftermath. The decisive moment and its consequences. Genre: {genre}. Earned, not generic.",
        ]

        all_scenes = []
        idx = 0
        for act_num, count, desc in [(1, a1, act_descs[0]), (2, a2, act_descs[1]), (3, a3, act_descs[2])]:
            try:
                scenes = _call_act(act_num, count, idx, desc)
                if not isinstance(scenes, list):
                    scenes = scenes.get("scenes", [])
                all_scenes.extend(scenes)
                idx += len(scenes)
            except Exception as e:
                raise RuntimeError(f"Act {act_num} scene generation failed: {e}")

        return {**header, "scenes": all_scenes}

    try:
        return await loop.run_in_executor(None, _build_story)
    except Exception as e:
        raise HTTPException(500, detail=str(e))


def _top_scene_indices(scenes: list, reel_sec: int, scene_sec: int) -> list[int]:
    capacity = max(1, reel_sec // scene_sec)
    ranked   = sorted(scenes, key=lambda s: s.get("reel_weight", 0), reverse=True)
    return sorted(s.get("index", 0) for s in ranked[:capacity])
