from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
import json
import uuid
from datetime import datetime

router = APIRouter()

QUEUE_FILE = Path("data/render_queue/render_queue.json")
QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)

class QueuePayload(BaseModel):
    shot: dict

def load_queue_data():
    if not QUEUE_FILE.exists():
        return {"queue": []}

    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_queue_data(data):
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

@router.get("/render-queue/load")
def load_render_queue():
    return load_queue_data()

@router.post("/render-queue/add")
def add_to_render_queue(payload: QueuePayload):
    data = load_queue_data()

    item = {
        "id": str(uuid.uuid4()),
        "shot": payload.shot,
        "status": "pending",
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    data["queue"].append(item)
    save_queue_data(data)

    return {
        "success": True,
        "item": item,
        "queue": data["queue"]
    }

@router.delete("/render-queue/{item_id}")
def delete_queue_item(item_id: str):
    data = load_queue_data()
    data["queue"] = [item for item in data["queue"] if item["id"] != item_id]
    save_queue_data(data)

    return {
        "success": True,
        "queue": data["queue"]
    }

@router.post("/render-queue/clear")
def clear_render_queue():
    data = {"queue": []}
    save_queue_data(data)

    return {
        "success": True,
        "queue": []
    }
