from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json, uuid

from backend.db import ideas_col

router = APIRouter()
DATA_FILE = Path("data/ideas.json")


class IdeaPayload(BaseModel):
    title: str
    source: str = ""
    rawIdea: str
    tags: list[str] = []


def _ensure():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text(json.dumps({"ideas": []}, indent=2))


def _load():
    _ensure()
    return json.loads(DATA_FILE.read_text())


def _save(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


def _strip(doc):
    d = dict(doc)
    d.pop("_id", None)
    return d


@router.get("/ideas")
async def get_ideas():
    if ideas_col is not None:
        docs = await ideas_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "ideas": [_strip(d) for d in docs]}
    return {"success": True, "ideas": _load()["ideas"]}


@router.post("/ideas")
async def save_idea(payload: IdeaPayload):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    idea = {"id": str(uuid.uuid4()), "title": payload.title, "source": payload.source,
            "rawIdea": payload.rawIdea, "tags": payload.tags, "status": "raw",
            "createdAt": now, "updatedAt": now}
    if ideas_col is not None:
        await ideas_col.insert_one(idea)
        docs = await ideas_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "idea": _strip(idea), "ideas": [_strip(d) for d in docs]}
    data = _load()
    data["ideas"].insert(0, idea)
    _save(data)
    return {"success": True, "idea": idea, "ideas": data["ideas"]}


@router.delete("/ideas/{idea_id}")
async def delete_idea(idea_id: str):
    if ideas_col is not None:
        await ideas_col.delete_one({"id": idea_id})
        docs = await ideas_col.find({}).sort("createdAt", -1).to_list(None)
        return {"success": True, "ideas": [_strip(d) for d in docs]}
    data = _load()
    data["ideas"] = [i for i in data["ideas"] if i["id"] != idea_id]
    _save(data)
    return {"success": True, "ideas": data["ideas"]}
