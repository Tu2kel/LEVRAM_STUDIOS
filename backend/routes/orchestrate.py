"""
LEVRAM Orchestrator — autonomous scene pipeline
Concept → GPT shot breakdown → Image Gen → I2V → TTS → Timeline
"""
import os
import uuid
import asyncio
import json
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks

router = APIRouter()

# In-memory job store (single-server Railway is fine)
_JOBS: dict = {}


def _update(job_id: str, **kw):
    if job_id in _JOBS:
        _JOBS[job_id].update(kw)


# ── GPT shot breakdown ────────────────────────────────────────

async def _plan_shots(concept: str, num_shots: int, character_name: str) -> list[dict]:
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    loop = asyncio.get_event_loop()

    system = (
        "You are a cinematic shot planner for LEVRAM Studios. "
        "Return ONLY valid JSON — a list of shot objects, no markdown, no commentary."
    )
    user = (
        f"Scene concept: {concept}\n"
        f"Character: {character_name or 'unnamed'}\n"
        f"Generate {num_shots} cinematic shots. Each shot is a JSON object with:\n"
        f"  description   – one sentence shot description\n"
        f"  image_prompt  – detailed image gen prompt (scene, outfit, lighting — NO face/skin descriptions)\n"
        f"  motion_prompt – single smooth continuous motion for I2V (NO 'then' chains)\n"
        f"  dialogue      – optional spoken line, empty string if none\n"
        f"Return a JSON array only."
    )

    def _call():
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system},
                      {"role": "user",   "content": user}],
            temperature=0.7,
            max_tokens=1200,
        )
        raw = resp.choices[0].message.content.strip()
        raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(raw)

    return await loop.run_in_executor(None, _call)


# ── Image generation ──────────────────────────────────────────

async def _gen_image(prompt: str, character_id: str) -> str:
    """Returns local /output/... URL."""
    import fal_client
    loop = asyncio.get_event_loop()

    api_key = os.getenv("FAL_KEY")
    if api_key:
        os.environ["FAL_KEY"] = api_key

    # Use flux-pulid if character has reference images, else plain flux
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

    lora_url    = (db_char or {}).get("lora_url") or ""
    lora_trigger= (db_char or {}).get("lora_trigger") or ""
    refs        = (db_char or {}).get("reference_images") or []

    if lora_url:
        full_prompt = f"{lora_trigger}, {prompt}" if lora_trigger else prompt
        result = await loop.run_in_executor(None, lambda: fal_client.run("fal-ai/flux-lora", arguments={
            "prompt":                full_prompt,
            "loras":                 [{"path": lora_url, "scale": 1.0}],
            "image_size":            "landscape_16_9",
            "num_inference_steps":   30,
            "guidance_scale":        3.5,
            "enable_safety_checker": False,
        }))
    elif refs:
        ref_path = next((Path(r.lstrip("/")) for r in refs if Path(r.lstrip("/")).exists()), None)
        if ref_path:
            face_url = await loop.run_in_executor(None, lambda: fal_client.upload(ref_path.read_bytes(), "image/jpeg"))
            result = await loop.run_in_executor(None, lambda: fal_client.run("fal-ai/flux-pulid", arguments={
                "reference_image_url": face_url,
                "prompt":              prompt,
                "image_size":          "landscape_16_9",
                "num_inference_steps": 28,
                "guidance_scale":      4.0,
                "id_weight":           1.0,
                "negative_prompt":     "cartoon, illustration, stylized, anime, unrealistic, back turned, rear view",
                "enable_safety_checker": False,
            }))
        else:
            result = await loop.run_in_executor(None, lambda: fal_client.run("fal-ai/flux/dev", arguments={
                "prompt":                prompt,
                "image_size":            "landscape_16_9",
                "num_inference_steps":   28,
                "guidance_scale":        3.5,
                "num_images":            1,
                "enable_safety_checker": False,
            }))
    else:
        result = await loop.run_in_executor(None, lambda: fal_client.run("fal-ai/flux/dev", arguments={
            "prompt":                prompt,
            "image_size":            "landscape_16_9",
            "num_inference_steps":   28,
            "guidance_scale":        3.5,
            "num_images":            1,
            "enable_safety_checker": False,
        }))

    imgs = result.get("images") or []
    remote_url = (imgs[0].get("url") if imgs else None) or result.get("image", {}).get("url") or result.get("url") or ""
    if not remote_url:
        raise RuntimeError(f"No image URL: {list(result.keys())}")

    import urllib.request
    out_dir  = Path("output/renders/images")
    out_dir.mkdir(parents=True, exist_ok=True)
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname    = f"orch_{ts}_{uuid.uuid4().hex[:6]}.jpg"
    req      = urllib.request.Request(remote_url, headers={"User-Agent": "LEVRAM/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        (out_dir / fname).write_bytes(r.read())
    return "/output/renders/images/" + fname


# ── I2V animation ─────────────────────────────────────────────

async def _animate(image_url: str, motion_prompt: str, model: str, duration: int) -> str:
    """Returns local /output/videos/... URL."""
    from backend.routes.video import _fal_image_to_video
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: _fal_image_to_video(image_url, motion_prompt, model, duration))
    return result.get("local_url") or result.get("cdn_url") or ""


# ── TTS ───────────────────────────────────────────────────────

async def _gen_tts(text: str, character_id: str) -> str:
    from backend.routes.tts import tts_generate
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, lambda: tts_generate(text, character_id))
    return result.get("audio_url") or result.get("url") or ""


