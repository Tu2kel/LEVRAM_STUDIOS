"""
LEVRAM Studios — MongoDB connection layer.

If MONGODB_URL is set in the environment, all studio data is stored in MongoDB
(characters, projects, episodes, scenes, ideas, render queue, music library).

If MONGODB_URL is not set, every route falls back to local JSON files — the
existing behaviour — so local dev still works with zero setup.
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient

MONGODB_URL: str | None = os.getenv("MONGODB_URL")
DB_NAME = os.getenv("MONGODB_DB", "levram_studios")

_client: AsyncIOMotorClient | None = None
db = None  # assigned below when URL is present


def get_db():
    """Return the Motor database object, or None if MongoDB is not configured."""
    return db


async def ping_db() -> bool:
    """Return True if MongoDB is reachable, False otherwise."""
    if db is None:
        return False
    try:
        await _client.admin.command("ping")
        return True
    except Exception:
        return False


if MONGODB_URL:
    _client = AsyncIOMotorClient(MONGODB_URL, serverSelectionTimeoutMS=5000)
    db = _client[DB_NAME]

    # Convenience collection handles — import these in route files
    characters_col  = db["characters"]
    scenes_col       = db["scenes"]
    ideas_col        = db["ideas"]
    projects_col     = db["projects"]
    episodes_col     = db["episodes"]
    render_queue_col = db["render_queue"]
    music_col        = db["music_library"]
    asset_tags_col   = db["asset_tags"]
else:
    # Stub objects so import statements don't break
    characters_col = scenes_col = ideas_col = projects_col = None
    episodes_col = render_queue_col = music_col = asset_tags_col = None
