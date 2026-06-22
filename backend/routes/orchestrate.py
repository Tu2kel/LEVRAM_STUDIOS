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

    refs      = (db_char or {}).get("reference_images") or []
    body_refs = (db_char or {}).get("body_reference_images") or []

    # BYO preview images take priority as face reference
    preview_imgs = (db_char or {}).get("preview_images") or []
    active_idx   = int((db_char or {}).get("active_preview_index") or 0)
    byo_entry    = preview_imgs[active_idx] if preview_imgs else None
    byo_ref_url  = (byo_entry or {}).get("url", "") if byo_entry else ""

    # ── Full body reference via Seedream (takes priority — covers face + body) ─
    print(f"[BODY_REF] char_id={character_id} db_char={'found' if db_char else 'MISSING'} body_refs={body_refs}")
    if body_refs and character_id:
        domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
        print(f"[BODY_REF] domain={domain!r}")
        body_ref_url = ""
        if domain:
            body_ref_url = f"https://{domain}/{body_refs[0].lstrip('/')}"
        if not body_ref_url and domain:
            # Fetch b64 from dedicated collection (new path), fall back to legacy field
            from backend.db import char_b64_col as _b64_col
            body_refs_b64 = []
            if _b64_col is not None:
                _b64doc = await _b64_col.find_one({"character_id": character_id})
                body_refs_b64 = _b64doc.get("refs", []) if _b64doc else []
            if not body_refs_b64:
                body_refs_b64 = (db_char or {}).get("body_reference_images_b64") or []
            if body_refs_b64:
                import base64 as _b64body
                entry = body_refs_b64[0]
                try:
                    restore_path = Path(entry["url"].lstrip("/"))
                    restore_path.parent.mkdir(parents=True, exist_ok=True)
                    restore_path.write_bytes(_b64body.b64decode(entry["data"]))
                    body_ref_url = f"https://{domain}/{entry['url'].lstrip('/')}"
                except Exception:
                    pass
        print(f"[BODY_REF] body_ref_url={body_ref_url!r}")
        if body_ref_url:
            from backend.routes.image_gen import _ws_seedream_edit, IMAGE_DIR, _download_url
            import datetime as _dt
            try:
                outputs = await loop.run_in_executor(None, lambda: _ws_seedream_edit(
                    f"{prompt}, cinematic photorealistic", [body_ref_url]
                ))
                remote_url = outputs[0] if outputs else ""
                if not remote_url:
                    raise RuntimeError("Seedream returned no image")
                IMAGE_DIR.mkdir(parents=True, exist_ok=True)
                ts    = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
                fname = f"orch_{ts}_{uuid.uuid4().hex[:6]}.jpg"
                image_bytes = await loop.run_in_executor(None, lambda: _download_url(remote_url))
                (IMAGE_DIR / fname).write_bytes(image_bytes)
                return "/output/renders/images/" + fname
            except Exception as _seedream_err:
                print(f"[BODY_REF] Seedream failed ({_seedream_err}), trying Venice/Novita body-ref")
                _body_bytes = None
                try:
                    _body_bytes = await loop.run_in_executor(None, lambda: _download_url(body_ref_url))
                except Exception as _dl_err:
                    print(f"[BODY_REF] body-ref download failed ({_dl_err})")
                if _body_bytes:
                    _body_prompt = f"{prompt}, cinematic photorealistic"
                    for _provider, _fn in [
                        ("Novita",  lambda: __import__('backend.routes.image_gen', fromlist=['_novita_body_ref'])._novita_body_ref(_body_prompt, _body_bytes, "cinematic")),
                        ("Venice",  lambda: __import__('backend.routes.image_gen', fromlist=['_venice_body_ref'])._venice_body_ref(_body_prompt, _body_bytes, "cinematic")),
                    ]:
                        try:
                            _r = await loop.run_in_executor(None, _fn)
                            print(f"[BODY_REF] {_provider} body-ref succeeded")
                            return _r["imageUrl"]
                        except Exception as _prov_err:
                            print(f"[BODY_REF] {_provider} body-ref failed ({_prov_err}), trying next")
                print(f"[BODY_REF] all body-ref providers failed, falling back to PuLID/plain")

    # ── Face-only lock via PuLID (fallback when no full body ref) ──────────────
    print(f"[PULID] char_id={character_id} db_char={'found' if db_char else 'MISSING'} refs={refs} preview={byo_ref_url[:60] if byo_ref_url else 'none'}")
    if byo_ref_url or refs:
        domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
        print(f"[PULID] domain={domain!r}")
        face_url = ""
        if byo_ref_url and byo_ref_url.startswith("http"):
            face_url = byo_ref_url
        elif byo_ref_url and domain:
            # Don't gate on file existence — just build the URL and let WaveSpeed try
            face_url = f"https://{domain}/{byo_ref_url.lstrip('/')}"
        if not face_url and refs and domain:
            # Don't gate on file existence — volume should serve it
            face_url = f"https://{domain}/{refs[0].lstrip('/')}"

        # MongoDB base64 fallback — restore file to volume then serve it
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

        print(f"[PULID] face_url={face_url!r}")

        if face_url:
            from backend.routes.image_gen import _ws_submit_poll, _download_url, _save_bytes, IMAGE_DIR
            import datetime as _dt
            try:
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
            except Exception as _pulid_err:
                print(f"[PULID] WaveSpeed failed ({_pulid_err}), falling to plain gen")

    # ── Plain generation — cascade Venice → Novita → WaveSpeed ──────────────────
    from backend.routes.image_gen import _venice_generate_image, _novita_generate_image
    _plain_prompt = prompt
    _plain_providers = [
        ("Venice",     lambda: _venice_generate_image(_plain_prompt, "cinematic", "cinematic photorealistic")),
        ("Novita",     lambda: _novita_generate_image(_plain_prompt, "cinematic", "cinematic photorealistic", "novita_photo")),
        ("WaveSpeed",  lambda: _ws_generate_image(_plain_prompt, "widescreen", "cinematic photorealistic")),
    ]
    for _pname, _pfn in _plain_providers:
        try:
            result = await loop.run_in_executor(None, _pfn)
            print(f"[PLAIN] {_pname} succeeded")
            return result["imageUrl"]
        except Exception as _pe:
            print(f"[PLAIN] {_pname} failed ({_pe}), trying next")
    raise RuntimeError("All image providers failed — check credits on WaveSpeed, Venice, and Novita")


