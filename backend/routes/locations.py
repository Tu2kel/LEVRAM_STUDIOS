import os
import re
import uuid
import io
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

LOCATIONS_DIR = Path("data/locations")
LOCATIONS_FILE = Path("data/locations.json")
LOC_REF_DIR = Path("output/renders/location_refs")


def _ensure():
    LOCATIONS_DIR.mkdir(parents=True, exist_ok=True)
    LOC_REF_DIR.mkdir(parents=True, exist_ok=True)
    if not LOCATIONS_FILE.exists():
        LOCATIONS_FILE.write_text('{"locations": []}')


def _load():
    _ensure()
    import json
    return json.loads(LOCATIONS_FILE.read_text())


def _save(data):
    import json
    LOCATIONS_FILE.write_text(json.dumps(data, indent=2))


def _strip(doc):
    d = dict(doc)
    d.pop("_id", None)
    return d


async def _get_loc(loc_id: str, studio: str):
    from backend.db import locations_col
    if locations_col is not None:
        doc = await locations_col.find_one({"id": loc_id})
        return _strip(doc) if doc else None
    data = _load()
    return next((l for l in data["locations"] if l["id"] == loc_id), None)


class LocationPayload(BaseModel):
    name: str
    description: str = ""
    lighting: str = ""
    atmosphere: str = ""
    color_palette: str = ""
    time_of_day: str = ""
    weather: str = ""
    camera_notes: str = ""


@router.get("/locations")
async def list_locations(x_studio: str = Header(default="levram")):
    from backend.db import locations_col
    if locations_col is not None:
        docs = await locations_col.find({"studio": x_studio}).sort("name", 1).to_list(None)
        return {"success": True, "locations": [_strip(d) for d in docs]}
    data = _load()
    locs = [l for l in data["locations"] if l.get("studio", "levram") == x_studio]
    return {"success": True, "locations": locs}


@router.post("/locations")
async def create_location(payload: LocationPayload, x_studio: str = Header(default="levram")):
    import json
    from backend.db import locations_col
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    loc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "description": payload.description,
        "lighting": payload.lighting,
        "atmosphere": payload.atmosphere,
        "color_palette": payload.color_palette,
        "time_of_day": payload.time_of_day,
        "weather": payload.weather,
        "camera_notes": payload.camera_notes,
        "reference_images": [],
        "reference_images_b64": [],
        "studio": x_studio,
        "created_at": now,
        "updated_at": now,
    }
    if locations_col is not None:
        await locations_col.insert_one(dict(loc))
        return {"success": True, "location": loc}
    data = _load()
    data["locations"].append(loc)
    _save(data)
    return {"success": True, "location": loc}


@router.put("/locations/{location_id}")
async def update_location(location_id: str, payload: dict, x_studio: str = Header(default="levram")):
    from backend.db import locations_col
    allowed = {"name","description","lighting","atmosphere","color_palette","time_of_day","weather","camera_notes"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    updates["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if locations_col is not None:
        await locations_col.update_one({"id": location_id}, {"$set": updates})
        doc = await locations_col.find_one({"id": location_id}, {"_id": 0})
        return {"success": True, "location": doc}
    import json
    data = _load()
    for loc in data["locations"]:
        if loc["id"] == location_id:
            loc.update(updates)
            break
    _save(data)
    loc = next((l for l in data["locations"] if l["id"] == location_id), None)
    return {"success": True, "location": loc}


@router.delete("/locations/{location_id}")
async def delete_location(location_id: str, x_studio: str = Header(default="levram")):
    from backend.db import locations_col
    if locations_col is not None:
        await locations_col.delete_one({"id": location_id})
        return {"success": True}
    data = _load()
    data["locations"] = [l for l in data["locations"] if l["id"] != location_id]
    _save(data)
    return {"success": True}


@router.post("/locations/{location_id}/upload-reference")
async def upload_location_reference(location_id: str, file: UploadFile = File(...),
                                     x_studio: str = Header(default="levram")):
    import base64 as _b64, json
    try:
        from backend.db import locations_col
        loc = await _get_loc(location_id, x_studio)
        if not loc:
            return JSONResponse(status_code=404, content={"success": False, "error": "Location not found"})

        raw_bytes = await file.read()
        try:
            from PIL import Image as _PIL
            img = _PIL.open(io.BytesIO(raw_bytes)).convert("RGB")
            if img.width > 1280 or img.height > 1280:
                img.thumbnail((1280, 1280), _PIL.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85, optimize=True)
            raw_bytes = buf.getvalue()
        except Exception as e:
            print(f"[loc-ref] compression skipped: {e}")

        LOC_REF_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = re.sub(r"[^\w.]", "_", file.filename or "ref.jpg")
        dest = LOC_REF_DIR / f"{location_id}_{safe_name}"
        dest.write_bytes(raw_bytes)

        b64_str = _b64.b64encode(raw_bytes).decode()
        ref_entry = {"filename": safe_name, "path": str(dest), "data": b64_str, "mediaType": "image/jpeg"}

        if locations_col is not None:
            await locations_col.update_one(
                {"id": location_id},
                {"$push": {
                    "reference_images": str(dest),
                    "reference_images_b64": ref_entry,
                }}
            )
        else:
            data = _load()
            for l in data["locations"]:
                if l["id"] == location_id:
                    l.setdefault("reference_images", []).append(str(dest))
                    l.setdefault("reference_images_b64", []).append(ref_entry)
                    break
            _save(data)

        return {"success": True, "path": str(dest), "url": f"/output/renders/location_refs/{dest.name}"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)[:300]})
