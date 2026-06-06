"""
Phase 9 — Story Engine

AI-powered episode planning, beat sheets, script generation, and franchise lore.
Free: OpenAI GPT-4o-mini (uses existing OPENAI_API_KEY).
Paid stubs: Claude Opus (ANTHROPIC_API_KEY), local Ollama.
"""
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from openai import OpenAI
from pydantic import BaseModel

from backend.db import episodes_col

router       = APIRouter()
client       = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
EPISODES_DIR = Path("data/episodes")
EPISODES_DIR.mkdir(parents=True, exist_ok=True)
CHARS_FILE   = Path("data/characters.json")
LORE_FILE    = Path("LEVRAM_Master_System_Prompt.md")

LEVRAM_SYSTEM_PROMPT = LORE_FILE.read_text(encoding="utf-8") if LORE_FILE.exists() else ""


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


def _load_characters() -> list:
    if not CHARS_FILE.exists():
        return []
    try:
        data = json.loads(CHARS_FILE.read_text(encoding="utf-8"))
        return data.get("characters", []) if isinstance(data, dict) else []
    except Exception:
        return []


def _chars_context(names: list[str]) -> str:
    all_chars = _load_characters()
    matched = [c for c in all_chars if c.get("name", "").strip() in names]
    if not matched:
        return ""
    lines = []
    for c in matched:
        lines.append(
            f"- {c.get('name')}: {c.get('appearance','')} | {c.get('personality','')} | {c.get('notes','')}"
        )
    return "\n".join(lines)


def _openai_json(system: str, user: str, temperature: float = 0.85) -> dict:
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set in .env")
    res = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    return json.loads(res.choices[0].message.content)


