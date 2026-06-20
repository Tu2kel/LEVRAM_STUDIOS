from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
import json

router = APIRouter()

TIMELINE_FILE = Path("data/timelines/main_timeline.json")
TIMELINE_FILE.parent.mkdir(parents=True, exist_ok=True)


class TimelinePayload(BaseModel):
    shots: list


@router.get("/timeline/load")
async def load_timeline():
    from backend.db import scenes_col

    # MongoDB-first: load shots ordered by creation time
    if scenes_col is not None:
        try:
            cursor = scenes_col.find({}, {"_id": 0}).sort("shot_number", 1)
            shots  = await cursor.to_list(length=None)
            if shots:
                return {"shots": shots}
            # Fall through to local JSON if Mongo is empty (initial state)
        except Exception as e:
            print(f"[TIMELINE] MongoDB load failed, falling back to JSON: {e}")

    if not TIMELINE_FILE.exists():
        return {"shots": []}
    with open(TIMELINE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("/timeline/save-order")
async def save_timeline(payload: TimelinePayload):
    from backend.db import scenes_col

    ordered = []
    for i, shot in enumerate(payload.shots, 1):
        shot["shot_number"] = f"SC-{i:03d}"
        ordered.append(shot)

    # MongoDB: upsert each shot
    if scenes_col is not None:
        try:
            for shot in ordered:
                sid = shot.get("id")
                if sid:
                    await scenes_col.update_one({"id": sid}, {"$set": shot}, upsert=True)
        except Exception as e:
            print(f"[TIMELINE] MongoDB save failed, JSON only: {e}")

    # Always write local JSON for export / timeline.html
    TIMELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TIMELINE_FILE, "w", encoding="utf-8") as f:
        json.dump({"shots": ordered}, f, indent=2)

    return {"status": "saved", "count": len(ordered), "shots": ordered}
