"""
LEVRAM Orchestrator — autonomous scene pipeline
Idea Vault scenes → Keyframe → I2V → TTS → Timeline (one shot at a time, live updates)
"""
import os
import re
import uuid
import asyncio
import json
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks

router = APIRouter()

_JOBS: dict = {}

TIMELINE_FILE = Path("data/timelines/main_timeline.json")

# Image gen slang sanitizer — prevents roosters, animals, wrong objects from slang words
_IMG_SWAP = [
    (re.compile(r'\bcock\b', re.IGNORECASE), 'erect penis'),
    (re.compile(r'\bcocks\b', re.IGNORECASE), 'penises'),
    (re.compile(r'\bpussy\b', re.IGNORECASE), 'vulva'),
    (re.compile(r'\bcum\b', re.IGNORECASE), 'fluid'),
    (re.compile(r'\bcums\b', re.IGNORECASE), 'climaxes'),
    (re.compile(r'\bcumming\b', re.IGNORECASE), 'orgasming'),
    (re.compile(r'\bblow\s*job\b', re.IGNORECASE), 'oral sex'),
    (re.compile(r'\bboner\b', re.IGNORECASE), 'erection'),
]

def _sanitize_img(prompt: str) -> str:
    for pat, rep in _IMG_SWAP:
        prompt = pat.sub(rep, prompt)
    return prompt


def _update(job_id: str, **kw):
    if job_id in _JOBS:
        _JOBS[job_id].update(kw)


# ── GPT shot breakdown (only used when scenes not pre-supplied) ──────────────

async def _plan_shots(concept: str, num_shots: int, character_name: str) -> list[dict]:
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    loop   = asyncio.get_event_loop()

    system = (
        "You are a cinematic shot planner for LEVRAM Studios. "
        "Return ONLY valid JSON — a list of shot objects, no markdown, no commentary."
    )
    user = (
        f"Scene concept: {concept}\n"
        f"Character: {character_name or 'unnamed'}\n"
        f"Generate {num_shots} cinematic shots. Each shot is a JSON object with:\n"
        f"  description   – one sentence shot description\n"
        f"  image_prompt  – detailed image gen prompt (scene, outfit, lighting — NO face/skin)\n"
        f"  motion_prompt – single smooth continuous motion for I2V (no 'then' chains)\n"
        f"  dialogue      – optional spoken line, empty string if none\n"
        f"Return a JSON array only."
    )

    def _call():
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system},
                      {"role": "user",   "content": user}],
            temperature=0.7,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content.strip()
        raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(raw)

    return await loop.run_in_executor(None, _call)


# ── Image generation ──────────────────────────────────────────────────────────

