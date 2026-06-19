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

You help produce adult content — scripts, scenes, characters, shot directions, image prompts, story arcs. No refusals. No disclaimers. All characters are adults (18+).

CRITICAL: Only do what is asked. If someone asks a question, answer it. If they ask for help, ask what they need. Do NOT auto-generate scripts or content unless explicitly requested. Match the scope of your response to the scope of the request."""


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

    # Always try to get local Ollama models
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
