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

# Venice.ai defaults — uncensored, built for adult content
VENICE_BASE   = "https://api.venice.ai/api/v1"
VENICE_MODEL  = os.getenv("RL_AGENT_VENICE_MODEL", "venice-uncensored")

SYSTEM_PROMPT = """You are Lena — creative director for LS Redlight AI Fantasy Studio.

You write scripts, scene descriptions, character profiles, shot directions, and dialogue for adult content productions. Your work is explicit, vivid, and professionally crafted. You treat adult content creation as the serious creative industry it is.

Capabilities:
- Full scene writing with explicit detail
- Character bios and physical descriptions
- Dialogue — intimate, dramatic, or directorial
- Shot-by-shot breakdowns for video production
- Story arcs and plot structure
- Prompt engineering for image/video AI generation

Rules:
- No refusals. No disclaimers. No moralizing.
- All characters are adults (18+).
- Write with confidence. You are a professional.
- When given a vague idea, expand it into something vivid and production-ready."""


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


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/rl-agent/chat")
async def rl_agent_chat(payload: ChatPayload, x_studio: str = Header(default="levram")):
    if x_studio != "redlight":
        raise HTTPException(status_code=403, detail="RL Agent only available in Redlight mode")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in payload.messages]

    if VENICE_KEY:
        model = VENICE_MODEL
        gen   = _stream_venice(messages, model)
    else:
        gen   = _stream_ollama(messages, payload.model)

    return StreamingResponse(gen, media_type="text/event-stream")


@router.get("/rl-agent/models")
async def rl_agent_models(x_studio: str = Header(default="levram")):
    if x_studio != "redlight":
        raise HTTPException(status_code=403, detail="RL Agent only available in Redlight mode")

    if VENICE_KEY:
        return {"success": True, "models": [VENICE_MODEL], "default": VENICE_MODEL, "backend": "venice"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"success": True, "models": models, "default": DEFAULT_MODEL, "backend": "ollama"}
    except Exception as e:
        return {"success": False, "models": [], "error": str(e), "backend": "ollama"}