def _json_load_episodes() -> list:
    episodes = []
    for f in sorted(EPISODES_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            episodes.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return episodes


def _json_save_episode(ep: dict) -> dict:
    ep["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    path = EPISODES_DIR / f"{ep['id']}.json"
    path.write_text(json.dumps(ep, indent=2, ensure_ascii=False), encoding="utf-8")
    return ep


# ─── AI Generation Routes ─────────────────────────────────────────────────────

class ConceptPayload(BaseModel):
    project:    str
    characters: list[str] = []
    theme:      str = ""
    tone:       str = ""
    episode_num: int = 1
    extra_notes: str = ""


@router.post("/story/concept")
def generate_concept(payload: ConceptPayload):
    char_ctx = _chars_context(payload.characters)

    system = f"""You are the Story Engine for LEVRAM STUDIOS — a cinematic dark superhero multiverse.

STUDIO IDENTITY:
{LEVRAM_SYSTEM_PROMPT[:3000]}

You generate compelling episode concepts that match LEVRAM's aesthetic: earned darkness, psychological consequence, mythological scale.

Return ONLY valid JSON with these keys:
title, logline, theme_statement, tone_notes, cold_open, act1_setup, act2_conflict, act3_resolution, closing_image, estimated_runtime_min
"""

    user = f"""Project: {payload.project}
Episode Number: {payload.episode_num}
Characters: {', '.join(payload.characters) or 'TBD'}
Core Theme/Conflict: {payload.theme or 'AI suggested'}
Tone: {payload.tone or 'AI suggested'}
Director Notes: {payload.extra_notes or 'None'}

Character Context:
{char_ctx or 'No detailed character records — use character names only.'}

Generate an episode concept worthy of LEVRAM Studios."""

    data = _openai_json(system, user)
    return {"success": True, "concept": data}


class BeatSheetPayload(BaseModel):
    project:    str
    title:      str
    logline:    str
    characters: list[str] = []
    tone:       str = ""
    extra_notes: str = ""


@router.post("/story/beat-sheet")
def generate_beat_sheet(payload: BeatSheetPayload):
    char_ctx = _chars_context(payload.characters)

    system = f"""You are the Story Engine for LEVRAM STUDIOS.

{LEVRAM_SYSTEM_PROMPT[:2000]}

Generate a detailed beat sheet with specific scene beats.
Each beat should include: beat_title, description, emotional_note, shot_type_hint, character_state, duration_seconds.

Return ONLY valid JSON:
{{
  "acts": [
    {{
      "act": "Act 1 — Setup",
      "beats": [
        {{
          "beat_number": 1,
          "beat_title": "...",
          "description": "...",
          "emotional_note": "...",
          "shot_type_hint": "...",
          "character_state": "...",
          "duration_seconds": 45
        }}
      ]
    }}
  ],
  "total_beats": 12,
  "total_estimated_minutes": 22
}}
"""

    user = f"""Project: {payload.project}
Episode Title: {payload.title}
Logline: {payload.logline}
Characters: {', '.join(payload.characters) or 'TBD'}
Tone: {payload.tone or 'Dark, earned, consequential'}
Notes: {payload.extra_notes or 'None'}

Character Context:
{char_ctx or 'No records.'}

Generate 3 acts with 4–5 beats each. Make each beat cinematic and specific."""

    data = _openai_json(system, user)
    return {"success": True, "beat_sheet": data}


class DialoguePayload(BaseModel):
    beat_description: str
    character:        str
    secondary_character: str = ""
    emotional_note:   str = ""
    project:          str = ""
    style_notes:      str = ""


@router.post("/story/dialogue")
def generate_dialogue(payload: DialoguePayload):
    char_ctx = _chars_context(
        [payload.character, payload.secondary_character] if payload.secondary_character else [payload.character]
    )

    system = f"""You are the Dialogue Engine for LEVRAM STUDIOS.

{LEVRAM_SYSTEM_PROMPT[:1500]}

Write LEVRAM-quality cinematic dialogue: weighted, atmospheric, no Marvel humor, no generic lines.
Every line should mean something.

Return ONLY valid JSON:
{{
  "lines": [
    {{
      "character": "...",
      "line": "...",
      "delivery_note": "...",
      "camera_note": "..."
    }}
  ],
  "scene_note": "...",
  "soundtrack_mood": "..."
}}
"""

    user = f"""Beat: {payload.beat_description}
Primary Character: {payload.character}
Secondary Character: {payload.secondary_character or 'None'}
Emotional Note: {payload.emotional_note or 'Unspecified'}
Project: {payload.project or 'LEVRAM Universe'}
Style Notes: {payload.style_notes or 'None'}

Character Context:
{char_ctx or 'No records.'}

Write the scene dialogue."""

    data = _openai_json(system, user)
    return {"success": True, "dialogue": data}


class MonologuePayload(BaseModel):
    character:    str
    context:      str
    internal:     bool = True
    project:      str = ""


@router.post("/story/monologue")
def generate_monologue(payload: MonologuePayload):
    char_ctx = _chars_context([payload.character])
    mono_type = "internal narration (the audience hears this, no one in the scene does)" if payload.internal else "spoken monologue"

    system = f"""You are the Narrative Voice Engine for LEVRAM STUDIOS.

{LEVRAM_SYSTEM_PROMPT[:2000]}

Write {mono_type} for the specified character.
Must match LEVRAM's voice: philosophical, earned, dark, specific — not generic superhero speech.

Return ONLY valid JSON:
{{
  "monologue": "...",
  "delivery_note": "...",
  "visual_suggestion": "...",
  "soundtrack_mood": "..."
}}
"""

    user = f"""Character: {payload.character}
Context (where are they, what just happened): {payload.context}
Type: {mono_type}
Project: {payload.project or 'LEVRAM Universe'}

Character Context:
{char_ctx or 'No records.'}"""

    data = _openai_json(system, user)
    return {"success": True, "monologue": data}


class VillainPOVPayload(BaseModel):
    character:    str
    ideology:     str
    inciting_act: str
    project:      str = ""


@router.post("/story/villain-pov")
def generate_villain_pov(payload: VillainPOVPayload):
    char_ctx = _chars_context([payload.character])

    system = f"""You are the Villain POV Engine for LEVRAM STUDIOS.

{LEVRAM_SYSTEM_PROMPT[:2000]}

Write a villain POV essay — first-person justification. The logic must be airtight until the consequences arrive.
The reader should agree with every word until the final line forces them to sit with what they've supported.

Return ONLY valid JSON:
{{
  "essay": "...",
  "theme_subtext": "...",
  "consequence_foreshadow": "..."
}}
"""

    user = f"""Character: {payload.character}
Core Ideology: {payload.ideology}
Inciting Act (what they did or are about to do): {payload.inciting_act}
Project: {payload.project or 'LEVRAM Universe'}

Character Context:
{char_ctx or 'No records.'}"""

    data = _openai_json(system, user)
    return {"success": True, "villain_pov": data}


# ─── Episode persistence ───────────────────────────────────────────────────────

class EpisodeSavePayload(BaseModel):
    id:         str = ""
    title:      str = ""
    project:    str = ""
    logline:    str = ""
    concept:    dict = {}
    beat_sheet: dict = {}
    scripts:    list = []
    notes:      str = ""


@router.get("/story/episodes")
async def get_episodes():
    if episodes_col is not None:
        docs = await episodes_col.find({}).sort("updatedAt", -1).to_list(None)
        return {"success": True, "episodes": [_strip(d) for d in docs]}
    return {"success": True, "episodes": _json_load_episodes()}


@router.post("/story/episodes")
async def save_episode(payload: EpisodeSavePayload):
    ep = payload.model_dump()
    if not ep["id"]:
        ep["id"] = str(uuid.uuid4())
    ep["createdAt"] = ep.get("createdAt") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ep["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if episodes_col is not None:
        await episodes_col.delete_many({"id": ep["id"]})
        await episodes_col.insert_one(ep)
        return {"success": True, "episode": _strip(ep)}

    return {"success": True, "episode": _json_save_episode(ep)}


@router.put("/story/episodes/{ep_id}")
async def update_episode(ep_id: str, payload: EpisodeSavePayload):
    ep = payload.model_dump()
    ep["id"] = ep_id
    ep["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if episodes_col is not None:
        result = await episodes_col.find_one_and_update(
            {"id": ep_id}, {"$set": ep}, upsert=True, return_document=True
        )
        return {"success": True, "episode": _strip(result)}

    return {"success": True, "episode": _json_save_episode(ep)}


@router.delete("/story/episodes/{ep_id}")
async def delete_episode(ep_id: str):
    if episodes_col is not None:
        await episodes_col.delete_one({"id": ep_id})
        return {"success": True}

    path = EPISODES_DIR / f"{ep_id}.json"
    if path.exists():
        path.unlink()
    return {"success": True}
