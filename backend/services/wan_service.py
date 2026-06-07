"""
Wan2.1 T2V 1.3B video generation via ComfyUI WanVideoWrapper nodes.
Requires ComfyUI running at COMFY_URL with WanVideoWrapper + VideoHelperSuite installed.
"""
import json
import time
import uuid
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

import os
COMFY_URL = os.getenv("COMFY_URL", "http://127.0.0.1:8188")
VIDEO_DIR = Path("output/videos")

# Paths relative to ComfyUI's model directories (as ComfyUI expects them)
WAN_MODEL    = "wan2.1_t2v_1.3B_fp16.safetensors"
WAN_VAE      = "wan_2.1_vae.safetensors"
WAN_T5       = "Wan2.1-T2V-1.3B/models_t5_umt5-xxl-enc-bf16.pth"

# Resolution presets for 1.3B (must be multiples of 8, within ~832x480 area)
WAN_RESOLUTIONS = {
    "widescreen": (832, 480),
    "portrait":   (480, 832),
    "square":     (624, 624),
}

# ~5s at 16fps = 81 frames (must satisfy (n-1) % 4 == 0)
DEFAULT_FRAMES = 81
DEFAULT_FPS    = 16


def _post_json(url, payload):
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _get_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def _download(filename, subfolder="", folder_type="output"):
    q   = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": folder_type})
    url = f"{COMFY_URL}/view?{q}"
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def _build_workflow(prompt: str, negative: str, width: int, height: int, num_frames: int, seed: int, steps: int, cfg: float) -> dict:
    return {
        "1": {
            "class_type": "WanVideoModelLoader",
            "inputs": {
                "model": WAN_MODEL,
                "base_precision": "fp16",
                "quantization": "disabled",
                "load_device": "main_device",
                "attention_mode": "sdpa",
            }
        },
        "2": {
            "class_type": "WanVideoVAELoader",
            "inputs": {
                "model_name": WAN_VAE,
                "precision": "bf16",
            }
        },
        "3": {
            "class_type": "LoadWanVideoT5TextEncoder",
            "inputs": {
                "model_name": WAN_T5,
                "precision": "bf16",
                "load_device": "offload_device",
            }
        },
        "4": {
            "class_type": "WanVideoTextEncode",
            "inputs": {
                "positive_prompt": prompt,
                "negative_prompt": negative,
                "force_offload": True,
                "t5": ["3", 0],
            }
        },
        "5": {
            "class_type": "WanVideoEmptyEmbeds",
            "inputs": {
                "width": width,
                "height": height,
                "num_frames": num_frames,
                "noise_aug_strength": 0.0,
                "start_latent_strength": 1.0,
                "end_latent_strength": 1.0,
                "force_offload": True,
                "vae": ["2", 0],
            }
        },
        "6": {
            "class_type": "WanVideoSampler",
            "inputs": {
                "model": ["1", 0],
                "image_embeds": ["5", 0],
                "text_embeds": ["4", 0],
                "steps": steps,
                "cfg": cfg,
                "shift": 5.0,
                "seed": seed,
                "force_offload": True,
                "scheduler": "unipc",
                "riflex_freq_index": 0,
            }
        },
        "7": {
            "class_type": "WanVideoDecode",
            "inputs": {
                "vae": ["2", 0],
                "samples": ["6", 0],
                "enable_vae_tiling": True,
                "tile_sample_min_height": 272,
                "tile_sample_min_width": 272,
                "tile_overlap_factor_height": 0.2,
                "tile_overlap_factor_width": 0.2,
                "auto_tile_size": True,
            }
        },
        "8": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["7", 0],
                "frame_rate": DEFAULT_FPS,
                "loop_count": 0,
                "filename_prefix": "levram_wan",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            }
        },
    }


def generate_wan_t2v(
    prompt: str,
    character: str = "",
    aspect: str = "widescreen",
    steps: int = 25,
    cfg: float = 6.0,
    seed: int | None = None,
    negative: str = "blurry, low quality, distorted, watermark, text overlay, bad anatomy",
) -> dict:
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)

    if seed is None:
        seed = int(uuid.uuid4().int % (2**32))

    w, h = WAN_RESOLUTIONS.get(aspect, (832, 480))

    # Build full prompt with character context
    full_prompt = f"{character}, {prompt}".strip(", ") if character else prompt

    workflow  = _build_workflow(full_prompt, negative, w, h, DEFAULT_FRAMES, seed, steps, cfg)
    client_id = str(uuid.uuid4())

    submitted = _post_json(f"{COMFY_URL}/prompt", {"prompt": workflow, "client_id": client_id})
    prompt_id = submitted.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {submitted}")

    # Poll for completion (Wan2.1 1.3B can take 3-10 minutes on RTX 3060-3070)
    for _ in range(720):   # 12-minute timeout
        all_history = _get_json(f"{COMFY_URL}/history/{prompt_id}")
        if prompt_id in all_history:
            history = all_history[prompt_id]
            break
        time.sleep(1)
    else:
        raise RuntimeError("Wan2.1 render timed out (>12 min). Try fewer steps or smaller resolution.")

    # Find video file in outputs
    outputs    = history.get("outputs", {})
    video_info = None
    for node_output in outputs.values():
        # VHS_VideoCombine stores under "videos" key
        for key in ("videos", "gifs", "images"):
            files = node_output.get(key, [])
            if files:
                video_info = files[0]
                break
        if video_info:
            break

    if not video_info:
        raise RuntimeError(f"No video in ComfyUI output: {list(outputs.keys())}")

    video_bytes = _download(
        video_info["filename"],
        video_info.get("subfolder", ""),
        video_info.get("type", "output"),
    )

    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    rid      = uuid.uuid4().hex[:8]
    filename = f"wan_{ts}_{rid}.mp4"
    out_path = VIDEO_DIR / filename
    out_path.write_bytes(video_bytes)

    return {
        "outputPath": str(out_path),
        "outputUrl":  "/output/videos/" + filename,
        "prompt":     full_prompt,
        "seed":       seed,
        "frames":     DEFAULT_FRAMES,
        "fps":        DEFAULT_FPS,
    }
