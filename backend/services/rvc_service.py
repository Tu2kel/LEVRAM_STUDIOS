from pathlib import Path
import uuid

MODELS_DIR = Path("data/rvc_models")
MODELS_DIR.mkdir(parents=True, exist_ok=True)


def list_models() -> list:
    models = []
    for f in MODELS_DIR.glob("*.pth"):
        index = (MODELS_DIR / f.stem).with_suffix(".index")
        models.append({
            "name": f.stem,
            "model_path": str(f),
            "index_path": str(index) if index.exists() else None,
        })
    return models


def convert_voice(
    input_path: str,
    model_path: str,
    index_path: str = None,
    pitch_shift: int = 0,
    output_dir: Path = None,
) -> str:
    """Run RVC inference. Requires rvc-python to be installed."""
    try:
        from rvc_python.infer import RVCInference
    except ImportError:
        raise RuntimeError(
            "rvc-python is not installed in this environment. "
            "Install it manually or use ElevenLabs instead."
        )

    if output_dir is None:
        output_dir = Path("output/rvc")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = str(output_dir / f"rvc_{uuid.uuid4()}.wav")

    rvc = RVCInference(device="cuda:0")
    rvc.load_model(model_path, index_path=index_path or "")
    rvc.infer_file(input_path, output_path, f0_up_key=pitch_shift)

    return output_path
