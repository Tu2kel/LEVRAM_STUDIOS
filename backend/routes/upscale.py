"""Image upscaling — free (PIL Lanczos fallback) → RealESRGAN binary → Topaz stub."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime

router   = APIRouter()
BASE_DIR = Path(".")


class UpscalePayload(BaseModel):
    image_url: str          # e.g. "/output/renders/images/dalle3_abc.png"
    scale:     int = 4      # 2 or 4


@router.post("/upscale/image")
def upscale_image(payload: UpscalePayload):
    from backend.services.realesrgan_service import upscale

    rel_path = payload.image_url.lstrip("/")
    in_path  = BASE_DIR / rel_path
    if not in_path.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {in_path}")

    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir  = Path("output/renders/upscaled")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_name = f"upscaled_{ts}_{in_path.stem}.png"
    out_path = out_dir / out_name

    result = upscale(str(in_path), str(out_path), scale=payload.scale)

    return {
        "success":  True,
        "imageUrl": "/output/renders/upscaled/" + out_name,
        "engine":   result["engine"],
        "scale":    result["scale"],
        "original": payload.image_url,
    }


@router.get("/upscale/gallery")
def get_upscale_gallery():
    out_dir = Path("output/renders/upscaled")
    out_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(out_dir.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)
    return {
        "success": True,
        "images": [
            {
                "url":     "/output/renders/upscaled/" + f.name,
                "name":    f.name,
                "created": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
                "size_mb": round(f.stat().st_size / 1_048_576, 1),
            }
            for f in files[:20]
        ]
    }
