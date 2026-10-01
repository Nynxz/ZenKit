"""Serves the shared ZenKit runtime (vue.js, ui.js, client.js + chunks) at /zenkit/runtime/.

Zen plugins built with `sharedRuntime` import these instead of bundling their own copies,
so the page has one Vue and one @nynxz/zenkit-ui. They live outside WEB_DIRECTORY so ComfyUI
does not also auto-load them as extensions.
"""

from __future__ import annotations

import os

from aiohttp import web

try:
    from server import PromptServer

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    _routes = None
    print(f"[ZenKit] runtime route unavailable: {e}")

_RUNTIME_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runtime")


def _resolve(rel: str) -> str | None:
    path = os.path.realpath(os.path.join(_RUNTIME_DIR, rel))
    if not path.startswith(os.path.realpath(_RUNTIME_DIR) + os.sep):
        return None
    return path if os.path.isfile(path) and path.endswith(".js") else None


if _routes is not None:

    @_routes.get("/zenkit/runtime/{path:.+}")
    async def _runtime_file(request: web.Request) -> web.StreamResponse:
        path = _resolve(request.match_info["path"])
        if path is None:
            return web.Response(status=404)
        # Entry names are stable across builds; chunk names carry a content hash.
        immutable = os.sep + "chunks" + os.sep in path
        return web.FileResponse(
            path,
            headers={
                "Content-Type": "text/javascript",
                "Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache",
            },
        )
