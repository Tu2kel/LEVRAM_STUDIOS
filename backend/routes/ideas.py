from fastapi import APIRouter
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import json
import uuid

router = APIRouter()

DATA_FILE = Path("data/ideas.json")


class IdeaPayload(BaseModel):
    title: str
    source: str = ""
    rawIdea: str
    tags: list[str] = []


def ensure_file():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text(json.dumps({"ideas": []}, indent=2))


def load_ideas():
    ensure_file()
    return json.loads(DATA_FILE.read_text())


def save_ideas(data):
    DATA_FILE.write_text(json.dumps(data, indent=2))


@router.get("/ideas")
def get_ideas():
    data = load_ideas()
    return {
        "success": True,
        "ideas": data["ideas"]
    }


@router.post("/ideas")
def save_idea(payload: IdeaPayload):
    data = load_ideas()

    idea = {
        "id": str(uuid.uuid4()),
        "title": payload.title,
        "source": payload.source,
        "rawIdea": payload.rawIdea,
        "tags": payload.tags,
        "status": "raw",
        "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

    data["ideas"].insert(0, idea)
    save_ideas(data)

    return {
        "success": True,
        "idea": idea,
        "ideas": data["ideas"]
    }


@router.delete("/ideas/{idea_id}")
def delete_idea(idea_id: str):
    data = load_ideas()
    data["ideas"] = [idea for idea in data["ideas"] if idea["id"] != idea_id]
    save_ideas(data)

    return {
        "success": True,
        "ideas": data["ideas"]
    }
