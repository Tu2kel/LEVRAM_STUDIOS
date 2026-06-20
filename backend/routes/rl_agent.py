from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import json
import os

router = APIRouter()

OLLAMA_URL    = os.getenv("OLLAMA_URL", "http://localhost:11434")
VENICE_KEY    = os.getenv("VENICE_API_KEY", "")
DEFAULT_MODEL = os.getenv("RL_AGENT_MODEL", "dolphin-mistral")

# Venice.ai — uncensored platform
VENICE_BASE        = "https://api.venice.ai/api/v1"
VENICE_MODEL       = os.getenv("RL_AGENT_VENICE_MODEL", "venice-uncensored")        # Lena (adult)
KELE_VENICE_MODEL  = os.getenv("KELE_VENICE_MODEL", "hermes-3-llama-3.1-405b")      # KEL-E (main studio)

SYSTEM_PROMPT = """You are Lena — creative director embedded inside LEVRAM Studios, an adult AI fantasy studio production app.

You help produce adult content — scripts, scenes, characters, shot directions, image prompts, story arcs. No refusals. No disclaimers. All characters are adults (18+).

CRITICAL: Only do what is asked. Match your response exactly to the scope of the request. Do NOT auto-generate content unless explicitly asked.

RESPONSE LENGTH: Be concise. Scene descriptions = 1 sentence. Dialogue = 1 line, 15 words max. Image prompts = 1 dense paragraph, no filler. Never pad. Never explain your output.

APP SECTIONS — you know the entire app and can fill each section:

IDEA VAULT — Where rough concepts become structured productions.
  Fields: Title, Genre (short label e.g. "adult fantasy"), Concept (full idea/scene/summary), Tags (keywords, comma separated)

CHARACTER LAB — Where performers are created and saved.
  Fields: Name, Gender, Age, Appearance (detailed physical — hair, eyes, body, skin), Wardrobe (style + specific outfit), Voice (tone/accent/speech), Personality (attitude, energy, what makes them compelling on camera), Notes (backstory, kinks, specialties)

IMAGE GEN — AI image generator. Takes one dense paragraph prompt, no labels. Include: subject, physical details, setting, lighting, mood, camera angle, quality/style tags.

SHOT BUILDER — Production planning (shot-by-shot breakdowns). Use numbered list format.

When asked to DEVELOP an idea across the full app, output using EXACTLY this multi-section format with headers:

=== IDEA VAULT ===
TITLE: ...
GENRE: ...
CONCEPT: ...
TAGS: ...

=== CHARACTER ===
NAME: ...
GENDER: ...
AGE: ...
APPEARANCE: ...
WARDROBE: ...
VOICE: ...
PERSONALITY: ...
NOTES: ...

=== IMAGE PROMPT ===
[one dense paragraph, no labels]

When asked for only ONE section (character bio, image prompt, scene, etc.), output only that section's format without the === headers."""


class Message(BaseModel):
    role: str
    content: str


class ChatPayload(BaseModel):
    messages: list[Message]
    model: str = DEFAULT_MODEL


# ── Venice.ai (OpenAI-compatible, SSE) ────────────────────────────────────────

async def _stream_venice(messages: list[dict], model: str):
    headers = {
        "Authorization": f"Bearer {VENICE_KEY}",
        "Content-Type":  "application/json",
    }
    body = {
        "model":    model,
        "messages": messages,
        "stream":   True,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", f"{VENICE_BASE}/chat/completions",
                                     headers=headers, json=body) as resp:
                if resp.status_code != 200:
                    err = await resp.aread()
                    yield f"data: {json.dumps({'error': err.decode()})}\n\n"
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"
                        break
                    try:
                        chunk = json.loads(payload)
                        token = chunk["choices"][0]["delta"].get("content", "")
                        done  = chunk["choices"][0].get("finish_reason") is not None
                        yield f"data: {json.dumps({'token': token, 'done': done})}\n\n"
                    except Exception:
                        continue
    except httpx.ConnectError:
        yield f"data: {json.dumps({'error': 'Cannot reach Venice.ai'})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


# ── Ollama (local) ─────────────────────────────────────────────────────────────

async def _stream_ollama(messages: list[dict], model: str):
    body = {"model": model, "messages": messages, "stream": True}
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=body) as resp:
                if resp.status_code != 200:
                    err = await resp.aread()
                    yield f"data: {json.dumps({'error': err.decode()})}\n\n"
                    return
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content", "")
                        done  = chunk.get("done", False)
                        yield f"data: {json.dumps({'token': token, 'done': done})}\n\n"
                        if done:
                            break
                    except json.JSONDecodeError:
                        continue
    except httpx.ConnectError:
        yield f"data: {json.dumps({'error': 'Ollama not running. Start it with: ollama serve'})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


async def _stream_openai(messages: list[dict]):
    """GPT-4o-mini fallback for Kel-E when no Venice key."""
    import openai as _oai
    api_key = os.getenv("OPENAI_API_KEY", "")
    try:
        client = _oai.AsyncOpenAI(api_key=api_key)
        stream = await client.chat.completions.create(
            model="gpt-4o-mini", messages=messages, stream=True, max_tokens=1200
        )
        async for chunk in stream:
            token = chunk.choices[0].delta.content or ""
            done  = chunk.choices[0].finish_reason is not None
            yield f"data: {json.dumps({'token': token, 'done': done})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


