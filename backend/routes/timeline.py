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
def load_timeline():
    if not TIMELINE_FILE.exists():
        return {"shots": []}

    with open(TIMELINE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

@router.post("/timeline/save-order")
def save_timeline(payload: TimelinePayload):
    ordered = []

    for index, shot in enumerate(payload.shots, start=1):
        shot["shot_number"] = f"SC-{index:03d}"
        ordered.append(shot)

    data = {"shots": ordered}

    with open(TIMELINE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return {
        "status": "saved",
        "count": len(ordered),
        "shots": ordered
    }