async def _gen_image(prompt: str, character_id: str) -> str:
    """Returns local /output/renders/images/... URL. Routes through WaveSpeed."""
    from backend.routes.image_gen import (
        _ws_generate_image, _ws_pulid, WS_IMG_SIZES, _ws_to_public_url
    )
    import base64 as _b64mod
    loop = asyncio.get_event_loop()

    from backend.db import characters_col
    db_char = None
    if character_id:
        if characters_col is not None:
            doc = await characters_col.find_one({"id": character_id})
            db_char = {k: v for k, v in doc.items() if k != "_id"} if doc else None
        else:
            data_file = Path("data/characters.json")
            if data_file.exists():
                chars = json.loads(data_file.read_text()).get("characters", [])
                db_char = next((c for c in chars if c.get("id") == character_id), None)

    refs = (db_char or {}).get("reference_images") or []

    # BYO preview images take priority as face reference
    preview_imgs = (db_char or {}).get("preview_images") or []
    active_idx   = int((db_char or {}).get("active_preview_index") or 0)
    byo_entry    = preview_imgs[active_idx] if preview_imgs else None
    byo_ref_url  = (byo_entry or {}).get("url", "") if byo_entry else ""

    # LoRA disabled — WaveSpeed handles character lock via PuLID face reference
    if byo_ref_url or refs:
        # Build a public URL for the face reference so WaveSpeed can fetch it
        domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
        face_url = ""
        if byo_ref_url and byo_ref_url.startswith("http"):
            face_url = byo_ref_url
        elif byo_ref_url:
            p = Path(byo_ref_url.lstrip("/"))
            if p.exists() and domain:
                face_url = f"https://{domain}/{byo_ref_url.lstrip('/')}"
        if not face_url and refs and domain:
            ref_path = Path(refs[0].lstrip("/"))
            if ref_path.exists():
                face_url = f"https://{domain}/{refs[0].lstrip('/')}"

        # Railway ephemeral filesystem fallback — restore from MongoDB base64
        if not face_url and domain:
            refs_b64 = (db_char or {}).get("reference_images_b64") or []
            if refs_b64:
                import base64 as _b64f
                entry = refs_b64[0]
                raw   = _b64f.b64decode(entry["data"])
                try:
                    restore_path = Path(entry["url"].lstrip("/"))
                    restore_path.parent.mkdir(parents=True, exist_ok=True)
                    restore_path.write_bytes(raw)
                    face_url = f"https://{domain}/{entry['url'].lstrip('/')}"
                except Exception:
                    pass

        if face_url:
            # Use WaveSpeed PuLID with public URL directly
            from backend.routes.image_gen import _ws_submit_poll, _download_url, _save_bytes, IMAGE_DIR
            import json as _json, datetime as _dt
            outputs = await loop.run_in_executor(None, lambda: _ws_submit_poll(
                "wavespeed-ai/flux-pulid", {
                    "prompt":              f"{prompt}, cinematic photorealistic",
                    "image":               face_url,
                    "width":               1280, "height": 720,
                    "num_inference_steps": 28,
                    "guidance_scale":      3.5,
                    "true_cfg":            1.0,
                }
            ))
            remote_url = outputs[0] if outputs else ""
            if not remote_url:
                raise RuntimeError("WaveSpeed PuLID returned no image")
            IMAGE_DIR.mkdir(parents=True, exist_ok=True)
            ts    = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
            fname = f"orch_{ts}_{uuid.uuid4().hex[:6]}.jpg"
            image_bytes = await loop.run_in_executor(None, lambda: _download_url(remote_url))
            (IMAGE_DIR / fname).write_bytes(image_bytes)
            return "/output/renders/images/" + fname
        else:
            result = await loop.run_in_executor(
                None, lambda: _ws_generate_image(prompt, "widescreen", "cinematic photorealistic")
            )
    else:
        result = await loop.run_in_executor(
            None, lambda: _ws_generate_image(prompt, "widescreen", "cinematic photorealistic")
        )

    return result["imageUrl"]


# ── I2V animation ─────────────────────────────────────────────────────────────

async def _animate(image_url: str, motion_prompt: str, model: str, duration: int) -> str:
    """Returns local /output/videos/... URL or CDN URL."""
    loop = asyncio.get_event_loop()
    if model.startswith("ws_"):
        from backend.routes.video import _wavespeed_i2v
        result = await loop.run_in_executor(
            None, lambda: _wavespeed_i2v(image_url, motion_prompt, model, duration)
        )
    else:
        from backend.routes.video import _fal_image_to_video
        result = await loop.run_in_executor(
            None, lambda: _fal_image_to_video(image_url, motion_prompt, model, duration)
        )
    return result.get("videoUrl") or result.get("outputUrl") or result.get("remoteUrl") or ""


# ── TTS ───────────────────────────────────────────────────────────────────────

async def _gen_tts(text: str, character_id: str, character_name: str = "") -> str:
    """Resolve character name from ID, then call TTS. Returns audio URL."""
    from backend.db import characters_col
    from backend.routes.tts import tts_generate

    # Resolve actual character name for TTS lookup
    char_name = character_name or character_id or "default"
    if character_id:
        if characters_col is not None:
            doc = await characters_col.find_one({"id": character_id})
            if doc:
                char_name = doc.get("name", char_name)
        else:
            data_file = Path("data/characters.json")
            if data_file.exists():
                chars = json.loads(data_file.read_text()).get("characters", [])
                match = next((c for c in chars if c.get("id") == character_id), None)
                if match:
                    char_name = match.get("name", char_name)

    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: tts_generate(text=text, character=char_name))
    return result.get("output_url") or result.get("audio_url") or result.get("url") or ""


# ── Timeline save (live — called after each shot) ─────────────────────────────

async def _append_to_timeline(shot: dict):
    """Append one shot to the timeline. MongoDB + local JSON for Railway compatibility."""
    from backend.db import scenes_col

    # MongoDB: upsert shot as a scene document
    if scenes_col is not None:
        try:
            await scenes_col.update_one(
                {"id": shot["id"]}, {"$set": shot}, upsert=True
            )
        except Exception as e:
            print(f"[ORCH] MongoDB scene upsert failed: {e}")

    # Local JSON: always write for timeline.html / export compatibility
    TIMELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    existing = []
    if TIMELINE_FILE.exists():
        try:
            existing = json.loads(TIMELINE_FILE.read_text()).get("shots", [])
        except Exception:
            existing = []

    # Replace if shot already exists (retry scenario), otherwise append
    ids = {s["id"] for s in existing}
    if shot["id"] in ids:
        existing = [s if s["id"] != shot["id"] else shot for s in existing]
    else:
        existing.append(shot)

    # Renumber
    for i, s in enumerate(existing, 1):
        s["shot_number"] = f"SC-{i:03d}"

    TIMELINE_FILE.write_text(json.dumps({"shots": existing}, indent=2))


