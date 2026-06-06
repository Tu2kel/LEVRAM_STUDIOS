from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
import json
import uuid
from datetime import datetime

from backend.db import projects_col

router = APIRouter()

PROJECTS_DIR = Path("data/projects")
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


# ─── JSON fallback helpers ────────────────────────────────────

def _load_project(pid: str) -> dict | None:
    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _save_project(data: dict):
    pid = data["id"]
    path = PROJECTS_DIR / f"{pid}.json"
    path.write_text(json.dumps(data, indent=2))


def _all_projects_json() -> list[dict]:
    projects = []
    for f in sorted(PROJECTS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            projects.append(json.loads(f.read_text()))
        except Exception:
            pass
    return projects


def _strip(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    return d


# ─── Payloads ─────────────────────────────────────────────────

class ProjectPayload(BaseModel):
    name: str
    genre: str = ""
    logline: str = ""
    status: str = "development"
    color: str = "#c9a84c"


class ProjectUpdatePayload(BaseModel):
    name: str | None = None
    genre: str | None = None
    logline: str | None = None
    status: str | None = None
    color: str | None = None
    active: bool | None = None


# ─── Routes ───────────────────────────────────────────────────

@router.get("/projects")
async def list_projects():
    if projects_col is not None:
        docs = await projects_col.find({}).sort("created_at", -1).to_list(None)
        return {"success": True, "projects": [_strip(d) for d in docs]}
    return {"success": True, "projects": _all_projects_json()}


@router.post("/projects")
async def create_project(payload: ProjectPayload):
    pid = str(uuid.uuid4())[:8]
    now = datetime.utcnow().isoformat()
    project = {
        "id":         pid,
        "name":       payload.name,
        "genre":      payload.genre,
        "logline":    payload.logline,
        "status":     payload.status,
        "color":      payload.color,
        "active":     False,
        "created_at": now,
        "updated_at": now,
    }
    if projects_col is not None:
        await projects_col.insert_one(project)
        return {"success": True, "project": _strip(project)}
    _save_project(project)
    return {"success": True, "project": project}


@router.get("/projects/{pid}")
async def get_project(pid: str):
    if projects_col is not None:
        doc = await projects_col.find_one({"id": pid})
        if not doc:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"success": True, "project": _strip(doc)}
    p = _load_project(pid)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True, "project": p}


@router.put("/projects/{pid}")
async def update_project(pid: str, payload: ProjectUpdatePayload):
    updates: dict = {"updated_at": datetime.utcnow().isoformat()}
    if payload.name    is not None: updates["name"]    = payload.name
    if payload.genre   is not None: updates["genre"]   = payload.genre
    if payload.logline is not None: updates["logline"] = payload.logline
    if payload.status  is not None: updates["status"]  = payload.status
    if payload.color   is not None: updates["color"]   = payload.color
    if payload.active  is not None: updates["active"]  = payload.active

    if projects_col is not None:
        result = await projects_col.find_one_and_update(
            {"id": pid}, {"$set": updates}, return_document=True
        )
        if not result:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"success": True, "project": _strip(result)}

    p = _load_project(pid)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    p.update(updates)
    _save_project(p)
    return {"success": True, "project": p}


@router.post("/projects/{pid}/activate")
async def activate_project(pid: str):
    if projects_col is not None:
        await projects_col.update_many({}, {"$set": {"active": False}})
        result = await projects_col.find_one_and_update(
            {"id": pid}, {"$set": {"active": True}}, return_document=True
        )
        if not result:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"success": True, "active_project": _strip(result)}

    all_projects = _all_projects_json()
    for p in all_projects:
        p["active"] = (p["id"] == pid)
        _save_project(p)
    active = _load_project(pid)
    if not active:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True, "active_project": active}


@router.delete("/projects/{pid}")
async def delete_project(pid: str):
    if projects_col is not None:
        result = await projects_col.delete_one({"id": pid})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"success": True, "deleted": pid}

    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    path.unlink()
    return {"success": True, "deleted": pid}
