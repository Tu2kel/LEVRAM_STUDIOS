from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

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
from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/output", StaticFiles(directory="output"), name="output")

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
