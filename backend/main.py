from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from backend.routes.tts import router as tts_router
from backend.routes.voice_fx import router as voice_fx_router
from backend.routes.scenes import router as scenes_router

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
