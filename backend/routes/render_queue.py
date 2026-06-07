from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

from backend.db import render_queue_col
from backend.services.comfy_service import generate_comfy_keyframe

def _generate_keyframe_with_fallback(item: dict) -> dict:
    """Try ComfyUI first; fall back to fal.ai FLUX if ComfyUI is unreachable."""
    try:
        return generate_comfy_keyframe(item)
    except Exception as comfy_err:
        print(f"[LEVRAM] ComfyUI keyframe failed ({comfy_err}), falling back to fal.ai FLUX")
        import os, uuid
        from pathlib import Path
        try:
            import fal_client
        except ImportError:
            raise RuntimeError("fal-client not installed and ComfyUI unavailable") from comfy_err

        api_key = os.getenv("FAL_KEY")
        if not api_key:
            raise RuntimeError("FAL_KEY not set and ComfyUI unavailable") from comfy_err

        shot = item.get("shot") or item
        prompt = (
            shot.get("shotPrompt") or shot.get("shot_prompt") or
            shot.get("shotDesc") or shot.get("shot_description") or
            "cinematic scene, dramatic lighting, high detail, film still"
        )
        character = shot.get("character") or shot.get("voice_character") or ""
        if character:
            prompt = f"{character}, {prompt}"

        os.environ["FAL_KEY"] = api_key
        result = fal_client.run(
            "fal-ai/flux/dev",
            arguments={"prompt": prompt, "image_size": "landscape_16_9", "num_inference_steps": 28},
        )
        image_url = result["images"][0]["url"] if result.get("images") else None
        if not image_url:
            raise RuntimeError("fal.ai returned no image") from comfy_err

        import urllib.request as ur
        rid = uuid.uuid4().hex[:8]
        out_dir = Path("output/renders/keyframes")
        out_dir.mkdir(parents=True, exist_ok=True)
        filename = f"kf_fal_{rid}.png"
        local_path = out_dir / filename
        ur.urlretrieve(image_url, local_path)
        out_url = f"/output/renders/keyframes/{filename}"
        return {
            "renderId": rid,
            "outputPath": str(local_path),
            "outputUrl": out_url,
            "promptUsed": prompt,
            "comfyPromptId": "",
        }

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


# ─── JSON fallback helpers ────────────────────────────────────

def _json_load() -> dict:
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not QUEUE_FILE.exists():
        return {"queue": []}
    with QUEUE_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def _json_save(data: dict):
    QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with QUEUE_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ─── Routes ───────────────────────────────────────────────────

@router.get("/render-queue")
async def get_render_queue():
    if render_queue_col is not None:
        docs = await render_queue_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "queue": [_strip(d) for d in docs]}
    data = _json_load()
    return {"success": True, "queue": data["queue"]}


@router.post("/render-queue")
async def add_to_render_queue(payload: QueuePayload):
    shot = payload.shot or {}
    item = {
        "id":          str(uuid.uuid4()),
        "shot":        shot,
        "shotId":      payload.shotId or shot.get("id"),
        "shot_number": shot.get("shot_number"),
        "project":     payload.project or shot.get("project") or shot.get("title"),
        "character":   payload.character or shot.get("character"),
        "dialogue":    payload.dialogue or shot.get("dialogue") or shot.get("text"),
        "voicePath":   payload.voicePath or shot.get("voicePath") or shot.get("voice_path"),
        "renderStyle": payload.renderStyle or shot.get("renderStyle") or "cinematic",
        "status":      "pending",
        "createdAt":   _now(),
        "updatedAt":   _now(),
    }

    if render_queue_col is not None:
        await render_queue_col.insert_one(item)
        docs = await render_queue_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "item": _strip(item), "queue": [_strip(d) for d in docs]}

    data = _json_load()
    data["queue"].insert(0, item)
    _json_save(data)
    return {"success": True, "item": item, "queue": data["queue"]}


@router.put("/render-queue/{item_id}/status")
async def update_queue_status(item_id: str, payload: StatusPayload):
    allowed = ["pending", "rendering", "complete", "failed"]
    if payload.status not in allowed:
        return {"success": False, "error": "Invalid status", "allowed": allowed}

    if render_queue_col is not None:
        result = await render_queue_col.find_one_and_update(
            {"id": item_id},
            {"$set": {"status": payload.status, "updatedAt": _now()}},
            return_document=True,
        )
        if not result:
            return {"success": False, "error": "Queue item not found"}
        docs = await render_queue_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "item": _strip(result), "queue": [_strip(d) for d in docs]}

    data = _json_load()
    for item in data["queue"]:
        if item["id"] == item_id:
            item["status"] = payload.status
            item["updatedAt"] = _now()
            _json_save(data)
            return {"success": True, "item": item, "queue": data["queue"]}
    return {"success": False, "error": "Queue item not found"}


