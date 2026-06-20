import os
from fastapi import FastAPI, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routes.tts import router as tts_router
from backend.routes.voice_fx import router as voice_fx_router
from backend.routes.scenes import router as scenes_router
from backend.routes.timeline import router as timeline_router
from backend.routes.render_queue import router as render_queue_router
from backend.routes.characters import router as characters_router
from backend.routes.ideas import router as ideas_router
from backend.routes.ai import router as ai_router
from backend.routes.voices import router as voices_router
from backend.routes.voice_clone import router as voice_clone_router
from backend.routes.image_gen import router as image_gen_router
from backend.routes.video import router as video_router
from backend.routes.settings import router as settings_router
from backend.routes.story import router as story_router
from backend.routes.music import router as music_router
from backend.routes.upscale import router as upscale_router
from backend.routes.assets import router as assets_router
from backend.routes.projects import router as projects_router
from backend.routes.orchestrate import router as orchestrate_router
from backend.routes.rl_agent import router as rl_agent_router
from dotenv import load_dotenv
from pathlib import Path
load_dotenv()

# Strip whitespace/newlines from API keys — Railway sometimes saves keys with trailing \n
for _k in ["FAL_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "WAVESPEED_KEY",
           "VENICE_API_KEY", "NOVITA_API_KEY", "MONGODB_URL"]:
    _v = os.getenv(_k)
    if _v and _v != _v.strip():
        os.environ[_k] = _v.strip()

# Ensure output dirs exist (Railway has no persistent FS pre-created)
for _d in ["output/renders/images", "output/renders/keyframes",
           "output/audio/tts", "output/audio/voice",
           "output/videos", "output/music", "data"]:
    Path(_d).mkdir(parents=True, exist_ok=True)

# ── Startup key validation ─────────────────────────────────────
_REQUIRED_KEYS = {
    "FAL_KEY":          "fal.ai image/video generation",
    "OPENAI_API_KEY":   "GPT-4o-mini (shot builder, story engine)",
    "ELEVENLABS_API_KEY": "ElevenLabs voice generation",
}
for _key, _feature in _REQUIRED_KEYS.items():
    if not os.getenv(_key):
        print(f"[LEVRAM] WARNING: {_key} not set — {_feature} will fail at runtime.")

if not os.getenv("MONGODB_URL"):
    print("[LEVRAM] INFO: MONGODB_URL not set — using JSON file fallback for all storage.")

if not os.getenv("LEVRAM_PASSWORD"):
    print("[LEVRAM] INFO: LEVRAM_PASSWORD not set — API is open (set this in Railway Variables).")

app = FastAPI()

# ── Password gate middleware ───────────────────────────────────
# Set LEVRAM_PASSWORD in Railway Variables to enable.
# If not set, studio runs open (local dev / trusted network).
_PASSWORD = os.getenv("LEVRAM_PASSWORD", "")
_OPEN_PATHS = {"/settings/status", "/frontend", "/output"}  # always allowed

@app.middleware("http")
async def auth_gate(request: Request, call_next):
    if not _PASSWORD:
        return await call_next(request)
    path = request.url.path
    # Allow static assets and the launch/frontend pages through
    if any(path.startswith(p) for p in _OPEN_PATHS):
        return await call_next(request)
    # Check Authorization header: Bearer <password>
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    # Also accept as query param ?key=<password> for quick testing
    if not token:
        token = request.query_params.get("key", "")
    if token != _PASSWORD:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/output", StaticFiles(directory="output"), name="output")
app.mount("/frontend", StaticFiles(directory="frontend", html=True), name="frontend")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

app.include_router(tts_router)
app.include_router(voice_fx_router)
app.include_router(scenes_router)
app.include_router(timeline_router)
app.include_router(render_queue_router)
app.include_router(ideas_router)
app.include_router(ai_router)
app.include_router(characters_router)
app.include_router(voices_router)
app.include_router(voice_clone_router)
app.include_router(image_gen_router)
app.include_router(video_router)
app.include_router(settings_router)
app.include_router(story_router)
app.include_router(music_router)
app.include_router(upscale_router)
app.include_router(assets_router)
app.include_router(projects_router)
app.include_router(orchestrate_router)
app.include_router(rl_agent_router)
