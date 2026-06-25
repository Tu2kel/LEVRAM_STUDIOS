import os

# Venice creative writing model — swap via Railway env var without touching code.
# Confirmed working: hermes-3-llama-3.1-405b
# To try a new model: set VENICE_CREATIVE_MODEL in Railway env vars
VENICE_CREATIVE_MODEL = os.getenv("VENICE_CREATIVE_MODEL", "hermes-3-llama-3.1-405b")