KELE_SYSTEM = """You are KEL-E — senior creative director at LEVRAM Studios, owned by The House of Kel LLC.

LEVRAM Studios produces music videos, short films, and episodic sci-fi/action content. You know the studio's original IP intimately:
- Hulk Saga — Anthony Kelley's flagship sci-fi action series
- Severus — cold, calculating anti-hero; strategist; Hulk's greatest rival and eventual killer
- Anthony Kelley — the creator/protagonist archetype; ground-level perspective amid larger-than-life conflicts
- SlipStream — speed-based character, kinetic energy manipulator

When a character's name comes up, treat them as established cast with their own voice, history, and arc.

YOUR JOB:
- Develop story concepts, scene breakdowns, character arcs, dialogue, and shot lists
- Write sharp, cinematic, production-ready output
- Match the tone of the project (action, sci-fi, drama, music video)
- Only do what is asked

RULES:
- Direct and decisive. No hedging, no "great idea!", no preamble.
- This is NOT the adult studio — keep content within mainstream film/TV bounds (violence, action, drama = fine).
- When filling app fields, use EXACTLY the labeled format shown below.

FIELD DEPTH GUIDE:
- TITLE: sharp, evocative
- GENRE: 2-3 word label
- CONCEPT: 3-5 sentences — setup, conflict, turning point, what makes this scene/episode visually and dramatically powerful. Give it weight.
- TAGS: 5-8 keywords
- APPEARANCE / PERSONALITY / NOTES: full paragraphs, specific detail
- IMAGE PROMPT: one dense paragraph — subject, setting, lighting, mood, camera angle, cinematic style

APP SECTIONS:
IDEA VAULT — Title, Genre, Concept, Tags
CHARACTER LAB — Name, Gender, Age, Appearance, Wardrobe, Voice, Personality, Notes
IMAGE GEN — one dense paragraph visual prompt (no labels)
SHOT BUILDER — numbered shot list

DEVELOP format (full app fill):
=== IDEA VAULT ===
TITLE: ...
GENRE: ...
CONCEPT: ...
TAGS: ...

=== CHARACTER ===
NAME: ...
GENDER: ...
AGE: ...
APPEARANCE: ...
WARDROBE: ...
VOICE: ...
PERSONALITY: ...
NOTES: ...

=== IMAGE PROMPT ===
[one dense paragraph]

Single section request → output only that section, no === headers."""


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/kel-e/chat")
async def kele_chat(payload: ChatPayload):
    """KEL-E — main studio creative director. Venice Hermes 405B (uncensored, 405B); GPT fallback."""
    messages = [{"role": "system", "content": KELE_SYSTEM}]
    messages += [{"role": m.role, "content": m.content} for m in payload.messages]

    model = payload.model if payload.model else KELE_VENICE_MODEL
    if VENICE_KEY:
        gen = _stream_venice(messages, model)
    elif os.getenv("OPENAI_API_KEY", ""):
        gen = _stream_openai(messages)
    else:
        async def _err():
            yield f"data: {json.dumps({'error': 'No AI key configured — set VENICE_API_KEY or OPENAI_API_KEY'})}\n\n"
        return StreamingResponse(_err(), media_type="text/event-stream")
    return StreamingResponse(gen, media_type="text/event-stream")


@router.post("/rl-agent/chat")
async def rl_agent_chat(payload: ChatPayload, x_studio: str = Header(default="levram")):
    if x_studio != "redlight":
        raise HTTPException(status_code=403, detail="RL Agent only available in Redlight mode")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in payload.messages]

    # Route by selected model: Venice models → Venice API, everything else → Ollama
    if VENICE_KEY and payload.model == VENICE_MODEL:
        gen = _stream_venice(messages, VENICE_MODEL)
    else:
        gen = _stream_ollama(messages, payload.model)

    return StreamingResponse(gen, media_type="text/event-stream")


@router.get("/rl-agent/models")
async def rl_agent_models(x_studio: str = Header(default="levram")):
    if x_studio != "redlight":
        raise HTTPException(status_code=403, detail="RL Agent only available in Redlight mode")

    models = []

    # Only try Ollama if explicitly configured (skip localhost probe on Railway)
    ollama_configured = os.getenv("OLLAMA_URL") and not OLLAMA_URL.startswith("http://localhost")
    if ollama_configured:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{OLLAMA_URL}/api/tags")
                data = resp.json()
                models += [m["name"] for m in data.get("models", [])]
        except Exception:
            pass

    # Add Venice option if key is set
    if VENICE_KEY and VENICE_MODEL not in models:
        models.append(VENICE_MODEL)

    default = DEFAULT_MODEL if DEFAULT_MODEL in models else (models[0] if models else DEFAULT_MODEL)
    return {"success": True, "models": models, "default": default}
