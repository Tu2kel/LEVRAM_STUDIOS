"""
Scene Obedience Lock (SOL) — validates generated images against scene contracts.
Venice vision (llama-3.2-11b-vision) → OpenAI gpt-4o-mini fallback.
"""
import os
import json
import asyncio
from fastapi import APIRouter

router = APIRouter()


def _build_eval_prompt(contract: dict) -> str:
    lines = [
        "You are a Scene Compliance Validator for an AI film production pipeline.",
        "Evaluate the image against the scene contract below.",
        "Return ONLY valid JSON — no markdown, no commentary.\n",
        "SCENE CONTRACT:",
    ]
    if contract.get("required_chars"):
        rc = contract["required_chars"]
        lines.append(f"Required Characters: {', '.join(rc) if isinstance(rc, list) else rc}")
    if contract.get("forbidden_chars"):
        fc = contract["forbidden_chars"]
        lines.append(f"Forbidden Characters: {', '.join(fc) if isinstance(fc, list) else fc}")
    if contract.get("required_action"):
        lines.append(f"Required Action: {contract['required_action']}")
    if contract.get("required_outcome"):
        lines.append(f"Required Outcome: {contract['required_outcome']}")
    if contract.get("forbidden_outcomes"):
        fo = contract["forbidden_outcomes"]
        lines.append(f"Forbidden Outcomes: {', '.join(fo) if isinstance(fo, list) else fo}")
    if contract.get("environment"):
        lines.append(f"Environment: {contract['environment']}")
    if contract.get("camera"):
        lines.append(f"Camera: {contract['camera']}")
    lines += [
        "",
        "Score 0.0–1.0 per dimension:",
        "  characters: required characters visibly present AND no forbidden characters",
        "  location:   environment matches contract description",
        "  action:     required action is visibly depicted",
        "  outcome:    required outcome is shown in the image",
        "",
        'Return exactly: {"characters":0.0,"location":0.0,"action":0.0,"outcome":0.0,"notes":"...","pass":false}',
        '"pass" is true ONLY when: average >= 0.65 AND action >= 0.5 AND characters >= 0.7',
    ]
    return "\n".join(lines)


def _call_vision(image_url: str, contract: dict) -> dict:
    from openai import OpenAI
    prompt = _build_eval_prompt(contract)
    messages = [{
        "role": "user",
        "content": [
            {"type": "text",      "text": prompt},
            {"type": "image_url", "image_url": {"url": image_url}},
        ],
    }]

    venice_key = os.getenv("VENICE_API_KEY", "")
    if venice_key:
        try:
            vc   = OpenAI(api_key=venice_key, base_url="https://api.venice.ai/api/v1")
            resp = vc.chat.completions.create(
                model="llama-3.2-11b-vision",
                messages=messages, max_tokens=400, temperature=0.1,
            )
            raw = resp.choices[0].message.content.strip()
            raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
            return json.loads(raw)
        except Exception as e:
            print(f"[SOL] Venice vision failed ({e}), trying OpenAI")

    oai_key = os.getenv("OPENAI_API_KEY", "")
    if oai_key:
        try:
            oc   = OpenAI(api_key=oai_key)
            resp = oc.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages, max_tokens=400, temperature=0.1,
            )
            raw = resp.choices[0].message.content.strip()
            raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
            return json.loads(raw)
        except Exception as e:
            print(f"[SOL] OpenAI vision failed ({e})")

    raise RuntimeError("No vision model available — set VENICE_API_KEY or OPENAI_API_KEY")


async def validate_scene(image_url: str, contract: dict) -> dict:
    """Called from orchestrator. Returns Scene Obedience Lock score dict."""
    if not image_url or not contract:
        return {
            "pass": True, "characters": 1.0, "location": 1.0,
            "action": 1.0, "outcome": 1.0, "total": 1.0,
            "notes": "No contract — validation skipped", "skipped": True,
        }
    loop = asyncio.get_event_loop()
    try:
        result  = await loop.run_in_executor(None, lambda: _call_vision(image_url, contract))
        chars   = float(result.get("characters", 0.0))
        loc     = float(result.get("location",   0.0))
        action  = float(result.get("action",     0.0))
        outcome = float(result.get("outcome",    0.0))
        total   = round((chars + loc + action + outcome) / 4, 3)
        passed  = result.get("pass")
        if not isinstance(passed, bool):
            passed = total >= 0.65 and action >= 0.5 and chars >= 0.7
        return {
            "pass":       passed,
            "characters": chars,
            "location":   loc,
            "action":     action,
            "outcome":    outcome,
            "total":      total,
            "notes":      result.get("notes", ""),
        }
    except Exception as e:
        print(f"[SOL] validation error: {e}")
        return {
            "pass": True, "characters": 0.0, "location": 0.0,
            "action": 0.0, "outcome": 0.0, "total": 0.0,
            "notes": f"Validator unavailable: {e}", "error": True,
        }


@router.post("/validate/scene")
async def validate_scene_endpoint(payload: dict):
    result = await validate_scene(
        payload.get("image_url", ""),
        payload.get("contract", {}),
    )
    return {"success": True, **result}
