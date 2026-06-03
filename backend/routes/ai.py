from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
import os
import json
from pathlib import Path

load_dotenv()

router = APIRouter()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


class BuildShotPayload(BaseModel):
    idea: str
    visual_character: str = ""
    voice_character: str = ""
    character: str = ""
    secondary_character: str = ""
    shot_type: str = ""
    camera_mood: str = ""
    color_palette: str = ""



def get_character_context(character_name: str = ""):
    if not character_name or character_name == "None":
        return ""

    file_path = Path("data/characters.json")

    if not file_path.exists():
        return ""

    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as e:
        print("PHASE 8C CHARACTER LOAD ERROR:", e)
        return ""

    characters = data.get("characters", []) if isinstance(data, dict) else []

    for c in characters:
        if c.get("name") == character_name:
            context = f"""
Name: {c.get("name", "")}
Gender: {c.get("gender", "")}
Age: {c.get("age", "")}
Appearance: {c.get("appearance", "")}
Wardrobe: {c.get("wardrobe", "")}
Voice: {c.get("voice", "")}
Personality: {c.get("personality", "")}
Notes: {c.get("notes", "")}
""".strip()

            print("PHASE 8C CHARACTER CONTEXT INJECTED:", c.get("name"))
            return context

    print("PHASE 8C CHARACTER NOT FOUND:", character_name)
    return ""

@router.post("/ai/build-shot")
def build_shot(payload: BuildShotPayload):
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY missing from .env")

    system = """
You are LEVRAM Studios Prompt Intelligence.
Return ONLY valid JSON.
Build cinematic AI generation fields from the user's idea.
If shot type, camera mood, or color palette says "AI Suggested", choose the best matching option from the available LEVRAM style.
For suggested_shot_type, suggested_camera_mood, and suggested_color_palette, return a clean dropdown-ready value.
Do not include markdown.
JSON keys:
shot_description, shot_prompt, negative_prompt, title, suggested_shot_type, suggested_camera_mood, suggested_color_palette
"""

    primary_character_context = get_character_context(payload.character)
    secondary_character_context = get_character_context(payload.secondary_character)

    character_context = f"""
PRIMARY CHARACTER:
{primary_character_context}

SECONDARY CHARACTER:
{secondary_character_context}
""".strip()

    user = f"""
Character Context:
{character_context}

Idea: {payload.idea}
Visual Character: {payload.visual_character}
Voice Character: {payload.voice_character}
Primary Character: {payload.character}
Secondary Character: {payload.secondary_character}
Shot Type: {payload.shot_type}
Camera Mood: {payload.camera_mood}
Color Palette: {payload.color_palette}
"""

    try:
        res = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system.strip()},
                {"role": "user", "content": user.strip()},
            ],
            temperature=0.8,
        )

        text = res.choices[0].message.content.strip()
        data = json.loads(text)

        return {
            "success": True,
            "data": data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ReviseShotPayload(BaseModel):
    current_description: str
    current_prompt: str
    override_notes: str
    character: str = ""
    secondary_character: str = ""


@router.post("/ai/revise-shot")
def revise_shot(payload: ReviseShotPayload):
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY missing from .env")

    system = """
You are LEVRAM Shot Revision AI.

Treat the user's notes as director instructions.

You may modify:
- shot_description
- shot_prompt
- shot type
- camera mood
- color palette

Follow the direction creatively while preserving story intent.

Return ONLY valid JSON.
Do not include markdown.

JSON keys:
shot_description,
shot_prompt,
suggested_shot_type,
suggested_camera_mood,
suggested_color_palette
"""

    primary_character_context = get_character_context(payload.character)
    secondary_character_context = get_character_context(payload.secondary_character)

    character_context = f"""
PRIMARY CHARACTER:
{primary_character_context}

SECONDARY CHARACTER:
{secondary_character_context}
""".strip()

    user = f"""
Character Context:
{character_context}

Current Description:
{payload.current_description}

Current Prompt:
{payload.current_prompt}

Primary Character:
{payload.character}

Secondary Character:
{payload.secondary_character}

Revision Request:
{payload.override_notes}
"""

    try:
        res = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system.strip()},
                {"role": "user", "content": user.strip()}
            ],
            temperature=0.7
        )

        text = res.choices[0].message.content.strip()
        data = json.loads(text)

        return {
            "success": True,
            "data": data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
