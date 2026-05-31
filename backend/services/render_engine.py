from pathlib import Path
from datetime import datetime
import json
import uuid

RENDER_DIR = Path("output/renders")


def generate_keyframe_manifest(queue_item: dict):
    RENDER_DIR.mkdir(parents=True, exist_ok=True)

    shot = queue_item.get("shot") or {}

    prompt = (
        shot.get("shotPrompt")
        or shot.get("prompt")
        or shot.get("shotDesc")
        or queue_item.get("dialogue")
        or "No prompt provided."
    )

    render_id = str(uuid.uuid4())
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    manifest = {
        "renderId": render_id,
        "queueId": queue_item.get("id"),
        "shotId": queue_item.get("shotId"),
        "shotNumber": queue_item.get("shot_number"),
        "project": queue_item.get("project"),
        "character": queue_item.get("character"),
        "renderStyle": queue_item.get("renderStyle", "cinematic"),
        "prompt": prompt,
        "status": "manifest_created",
        "createdAt": timestamp,
        "note": "MVP placeholder. Replace this service with ComfyUI/image generation next."
    }

    filename = f"{queue_item.get('shotId') or 'shot'}_{timestamp}_{render_id[:8]}.json"
    path = RENDER_DIR / filename

    with path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    return {
        "renderId": render_id,
        "outputPath": str(path),
        "outputUrl": "/" + str(path),
        "manifest": manifest
    }