@router.delete("/render-queue/{item_id}")
async def delete_queue_item(item_id: str):
    if render_queue_col is not None:
        result = await render_queue_col.delete_one({"id": item_id})
        if result.deleted_count == 0:
            return {"success": False, "error": "Queue item not found"}
        docs = await render_queue_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "queue": [_strip(d) for d in docs]}

    data = _json_load()
    before = len(data["queue"])
    data["queue"] = [i for i in data["queue"] if i["id"] != item_id]
    if len(data["queue"]) == before:
        return {"success": False, "error": "Queue item not found"}
    _json_save(data)
    return {"success": True, "queue": data["queue"]}


@router.post("/render-queue/{item_id}/start")
async def start_render(item_id: str):
    if render_queue_col is not None:
        result = await render_queue_col.find_one_and_update(
            {"id": item_id},
            {"$set": {"status": "rendering", "updatedAt": _now()}},
            return_document=True,
        )
        if not result:
            return {"success": False, "error": "Queue item not found"}
        docs = await render_queue_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "message": "Render started", "item": _strip(result), "queue": [_strip(d) for d in docs]}

    data = _json_load()
    for item in data["queue"]:
        if item["id"] == item_id:
            item["status"] = "rendering"
            item["updatedAt"] = _now()
            _json_save(data)
            return {"success": True, "message": "Render started", "item": item, "queue": data["queue"]}
    return {"success": False, "error": "Queue item not found"}


@router.post("/render-queue/{item_id}/keyframe")
async def generate_keyframe(item_id: str):
    if render_queue_col is not None:
        item_doc = await render_queue_col.find_one({"id": item_id})
        if not item_doc:
            return {"success": False, "error": "Queue item not found"}
        item = _strip(item_doc)
        item["status"] = "rendering"
        item["updatedAt"] = _now()
        await render_queue_col.update_one({"id": item_id}, {"$set": {"status": "rendering", "updatedAt": _now()}})

        render_result = _generate_keyframe_with_fallback(item)
        updates = {
            "status":           "complete",
            "renderId":         render_result["renderId"],
            "renderOutputPath": render_result["outputPath"],
            "renderOutputUrl":  render_result["outputUrl"],
            "promptUsed":       render_result.get("promptUsed") or render_result.get("prompt") or "",
            "comfyPromptId":    render_result.get("comfyPromptId") or "",
            "updatedAt":        _now(),
        }
        result = await render_queue_col.find_one_and_update(
            {"id": item_id}, {"$set": updates}, return_document=True
        )
        docs = await render_queue_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "message": "Keyframe image created", "item": _strip(result),
                "render": render_result, "queue": [_strip(d) for d in docs]}

    data = _json_load()
    for item in data["queue"]:
        if item["id"] == item_id:
            item["status"] = "rendering"
            item["updatedAt"] = _now()
            render_result = _generate_keyframe_with_fallback(item)
            item.update({
                "status":           "complete",
                "renderId":         render_result["renderId"],
                "renderOutputPath": render_result["outputPath"],
                "renderOutputUrl":  render_result["outputUrl"],
                "promptUsed":       render_result.get("promptUsed") or render_result.get("prompt") or "",
                "comfyPromptId":    render_result.get("comfyPromptId") or "",
                "updatedAt":        _now(),
            })
            _json_save(data)
            return {"success": True, "message": "Keyframe image created", "item": item,
                    "render": render_result, "queue": data["queue"]}
    return {"success": False, "error": "Queue item not found"}


# ─── Legacy compatibility routes ──────────────────────────────

@router.post("/render-queue/add")
async def legacy_add_to_render_queue(payload: QueuePayload):
    return await add_to_render_queue(payload)


@router.get("/render-queue/load")
async def legacy_load_render_queue():
    return await get_render_queue()


@router.post("/render-queue/clear")
async def legacy_clear_render_queue():
    if render_queue_col is not None:
        await render_queue_col.delete_many({})
        return {"success": True, "queue": []}
    _json_save({"queue": []})
    return {"success": True, "queue": []}
