from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import asyncio
import uuid

router = APIRouter()

IMAGE_DIR = Path("output/renders/images")

ASPECT_SIZES = {
    "widescreen": (768, 512),
    "portrait":   (512, 768),
    "square":     (512, 512),
    "cinematic":  (896, 384),
}

STYLE_LABELS = {
    "cinematic photorealistic": "Cinematic Photorealistic",
    "comic book illustration": "Comic Book",
    "anime illustration": "Anime",
    "oil painting concept art": "Concept Art",
    "dark fantasy digital art": "Dark Fantasy",
}


class ImageGenPayload(BaseModel):
    prompt: str
    character: str = ""
    style: str = "cinematic photorealistic"
    negative_prompt: str = ""
    aspect: str = "widescreen"


@router.post("/image-gen/generate")
async def generate_image(payload: ImageGenPayload):
    from backend.services.comfy_service import generate_comfy_keyframe

    w, h = ASPECT_SIZES.get(payload.aspect, (768, 512))

    queue_item = {
        "id": str(uuid.uuid4()),
        "shotId": f"imagegen-{uuid.uuid4().hex[:8]}",
        "shot": {
            "character": payload.character or "",
            "shotDesc": payload.prompt,
            "shotPrompt": payload.prompt,
            "renderStyle": payload.style,
            "scene": "Image Gen",
            "shot_number": "IMAGE-GEN",
        },
    }

    loop = asyncio.get_event_loop()

    try:
        result = await loop.run_in_executor(
            None, lambda: generate_comfy_keyframe(queue_item, width=w, height=h)
        )
        return {
            "success": True,
            "imageUrl": result.get("outputUrl") or ("/" + result.get("outputPath", "")),
            "prompt": result.get("promptUsed"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/image-gen/gallery")
def get_gallery():
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    images = sorted(IMAGE_DIR.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {
        "success": True,
        "images": [
            {
                "url": "/output/renders/images/" + f.name,
                "filename": f.name,
                "created": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            }
            for f in images[:60]
        ],
    }