# ── Main autonomous pipeline ──────────────────────────────────────────────────

async def _run_pipeline(job_id: str, payload: dict):
    scenes_input   = payload.get("scenes", [])    # pre-built scenes from Idea Vault
    concept        = payload.get("concept", "")
    character_id   = payload.get("character_id", "")
    char_name      = payload.get("character_name", "")
    character2_id  = payload.get("character2_id", "")
    char2_name     = payload.get("character2_name", "")
    genre          = payload.get("genre", "")
    tone_notes     = payload.get("tone_notes", "")
    duration       = int(payload.get("duration", 5))
    model          = payload.get("model", "ws_wan22")
    include_tts    = payload.get("include_tts", True)
    project        = payload.get("project", char_name or "Default")
    keyframes_only = payload.get("keyframes_only", False)

    # Look up char2 appearance for prompt injection when no face lock available
    char2_appearance = ""
    if character2_id:
        try:
            from backend.db import characters_col as _cc
            if _cc is not None:
                _doc2 = await _cc.find_one({"id": character2_id})
                if _doc2:
                    char2_appearance = " ".join(filter(None, [_doc2.get("appearance",""), _doc2.get("wardrobe","")]))
            else:
                _chars = json.loads(Path("data/characters.json").read_text()).get("characters", [])
                _doc2  = next((c for c in _chars if c.get("id") == character2_id), None)
                if _doc2:
                    char2_appearance = " ".join(filter(None, [_doc2.get("appearance",""), _doc2.get("wardrobe","")]))
        except Exception:
            pass

    # Build a tone prefix injected into every image prompt so the AI stays on genre
    _tone_prefix = ""
    genre_lower = genre.lower()
    # Detect female-only cast — lock men out of image gen explicitly
    _female_keywords = {"lesbian", "female", "women", "woman", "girl", "femme"}
    _is_female_cast = bool(_female_keywords.intersection(genre_lower.split()))

    # Also check char genders from DB if available
    if not _is_female_cast and (character_id or character2_id):
        try:
            from backend.db import characters_col as _gcc
            _gender_ids = [_id for _id in [character_id, character2_id] if _id]
            if _gcc is not None:
                _gdocs = await _gcc.find({"id": {"$in": _gender_ids}}).to_list(None)
                _genders = [d.get("gender", "").lower() for d in _gdocs]
            else:
                _gcdata = json.loads(Path("data/characters.json").read_text()).get("characters", [])
                _genders = [c.get("gender", "").lower() for c in _gcdata if c.get("id") in _gender_ids]
            if _genders and all("female" in g or "woman" in g or "girl" in g for g in _genders):
                _is_female_cast = True
        except Exception:
            pass

    _gender_guard = "two women, both female, no men, no male figures, " if _is_female_cast else ""

    _adult_photo_style = ""
    _ADULT_IMG_GENRES = {"adult", "lesbian", "erotic", "explicit", "nsfw", "xxx", "female", "sapphic"}
    if _ADULT_IMG_GENRES.intersection(genre_lower.split()):
        _adult_photo_style = "photorealistic boudoir photography, intimate, unclothed female bodies, sensual lighting, "

    if genre or tone_notes or _gender_guard or _adult_photo_style:
        parts = []
        if _gender_guard:      parts.append(_gender_guard.rstrip(", "))
        if _adult_photo_style: parts.append(_adult_photo_style.rstrip(", "))
        if genre:              parts.append(genre)
        if tone_notes:         parts.append(tone_notes)
        _tone_prefix = ", ".join(parts) + " — "

    clear_project = payload.get("clear_project", False)

    try:
        # ── 0. Clear previous shots for this project (fresh run)
        if clear_project and project:
            from backend.db import scenes_col as _sc
            if _sc is not None:
                await _sc.delete_many({"project": project})
            if TIMELINE_FILE.exists():
                try:
                    existing = json.loads(TIMELINE_FILE.read_text()).get("shots", [])
                    existing = [s for s in existing if s.get("project") != project]
                    TIMELINE_FILE.write_text(json.dumps({"shots": existing}, indent=2))
                except Exception:
                    pass

        # ── 1. Get shots — use pre-built scenes or GPT planning
        if scenes_input:
            shots = scenes_input
            _update(job_id, status="running", total=len(shots),
                    step=f"Starting autonomous pipeline — {len(shots)} scenes")
        else:
            num_shots = min(max(int(payload.get("num_shots", 3)), 1), 100)
            _update(job_id, status="planning", step="GPT: Breaking concept into shots…")
            shots = await _plan_shots(concept, num_shots, char_name)
            _update(job_id, status="running", total=len(shots),
                    step=f"Plan complete — {len(shots)} shots queued")

        for i, shot in enumerate(shots):
            label = f"[{i+1}/{len(shots)}]"

            # ── 2. Keyframe image
            _update(job_id, progress=i,
                    step=f"{label} Generating keyframe — {shot.get('description','')[:60]}…")
            try:
                raw_prompt   = shot.get("image_prompt") or shot.get("shot_prompt") or shot.get("description") or concept
                # If char2 has appearance info and it's not already in the prompt, prepend it
                if char2_appearance and char2_name and char2_name.lower() not in raw_prompt.lower():
                    raw_prompt = f"{char2_name}: {char2_appearance}. {raw_prompt}"
                raw_prompt   = _sanitize_img(raw_prompt)
                image_prompt = _tone_prefix + raw_prompt if _tone_prefix else raw_prompt
                # Apply character face lock using char1 reference image
                shot_char_id = character_id if shot.get("character_lock", True) else ""
                image_url = await _gen_image(image_prompt, shot_char_id)
            except Exception as e:
                err_msg = f"Shot {i+1} keyframe failed: {str(e)[:120]}"
                print(f"[ORCH] {err_msg}")
                _JOBS[job_id].setdefault("errors", []).append(err_msg)
                _update(job_id, step=f"{label} ⚠ Keyframe failed — {str(e)[:80]}")
                continue

            # ── 3. I2V animation (skipped in keyframes_only mode)
            video_url = ""
            if not keyframes_only:
                motion = (shot.get("motion_prompt") or
                          f"cinematic motion, {shot.get('emotion','dramatic')}, smooth camera")
                _update(job_id, step=f"{label} Animating with {model}…")
                # WaveSpeed needs a public URL — convert local /output/ path
                _domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
                animate_url = (f"https://{_domain}{image_url}"
                               if _domain and image_url.startswith("/")
                               else image_url)
                try:
                    shot_dur = int(shot.get("duration", duration))
                    video_url = await _animate(animate_url, motion, model, shot_dur)
                except Exception as e:
                    print(f"[ORCH] I2V failed shot {i+1}: {e}")

            # ── 4. TTS voice (skipped in keyframes_only mode)
            audio_url = ""
            if include_tts and shot.get("dialogue") and not keyframes_only:
                _update(job_id, step=f"{label} Generating voice…")
                try:
                    audio_url = await _gen_tts(shot["dialogue"], character_id, char_name)
                except Exception as e:
                    print(f"[ORCH] TTS failed shot {i+1}: {e}")

            # ── 5. Build shot record
            shot_doc = {
                "id":              str(uuid.uuid4()),
                "shot_number":     f"SC-{i+1:03d}",
                "name":            f"Shot {i+1}: {shot.get('description','')[:50]}",
                "shotDesc":        shot.get("description", ""),
                "shot_description":shot.get("description", ""),
                "shotPrompt":      shot.get("image_prompt", ""),
                "dialogue":        shot.get("dialogue", ""),
                "character":       char_name,
                "project":         project,
                "type":            "video",
                "videoUrl":        video_url,
                "renderOutputUrl": image_url,
                "imageUrl":        image_url,
                "fxUrl":           audio_url,
                "rawUrl":          audio_url,
                "source":          "orchestrator",
                "createdAt":       datetime.now().strftime("%Y-%m-%d %H:%M"),
            }

            # ── 6. Land in timeline immediately (live progress)
            await _append_to_timeline(shot_doc)
            _JOBS[job_id].setdefault("shots", []).append(shot_doc)
            mode_tag = "keyframe" if keyframes_only else ('animated' if video_url else 'keyframe only')
            _update(job_id,
                    step=f"{label} ✔ Shot {i+1} — {mode_tag}"
                         f"{', voiced' if audio_url else ''}")

        total_done = len(_JOBS[job_id].get("shots", []))
        if keyframes_only:
            _update(job_id, status="keyframes_ready", progress=len(shots),
                    step=f"✔ {total_done} keyframes ready — review and approve to animate")
        else:
            _update(job_id, status="complete", progress=len(shots),
                    step=f"✔ Done — {total_done}/{len(shots)} shots in Timeline. Open Timeline ↗")

    except Exception as e:
        import traceback
        traceback.print_exc()
        _update(job_id, status="failed", error=str(e)[:400],
                step=f"Pipeline failed: {str(e)[:120]}")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/orchestrate/run")