# ── Second character face-swap (two-character scenes) ─────────────────────────

async def _apply_char2_swap(image_url: str, character_id_2: str) -> str:
    """Face-swap a second character into an already-generated image. Returns original URL on any failure."""
    if not character_id_2 or not image_url:
        return image_url
    loop = asyncio.get_event_loop()

    from backend.db import characters_col
    db_char2 = None
    if characters_col is not None:
        doc2 = await characters_col.find_one({"id": character_id_2})
        db_char2 = {k: v for k, v in doc2.items() if k != "_id"} if doc2 else None
    else:
        data_file = Path("data/characters.json")
        if data_file.exists():
            chars = json.loads(data_file.read_text()).get("characters", [])
            db_char2 = next((c for c in chars if c.get("id") == character_id_2), None)

    refs2 = (db_char2 or {}).get("reference_images") or []
    face2_bytes = None

    if refs2:
        ref_path = Path(refs2[0].lstrip("/"))
        if ref_path.exists():
            face2_bytes = ref_path.read_bytes()
    if not face2_bytes:
        refs2_b64 = (db_char2 or {}).get("reference_images_b64") or []
        if refs2_b64:
            import base64 as _b64c2
            face2_bytes = _b64c2.b64decode(refs2_b64[0]["data"])

    if not face2_bytes:
        print(f"[CHAR2] no face ref for {character_id_2}, skipping swap")
        return image_url

    try:
        from backend.routes.image_gen import _ws_face_swap, IMAGE_DIR
        import base64 as _b64c2
        _b64str = _b64c2.b64encode(face2_bytes).decode()
        _ref2   = type("R", (), {"base64": _b64str, "mediaType": "image/jpeg"})()
        base_path = str(IMAGE_DIR / Path(image_url).name)
        _, swapped_url = await loop.run_in_executor(None, lambda: _ws_face_swap(base_path, _ref2))
        print(f"[CHAR2] face-swap applied for {character_id_2}")
        return swapped_url
    except Exception as _e:
        print(f"[CHAR2] face-swap failed ({_e}), keeping primary image")
        return image_url


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
    location_name  = payload.get("location_name", "")
    genre          = payload.get("genre", "")
    tone_notes     = payload.get("tone_notes", "")
    duration       = int(payload.get("duration", 5))
    model          = payload.get("model", "ws_wan22")
    include_tts    = payload.get("include_tts", True)
    project        = payload.get("project", char_name or "Default")
    keyframes_only = payload.get("keyframes_only", False)

    # Resolve location context for prompt injection
    _location_context = ""
    if location_name:
        try:
            from backend.routes.ai import get_location_context
            _location_context = await get_location_context(location_name)
        except Exception as _le:
            print(f"[ORCH] location context lookup failed: {_le}")

    # Look up both characters' appearances for prompt injection when face lock is unavailable
    async def _fetch_appearance(char_id: str) -> str:
        if not char_id:
            return ""
        try:
            from backend.db import characters_col as _cc
            if _cc is not None:
                doc = await _cc.find_one({"id": char_id})
            else:
                chars = json.loads(Path("data/characters.json").read_text()).get("characters", [])
                doc   = next((c for c in chars if c.get("id") == char_id), None)
            if doc:
                return " ".join(filter(None, [doc.get("appearance", ""), doc.get("wardrobe", "")]))
        except Exception:
            pass
        return ""

    char1_appearance, char2_appearance = await asyncio.gather(
        _fetch_appearance(character_id),
        _fetch_appearance(character2_id),
    )

    # Build name → character_id map from Character Lab (only chars with ref images)
    # This lets every shot resolve face lock by NAME, not by dropdown ID
    _char_name_map: dict[str, str] = {}  # lowercase name → character_id
    try:
        from backend.db import characters_col as _cmap_col
        if _cmap_col is not None:
            _all_chars = await _cmap_col.find({}).to_list(None)
        else:
            _all_chars = json.loads(Path("data/characters.json").read_text()).get("characters", [])
        for _c in _all_chars:
            _cname = (_c.get("name") or "").strip().lower()
            _has_ref = bool(_c.get("reference_images") or _c.get("reference_images_b64") or _c.get("preview_images"))
            if _cname and _has_ref:
                _char_name_map[_cname] = _c.get("id", "")
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
            _obedience = None  # Scene Obedience Lock score (set inside try)
            try:
                raw_prompt   = shot.get("image_prompt") or shot.get("shot_prompt") or shot.get("description") or concept

                # Wide/establishing shots have no single character subject — skip face lock
                _angle      = (shot.get("angle_type") or "").lower()
                _shot_char  = (shot.get("character") or "").lower()
                _is_env_shot = _angle in {"wide", "establishing"} or _shot_char in {"both", "environment", ""}

                if _is_env_shot:
                    shot_char_id = ""  # no face lock — environment / two-shot
                else:
                    prompt_lower    = raw_prompt.lower()
                    shot_char_field = _shot_char

                    # Resolve face lock by character NAME — match shot's character field
                    # against Character Lab entries that have ref images. Dropdown ID is fallback.
                    _resolved_id   = _char_name_map.get(shot_char_field.strip())
                    _resolved_cname = shot_char_field.strip()  # the name we matched on

                    if _resolved_id:
                        shot_char_id = _resolved_id
                        # Inject appearance using the matched character's cast slot
                        if _resolved_cname == char2_name.lower() and char2_appearance and char2_name.lower() not in prompt_lower:
                            raw_prompt = f"{char2_name}: {char2_appearance}. {raw_prompt}"
                        elif _resolved_cname == char_name.lower() and char1_appearance and char_name.lower() not in prompt_lower:
                            raw_prompt = f"{char_name}: {char1_appearance}. {raw_prompt}"
                    else:
                        # Fallback to dropdown IDs
                        _c2_match = char2_name and char2_name.lower() in (shot_char_field + " " + prompt_lower)
                        if _c2_match:
                            shot_char_id = character2_id
                            if char2_appearance and char2_name.lower() not in prompt_lower:
                                raw_prompt = f"{char2_name}: {char2_appearance}. {raw_prompt}"
                        else:
                            shot_char_id = character_id if shot.get("character_lock", True) else ""
                            if char1_appearance and char_name and char_name.lower() not in prompt_lower:
                                raw_prompt = f"{char_name}: {char1_appearance}. {raw_prompt}"

                # Detect second character from prompt text
                shot_char_id_2 = ""
                if shot_char_id:
                    _pl = raw_prompt.lower()
                    for _n2, _i2 in _char_name_map.items():
                        if _i2 != shot_char_id and _n2 in _pl:
                            shot_char_id_2 = _i2
                            break

                raw_prompt   = _sanitize_img(raw_prompt)
                image_prompt = _tone_prefix + raw_prompt if _tone_prefix else raw_prompt
                if _location_context:
                    image_prompt = image_prompt + f", {_location_context}"

                # Autonomous QC — retry up to 3 times on failure
                image_url = None
                _genre_lower = genre.lower() if genre else ""
                _comedy_words = {"comedy", "comedic", "skit", "sitcom", "parody", "spoof", "funny"}
                _is_comedy_run = bool(_comedy_words.intersection(_genre_lower.replace(",", " ").split()))
                _qc_suffixes = (
                    ["", ", photorealistic 8K warm natural lighting", ", high detail sharp focus bright"]
                    if _is_comedy_run else
                    ["", ", photorealistic cinematic 8K", ", high detail film still sharp focus"]
                )
                for _attempt, _suffix in enumerate(_qc_suffixes):
                    try:
                        image_url = await _gen_image(image_prompt + _suffix, shot_char_id)
                        break
                    except Exception as _e:
                        if _attempt == len(_qc_suffixes) - 1:
                            raise _e
                        _update(job_id, step=f"{label} ↻ Retry {_attempt+1} — {str(_e)[:60]}")

                # Two-character face-swap (if second char detected + WaveSpeed available)
                if shot_char_id_2 and image_url:
                    image_url = await _apply_char2_swap(image_url, shot_char_id_2)

                # ── Scene Obedience Lock — validate image against scene contract ──────
                _sol_contract = shot.get("scene_contract") or {}
                if not _sol_contract:
                    _sol_chars = [n for n in [char_name, char2_name] if n]
                    if _sol_chars or shot.get("required_action"):
                        _sol_contract = {
                            "required_chars":   _sol_chars,
                            "required_action":  shot.get("required_action") or (shot.get("description") or "")[:120],
                            "required_outcome": shot.get("required_outcome") or "",
                            "environment":      _location_context[:100] if _location_context else "",
                        }
                if _sol_contract and image_url:
                    from backend.routes.validate import validate_scene as _sol_fn
                    _sol_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
                    _sol_url    = (f"https://{_sol_domain}{image_url}"
                                   if _sol_domain and image_url.startswith("/") else image_url)
                    for _sol_i in range(3):
                        try:
                            _obedience = await _sol_fn(_sol_url, _sol_contract)
                        except Exception as _sol_err:
                            print(f"[SOL] validate error: {_sol_err}")
                            break
                        if _obedience.get("pass") or _obedience.get("error"):
                            break
                        if _sol_i < 2:
                            _sol_scores = (f"chars={_obedience.get('characters', 0):.0%} "
                                           f"action={_obedience.get('action', 0):.0%}")
                            _update(job_id, step=f"{label} ↻ Obedience FAIL ({_sol_scores}) — regen…")
                            _sol_reinforce = ""
                            if _obedience.get("action", 1.0) < 0.5:
                                _sol_ra = _sol_contract.get("required_action", "")
                                if _sol_ra:
                                    _sol_reinforce += f" CRITICAL: {_sol_ra}."
                            if _obedience.get("characters", 1.0) < 0.7:
                                _sol_rc = _sol_contract.get("required_chars", [])
                                if _sol_rc:
                                    _sol_reinforce += (f" MUST SHOW: "
                                                       f"{', '.join(_sol_rc) if isinstance(_sol_rc, list) else _sol_rc}.")
                            _sol_prompt = image_prompt + _sol_reinforce if _sol_reinforce else image_prompt
                            try:
                                image_url = await _gen_image(_sol_prompt, shot_char_id)
                                if shot_char_id_2 and image_url:
                                    image_url = await _apply_char2_swap(image_url, shot_char_id_2)
                                _sol_url = (f"https://{_sol_domain}{image_url}"
                                            if _sol_domain and image_url.startswith("/") else image_url)
                            except Exception as _sol_rge:
                                print(f"[SOL] regen failed: {_sol_rge}")
                                break

            except Exception as e:
                err_msg = f"Shot {i+1} keyframe failed after 3 attempts: {str(e)[:120]}"
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
                "id":              shot.get("shot_id") or str(uuid.uuid4()),
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
                "obedience_score": _obedience,
                "createdAt":       datetime.now().strftime("%Y-%m-%d %H:%M"),
            }

            # ── 6. Land in timeline immediately (live progress)
            await _append_to_timeline(shot_doc)
            _JOBS[job_id].setdefault("shots", []).append(shot_doc)
            mode_tag = "keyframe" if keyframes_only else ('animated' if video_url else 'keyframe only')
            _sol_tag = ""
            if _obedience and not _obedience.get("skipped") and not _obedience.get("error"):
                _sol_pct = int((_obedience.get("total") or 0) * 100)
                _sol_tag = f" · SOL {_sol_pct}% {'✔' if _obedience.get('pass') else '✗'}"
            _update(job_id,
                    step=f"{label} ✔ Shot {i+1} — {mode_tag}"
                         f"{', voiced' if audio_url else ''}{_sol_tag}")

        total_done = len(_JOBS[job_id].get("shots", []))
        if keyframes_only:
            _update(job_id, status="keyframes_ready", progress=len(shots),
                    step=f"✔ {total_done} keyframes ready — review and approve to animate")
        else:
            # ── 7. Auto-export: pick music + assemble final episode ────────────
            _update(job_id, status="exporting", progress=len(shots),
                    step=f"✔ {total_done} shots done — Assembling film…")
            episode_url = ""
            auto_music_url = ""
            try:
                # Pick first available music track from library
                try:
                    from backend.db import music_col as _mc
                    if _mc is not None:
                        _mtracks = await _mc.find({}).sort("createdAt", -1).to_list(5)
                        if _mtracks:
                            auto_music_url = _mtracks[0].get("url", "")
                    else:
                        _mpath = Path("data/music_library.json")
                        if _mpath.exists():
                            _mlib = json.loads(_mpath.read_text())
                            _tracks = _mlib if isinstance(_mlib, list) else _mlib.get("tracks", [])
                            if _tracks:
                                auto_music_url = _tracks[0].get("url", "")
                except Exception as _me:
                    print(f"[ORCH] music pick failed: {_me}")

                from backend.routes.video import ExportTimelinePayload, export_timeline
                _ep_result = await export_timeline(ExportTimelinePayload(
                    title=project or "LEVRAM_Film",
                    music_url=auto_music_url,
                    music_volume=0.20,
                    include_voice=True,
                    transition="fade",
                    color_grade="cinematic",
                ))
                episode_url = _ep_result.get("episodeUrl", "") if isinstance(_ep_result, dict) else ""
                _update(job_id, status="complete", progress=len(shots),
                        episode_url=episode_url, music_url=auto_music_url,
                        step=f"✔ Film ready — {total_done} shots · Open Timeline ↗")
            except Exception as _exp_err:
                print(f"[ORCH] auto-export failed: {_exp_err}")
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
