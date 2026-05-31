from pathlib import Path
from datetime import datetime
import json
import time
import uuid
import urllib.request
import urllib.parse

COMFY_URL = "http://127.0.0.1:8188"
IMAGE_DIR = Path("output/renders/images")
CHECKPOINT = "realisticVisionV60B1_v51HyperVAE.safetensors"


def _post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def _get_json(url):
    with urllib.request.urlopen(url, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def _download_image(filename, subfolder="", folder_type="output"):
    query = urllib.parse.urlencode({
        "filename": filename,
        "subfolder": subfolder,
        "type": folder_type,
    })

    url = f"{COMFY_URL}/view?{query}"

    with urllib.request.urlopen(url, timeout=60) as res:
        return res.read()


def _build_workflow(prompt):
    return {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": int(time.time()),
                "steps": 20,
                "cfg": 7,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": CHECKPOINT,
            },
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": 768,
                "height": 512,
                "batch_size": 1,
            },
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["4", 1],
            },
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "blurry, low quality, distorted, bad anatomy, extra fingers, watermark, text",
                "clip": ["4", 1],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2],
            },
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "levram_keyframe",
                "images": ["8", 0],
            },
        },
    }


def generate_comfy_keyframe(queue_item: dict):
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    shot = queue_item.get("shot") or {}

    prompt = (
        shot.get("shotPrompt")
        or shot.get("prompt")
        or shot.get("shotDesc")
        or shot.get("description")
        or queue_item.get("dialogue")
        or "cinematic portrait, dramatic lighting"
    )

    workflow = _build_workflow(prompt)

    client_id = str(uuid.uuid4())

    submitted = _post_json(
        f"{COMFY_URL}/prompt",
        {
            "prompt": workflow,
            "client_id": client_id,
        },
    )

    prompt_id = submitted.get("prompt_id")

    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {submitted}")

    history = None

    for _ in range(120):
        all_history = _get_json(f"{COMFY_URL}/history/{prompt_id}")

        if prompt_id in all_history:
            history = all_history[prompt_id]
            break

        time.sleep(1)

    if not history:
        raise RuntimeError("ComfyUI render timed out.")

    outputs = history.get("outputs", {})

    image_info = None

    for node_output in outputs.values():
        images = node_output.get("images", [])
        if images:
            image_info = images[0]
            break

    if not image_info:
        raise RuntimeError(f"No image returned from ComfyUI history: {history}")

    image_bytes = _download_image(
        image_info["filename"],
        image_info.get("subfolder", ""),
        image_info.get("type", "output"),
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    render_id = str(uuid.uuid4())

    filename = f"{queue_item.get('shotId') or 'shot'}_{timestamp}_{render_id[:8]}.png"
    output_path = IMAGE_DIR / filename

    with output_path.open("wb") as f:
        f.write(image_bytes)

    return {
        "renderId": render_id,
        "outputPath": str(output_path),
        "outputUrl": "/" + str(output_path),
        "prompt": prompt,
        "comfyPromptId": prompt_id,
    }
