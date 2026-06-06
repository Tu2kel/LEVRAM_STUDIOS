"""
LEVRAM Studios — MongoDB migration utility
Run once to import existing local JSON data into MongoDB.

Usage:
  MONGODB_URL="mongodb+srv://..." python migrate_to_mongodb.py

Collections migrated:
  characters, ideas, projects, scenes, episodes, render_queue, music_library
"""
import asyncio
import json
import os
import sys
from pathlib import Path

try:
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:
    print("motor not installed — pip install motor")
    sys.exit(1)

MONGODB_URL = os.getenv("MONGODB_URL")
DB_NAME     = os.getenv("MONGODB_DB", "levram_studios")

if not MONGODB_URL:
    print("MONGODB_URL env var not set.")
    sys.exit(1)


async def migrate():
    client = AsyncIOMotorClient(MONGODB_URL, serverSelectionTimeoutMS=8000)
    db = client[DB_NAME]

    total = 0

    # ── Characters ────────────────────────────────────────────
    chars_file = Path("data/characters.json")
    if chars_file.exists():
        data = json.loads(chars_file.read_text())
        chars = data.get("characters", []) if isinstance(data, dict) else []
        if chars:
            col = db["characters"]
            for c in chars:
                await col.update_one({"id": c["id"]}, {"$setOnInsert": c}, upsert=True)
            print(f"  characters   : {len(chars)} documents")
            total += len(chars)

    # ── Ideas ─────────────────────────────────────────────────
    ideas_file = Path("data/ideas.json")
    if ideas_file.exists():
        data = json.loads(ideas_file.read_text())
        ideas = data.get("ideas", []) if isinstance(data, dict) else []
        if ideas:
            col = db["ideas"]
            for i in ideas:
                await col.update_one({"id": i["id"]}, {"$setOnInsert": i}, upsert=True)
            print(f"  ideas        : {len(ideas)} documents")
            total += len(ideas)

    # ── Projects ──────────────────────────────────────────────
    projects_dir = Path("data/projects")
    if projects_dir.exists():
        project_files = list(projects_dir.glob("*.json"))
        col = db["projects"]
        for f in project_files:
            try:
                p = json.loads(f.read_text())
                await col.update_one({"id": p["id"]}, {"$setOnInsert": p}, upsert=True)
            except Exception as e:
                print(f"    skip {f.name}: {e}")
        print(f"  projects     : {len(project_files)} documents")
        total += len(project_files)

    # ── Scenes ────────────────────────────────────────────────
    scenes_dir = Path("data/scenes")
    if scenes_dir.exists():
        scene_files = list(scenes_dir.glob("*.json"))
        col = db["scenes"]
        for f in scene_files:
            try:
                s = json.loads(f.read_text())
                if "id" in s:
                    await col.update_one({"id": s["id"]}, {"$setOnInsert": s}, upsert=True)
            except Exception as e:
                print(f"    skip {f.name}: {e}")
        print(f"  scenes       : {len(scene_files)} documents")
        total += len(scene_files)

    # ── Episodes ──────────────────────────────────────────────
    episodes_dir = Path("data/episodes")
    if episodes_dir.exists():
        ep_files = list(episodes_dir.glob("*.json"))
        col = db["episodes"]
        for f in ep_files:
            try:
                ep = json.loads(f.read_text())
                await col.update_one({"id": ep["id"]}, {"$setOnInsert": ep}, upsert=True)
            except Exception as e:
                print(f"    skip {f.name}: {e}")
        print(f"  episodes     : {len(ep_files)} documents")
        total += len(ep_files)

    # ── Render queue ──────────────────────────────────────────
    queue_file = Path("data/render_queue.json")
    if queue_file.exists():
        data = json.loads(queue_file.read_text())
        queue = data.get("queue", [])
        if queue:
            col = db["render_queue"]
            for item in queue:
                await col.update_one({"id": item["id"]}, {"$setOnInsert": item}, upsert=True)
            print(f"  render_queue : {len(queue)} documents")
            total += len(queue)

    # ── Music library ─────────────────────────────────────────
    music_file = Path("data/music_library.json")
    if music_file.exists():
        tracks = json.loads(music_file.read_text())
        if isinstance(tracks, list) and tracks:
            col = db["music_library"]
            for t in tracks:
                await col.update_one({"id": t["id"]}, {"$setOnInsert": t}, upsert=True)
            print(f"  music_library: {len(tracks)} documents")
            total += len(tracks)

    client.close()
    print(f"\nDone. {total} total documents upserted into '{DB_NAME}'.")


if __name__ == "__main__":
    print(f"Migrating to MongoDB: {DB_NAME}")
    asyncio.run(migrate())
