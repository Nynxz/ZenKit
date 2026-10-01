"""Server-side test jobs for the Job Lab panel.

POST /zenexample/jobs/{kind} starts a background task that reports progress with the
`zenkit.job` websocket event, the protocol ZenKit's Jobs widget listens for. Each event
carries the job's full state, so a client that connects mid-job still sees it correctly:

    {"id", "name", "status": "start" | "progress" | "done" | "error",
     "current", "total" (0 = indeterminate), "message", "source"}
"""

from __future__ import annotations

import asyncio
import itertools
import random

from aiohttp import web

try:
    from server import PromptServer

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    PromptServer = None
    _routes = None
    print(f"[ZenExample] job routes unavailable: {e}")

SOURCE = "Zen Example"
_ids = itertools.count(1)
_running: set[asyncio.Task] = set()


def emit(job_id: str, name: str, status: str, current: int = 0, total: int = 0, message: str = "") -> None:
    PromptServer.instance.send_sync(
        "zenkit.job",
        {
            "id": job_id,
            "name": name,
            "status": status,
            "current": current,
            "total": total,
            "message": message,
            "source": SOURCE,
        },
    )


async def counted(name: str, total: int, delay: float, fail_at: int | None = None) -> None:
    job_id = f"zenexample:{next(_ids)}"
    emit(job_id, name, "start", 0, total)
    for step in range(1, total + 1):
        await asyncio.sleep(delay)
        if step == fail_at:
            emit(job_id, name, "error", step, total, f"Simulated failure at step {step}")
            return
        emit(job_id, name, "progress", step, total, f"Step {step} of {total}")
    emit(job_id, name, "done", total, total)


async def open_ended(name: str, seconds: int) -> None:
    job_id = f"zenexample:{next(_ids)}"
    emit(job_id, name, "start", message="Starting…")
    for second in range(1, seconds + 1):
        await asyncio.sleep(1)
        emit(job_id, name, "progress", message=f"Working… {second}s")
    emit(job_id, name, "done")


KINDS = {
    "counted": lambda: [counted("Render frames", 20, 0.25)],
    "open": lambda: [open_ended("Warm model cache", 6)],
    "fail": lambda: [counted("Export batch", 12, 0.3, fail_at=7)],
    "burst": lambda: [counted(f"Tile {n}", random.randint(6, 14), 0.2) for n in range(1, 5)],
}

if _routes is not None:

    @_routes.post("/zenexample/jobs/{kind}")
    async def _start(request: web.Request) -> web.Response:
        make = KINDS.get(request.match_info["kind"])
        if make is None:
            return web.json_response({"error": "unknown kind", "kinds": list(KINDS)}, status=404)
        for job in make():
            task = asyncio.get_running_loop().create_task(job)
            _running.add(task)
            task.add_done_callback(_running.discard)
        return web.json_response({"started": request.match_info["kind"]})
