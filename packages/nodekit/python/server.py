"""ComfyUI's HTTP server, for the pack's routes.

`routes` is ComfyUI's aiohttp route table, or None outside a running ComfyUI (tests, scripts), so
route modules guard on it. `route()` is the namespaced path, the Python twin of nodekit's
`route()`. A pack-local route module, listed under `python.routes` in pack.json, looks like:

    from ._zenkit.server import route, routes

    if routes is not None:

        @routes.get(route("studio/state"))
        async def studio_state(request): ...
"""

from __future__ import annotations

from typing import Any

from .identity import route

__all__ = ["prompt_server", "route", "routes", "send"]

try:
    from server import PromptServer

    prompt_server = PromptServer.instance
    routes = prompt_server.routes
except Exception:  # noqa: BLE001 - no server outside ComfyUI
    prompt_server = None
    routes = None


def send(event: str, payload: dict[str, Any], client_id: str | None = None) -> bool:
    """Send a websocket event to the browser (all tabs, or one `client_id`). False when there is
    no server or the send failed; a progress message is never worth failing the work over."""
    if prompt_server is None:
        return False
    try:
        prompt_server.send_sync(event, payload, client_id)
    except Exception:  # noqa: BLE001
        return False
    return True
