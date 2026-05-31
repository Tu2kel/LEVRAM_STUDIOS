from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid
from backend.services.comfy_service import generate_comfy_keyframe

router = APIRouter()

QUEUE_FILE = Path("data/render_queue.json")


class QueuePayload(BaseModel):
    shot: dict | None = None
    shotId: str | None = None
    project: str | None = None
    character: str | None = None
    dialogue: str | None = None
    voicePath: str | None = None
    renderStyle: str | None = "cinematic"


class StatusPayload(BaseModel):
    status: str


def load_queue_data():
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)

    if not QUEUE_FILE.exists():
        return {"queue": []}

    with QUEUE_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_queue_data(data):
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)

    with QUEUE_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@router.get("/render-queue")
def get_render_queue():
    data = load_queue_data()
    return {
        "success": True,
        "queue": data["queue"]
    }


@router.post("/render-queue")
def add_to_render_queue(payload: QueuePayload):
    data = load_queue_data()

    shot = payload.shot or {}

    item = {
        "id": str(uuid.uuid4()),
        "shot": shot,
        "shotId": payload.shotId or shot.get("id"),
        "shot_number": shot.get("shot_number"),
        "project": payload.project or shot.get("project") or shot.get("title"),
        "character": payload.character or shot.get("character"),
        "dialogue": payload.dialogue or shot.get("dialogue") or shot.get("text"),
        "voicePath": payload.voicePath or shot.get("voicePath") or shot.get("voice_path"),
        "renderStyle": payload.renderStyle or shot.get("renderStyle") or "cinematic",
        "status": "pending",
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    data["queue"].insert(0, item)
    save_queue_data(data)

    return {
        "success": True,
        "item": item,
        "queue": data["queue"]
    }


@router.put("/render-queue/{item_id}/status")
def update_queue_status(item_id: str, payload: StatusPayload):
    allowed = ["pending", "rendering", "complete", "failed"]

    if payload.status not in allowed:
        return {
            "success": False,
            "error": "Invalid status",
            "allowed": allowed
        }

    data = load_queue_data()

    for item in data["queue"]:
        print("QUEUE ID:", item["id"])
        if item["id"] == item_id:
            item["status"] = payload.status
            item["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_queue_data(data)
            return {
                "success": True,
                "item": item,
                "queue": data["queue"]
            }

    return {
        "success": False,
        "error": "Queue item not found"
    }


@router.delete("/render-queue/{item_id}")
def delete_queue_item(item_id: str):
    data = load_queue_data()
    before = len(data["queue"])

    data["queue"] = [item for item in data["queue"] if item["id"] != item_id]

    if len(data["queue"]) == before:
        return {
            "success": False,
            "error": "Queue item not found"
        }

    save_queue_data(data)

    return {
        "success": True,
        "queue": data["queue"]
    }


@router.post("/render-queue/{item_id}/start")
def start_render(item_id: str):
    data = load_queue_data()

    for item in data["queue"]:
        print("QUEUE ID:", item["id"])
        if item["id"] == item_id:
            item["status"] = "rendering"
            item["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_queue_data(data)

            return {
                "success": True,
                "message": "Render started",
                "item": item,
                "queue": data["queue"]
            }

    return {
        "success": False,
        "error": "Queue item not found"
    }


@router.post("/render-queue/{item_id}/keyframe")
def generate_keyframe(item_id: str):
    print("\n=== KEYFRAME REQUEST ===")
    print("REQUESTED ID:", item_id)
    data = load_queue_data()

    for item in data["queue"]:
        print("QUEUE ID:", item["id"])
        if item["id"] == item_id:
            item["status"] = "rendering"
            item["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            render_result = generate_comfy_keyframe(item)

            item["status"] = "complete"
            item["renderId"] = render_result["renderId"]
            item["renderOutputPath"] = render_result["outputPath"]
            item["renderOutputUrl"] = render_result["outputUrl"]
            item["promptUsed"] = render_result.get("promptUsed") or render_result.get("prompt") or ""
            item["comfyPromptId"] = render_result.get("comfyPromptId") or ""
            item["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            save_queue_data(data)

            return {
                "success": True,
                "message": "Keyframe image created",
                "item": item,
                "render": render_result,
                "queue": data["queue"]
            }

    return {
        "success": False,
        "error": "Queue item not found"
    }



# ─── Legacy compatibility routes ─────────────────────────────

@router.post("/render-queue/add")
def legacy_add_to_render_queue(payload: QueuePayload):
    return add_to_render_queue(payload)


@router.get("/render-queue/load")
def legacy_load_render_queue():
    return get_render_queue()


@router.post("/render-queue/clear")
def legacy_clear_render_queue():
    save_queue_data({"queue": []})
    return {
        "success": True,
        "queue": []
    }