# ── Timeline save ─────────────────────────────────────────────

async def _save_to_timeline(new_shots: list[dict]):
    tl_file = Path("data/timelines/main_timeline.json")
    tl_file.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(tl_file.read_text()).get("shots", []) if tl_file.exists() else []
    all_shots = existing + new_shots
    for i, s in enumerate(all_shots, 1):
        s["shot_number"] = f"SC-{i:03d}"
    tl_file.write_text(json.dumps({"shots": all_shots}, indent=2))


# ── Main pipeline ─────────────────────────────────────────────

async def _run_pipeline(job_id: str, payload: dict):
    concept      = payload.get("concept", "")
    character_id = payload.get("character_id", "")
    char_name    = payload.get("character_name", "")
    num_shots    = min(max(int(payload.get("num_shots", 3)), 1), 5)
    duration     = int(payload.get("duration", 5))
    model        = payload.get("model", "wan21_i2v")
    include_tts  = payload.get("include_tts", False)

    try:
        # ── 1. Plan shots
        _update(job_id, status="planning", step="Breaking concept into shots…")
        shots = await _plan_shots(concept, num_shots, char_name)
        _update(job_id, total=len(shots))

        timeline_shots = []

        for i, shot in enumerate(shots):
            label = f"Shot {i+1}/{len(shots)}"

            # ── 2. Generate image
            _update(job_id, progress=i, step=f"{label}: Generating keyframe image…")
            image_url = await _gen_image(shot.get("image_prompt", concept), character_id)
            _JOBS[job_id].setdefault("generated_images", []).append(image_url)

            # ── 3. Animate
            _update(job_id, step=f"{label}: Animating keyframe ({model})…")
            video_url = await _animate(image_url, shot.get("motion_prompt", "cinematic motion"), model, duration)

            # ── 4. TTS
            audio_url = ""
            if include_tts and shot.get("dialogue") and character_id:
                _update(job_id, step=f"{label}: Generating voice…")
                try:
                    audio_url = await _gen_tts(shot["dialogue"], character_id)
                except Exception:
                    pass

            timeline_shots.append({
                "id":               str(uuid.uuid4()),
                "name":             f"Shot {i+1}: {shot.get('description','')[:40]}",
                "description":      shot.get("description", ""),
                "type":             "video",
                "videoUrl":         video_url,
                "renderOutputUrl":  video_url,
                "renderOutputPath": video_url,
                "imageUrl":         image_url,
                "audioUrl":         audio_url,
                "source":           "orchestrator",
            })

        # ── 5. Save to Timeline
        _update(job_id, step="Saving all clips to Timeline…")
        await _save_to_timeline(timeline_shots)

        _update(job_id,
            status="complete",
            progress=len(shots),
            shots=timeline_shots,
            step=f"Done — {len(shots)} clips added to Timeline")

    except Exception as e:
        _update(job_id, status="failed", error=str(e)[:400], step=f"Failed: {str(e)[:120]}")


# ── Routes ────────────────────────────────────────────────────

@router.post("/orchestrate/run")
async def run_orchestration(payload: dict, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    _JOBS[job_id] = {
        "status":   "starting",
        "progress": 0,
        "total":    0,
        "step":     "Starting…",
        "shots":    [],
        "error":    None,
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
    return {"jobs": [{"job_id": k, **{kk: v for kk, v in j.items() if kk != "shots"}}
                     for k, j in _JOBS.items()]}