async def run_orchestration(payload: dict, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _JOBS[job_id] = {
        "status":   "starting",
        "progress": 0,
        "total":    0,
        "step":     "Starting…",
        "shots":    [],
        "errors":   [],
        "error":    None,
        "started_at": datetime.now().isoformat(),
    }
    background_tasks.add_task(_run_pipeline, job_id, payload)
    return {"success": True, "job_id": job_id}


@router.get("/orchestrate/status/{job_id}")
async def orchestrate_status(job_id: str):
    job = _JOBS.get(job_id)
    if not job:
        return {"error": "Job not found"}
    return job


@router.get("/orchestrate/jobs")
async def list_jobs():
    return {
        "jobs": [
            {"job_id": k, **{kk: v for kk, v in j.items() if kk != "shots"}}
            for k, j in _JOBS.items()
        ]
    }


# ── Re-animate approved keyframes with a new model (Wan → Kling upgrade) ─────

async def _run_reanimate(job_id: str, payload: dict):
    shots        = payload.get("shots", [])        # [{id, image_url, motion_prompt, dialogue, ...}]
    model        = payload.get("model", "kling_26")
    duration     = int(payload.get("duration", 5))
    include_tts  = payload.get("include_tts", True)
    character_id = payload.get("character_id", "")
    char_name    = payload.get("character_name", "")
    project      = payload.get("project", "")

    _update(job_id, status="running", total=len(shots),
            step=f"Re-animating {len(shots)} shots with {model}…")

    try:
        for i, shot in enumerate(shots):
            label = f"[{i+1}/{len(shots)}]"
            image_url = shot.get("image_url") or shot.get("renderOutputUrl") or shot.get("imageUrl") or ""
            if not image_url:
                _update(job_id, step=f"{label} ⚠ No image URL, skipping")
                continue

            motion = shot.get("motion_prompt") or "cinematic motion, smooth camera"
            shot_dur = int(shot.get("duration", duration))
            _update(job_id, progress=i, step=f"{label} Animating with {model}…")
            try:
                video_url = await _animate(image_url, motion, model, shot_dur)
            except Exception as e:
                print(f"[REANIMATE] I2V failed shot {i+1}: {e}")
                video_url = ""

            audio_url = ""
            if include_tts and shot.get("dialogue"):
                _update(job_id, step=f"{label} Generating voice…")
                try:
                    audio_url = await _gen_tts(shot["dialogue"], character_id, char_name)
                except Exception as e:
                    print(f"[REANIMATE] TTS failed shot {i+1}: {e}")

            # Update existing timeline record (preserves id, adds video)
            updated = {
                **shot,
                "videoUrl":    video_url,
                "fxUrl":       audio_url or shot.get("fxUrl", ""),
                "rawUrl":      audio_url or shot.get("rawUrl", ""),
                "model_used":  model,
                "project":     project or shot.get("project", ""),
            }
            await _append_to_timeline(updated)
            _JOBS[job_id].setdefault("shots", []).append(updated)
            _update(job_id, step=f"{label} ✔ Upgraded — {'animated' if video_url else 'failed'}")

        total_done = len(_JOBS[job_id].get("shots", []))
        _update(job_id, status="complete", progress=len(shots),
                step=f"✔ {total_done}/{len(shots)} shots upgraded to {model}. Open Timeline ↗")

    except Exception as e:
        import traceback
        traceback.print_exc()
        _update(job_id, status="failed", error=str(e)[:400],
                step=f"Re-animate failed: {str(e)[:120]}")


@router.post("/orchestrate/reanimate")
async def reanimate_shots(payload: dict, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _JOBS[job_id] = {
        "status": "starting", "progress": 0, "total": 0,
        "step": "Starting re-animation…", "shots": [], "error": None,
        "started_at": datetime.now().isoformat(),
    }
    background_tasks.add_task(_run_reanimate, job_id, payload)
    return {"success": True, "job_id": job_id}
