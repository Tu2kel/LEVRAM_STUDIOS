from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pathlib import Path
import json
import uuid
from datetime import datetime

router = APIRouter()

PROJECTS_DIR = Path("data/projects")
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _load_project(pid: str) -> dict | None:
    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _save_project(data: dict):
    pid = data["id"]
    path = PROJECTS_DIR / f"{pid}.json"
    path.write_text(json.dumps(data, indent=2))


def _all_projects() -> list[dict]:
    projects = []
    for f in sorted(PROJECTS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            projects.append(json.loads(f.read_text()))
        except Exception:
            pass
    return projects


class ProjectPayload(BaseModel):
    name: str
    genre: str = ""
    logline: str = ""
    status: str = "development"   # development | production | complete | archived
    color: str = "#c9a84c"


class ProjectUpdatePayload(BaseModel):
    name: str | None = None
    genre: str | None = None
    logline: str | None = None
    status: str | None = None
    color: str | None = None
    active: bool | None = None


@router.get("/projects")
def list_projects():
    return {"success": True, "projects": _all_projects()}


@router.post("/projects")
def create_project(payload: ProjectPayload):
    pid = str(uuid.uuid4())[:8]
    now = datetime.utcnow().isoformat()
    project = {
        "id":        pid,
        "name":      payload.name,
        "genre":     payload.genre,
        "logline":   payload.logline,
        "status":    payload.status,
        "color":     payload.color,
        "active":    False,
        "created_at": now,
        "updated_at": now,
    }
    _save_project(project)
    return {"success": True, "project": project}


@router.get("/projects/{pid}")
def get_project(pid: str):
    p = _load_project(pid)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True, "project": p}


@router.put("/projects/{pid}")
def update_project(pid: str, payload: ProjectUpdatePayload):
    p = _load_project(pid)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.name    is not None: p["name"]    = payload.name
    if payload.genre   is not None: p["genre"]   = payload.genre
    if payload.logline is not None: p["logline"] = payload.logline
    if payload.status  is not None: p["status"]  = payload.status
    if payload.color   is not None: p["color"]   = payload.color
    if payload.active  is not None: p["active"]  = payload.active
    p["updated_at"] = datetime.utcnow().isoformat()
    _save_project(p)
    return {"success": True, "project": p}


@router.post("/projects/{pid}/activate")
def activate_project(pid: str):
    # Deactivate all others, then activate this one
    all_projects = _all_projects()
    for p in all_projects:
        p["active"] = (p["id"] == pid)
        _save_project(p)
    active = _load_project(pid)
    if not active:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True, "active_project": active}


@router.delete("/projects/{pid}")
def delete_project(pid: str):
    path = PROJECTS_DIR / f"{pid}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    path.unlink()
    return {"success": True, "deleted": pid}
