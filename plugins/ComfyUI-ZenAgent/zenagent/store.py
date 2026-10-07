"""Conversations, kept as one JSON file per thread under <user>/zenagent/threads, in the
OpenAI message format the model is sent (so tool calls and results replay exactly).

Only one turn runs per thread at a time (agent.busy_threads), so a save never races another
turn's; each write goes to its own temp file and replaces the thread atomically."""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone

try:
    import folder_paths
except Exception:  # pragma: no cover - outside ComfyUI
    folder_paths = None


def _dir() -> str:
    base = folder_paths.get_user_directory() if folder_paths else os.path.join(os.path.dirname(__file__), ".data")
    path = os.path.join(base, "zenagent", "threads")
    os.makedirs(path, exist_ok=True)
    return path


def _path(thread_id: str) -> str:
    safe = "".join(c for c in thread_id if c.isalnum() or c == "-")
    return os.path.join(_dir(), f"{safe}.json")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_thread(title: str) -> dict:
    stamp = now()
    return {"id": str(uuid.uuid4()), "title": title[:80] or "New chat", "created_at": stamp, "updated_at": stamp, "messages": []}


def load(thread_id: str) -> dict | None:
    try:
        with open(_path(thread_id), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save(thread: dict) -> None:
    thread["updated_at"] = now()
    path = _path(thread["id"])
    fd, tmp = tempfile.mkstemp(prefix=".thread-", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(thread, f)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def delete(thread_id: str) -> None:
    try:
        os.remove(_path(thread_id))
    except OSError:
        pass


def summaries() -> list[dict]:
    rows = []
    for name in os.listdir(_dir()):
        if not name.endswith(".json"):
            continue
        thread = load(name[:-5])
        if thread:
            rows.append({k: thread[k] for k in ("id", "title", "created_at", "updated_at")})
    return sorted(rows, key=lambda t: t["updated_at"], reverse=True)
