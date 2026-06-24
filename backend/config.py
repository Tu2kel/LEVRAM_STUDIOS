import os

# Venice creative writing model.
# Swap via Railway env var VENICE_CREATIVE_MODEL without touching code.
# Good options: dolphin-2.9.2-qwen2-72b  |  dolphin-mixtral-8x22b  |  hermes-3-llama-3.1-405b
VENICE_CREATIVE_MODEL = os.getenv("VENICE_CREATIVE_MODEL", "dolphin-2.9.2-qwen2-72b")
