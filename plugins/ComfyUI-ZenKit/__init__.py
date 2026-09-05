"""comfyui-zenkit — the ZenKit runtime for ComfyUI.

Ships no nodes. It only serves the built frontend (js/main.js), which ComfyUI
loads into the page; that script installs window.ZenKit, the theme system, and
the bottom taskbar.
"""


# Runtime theme discovery: scans themes/ on disk and serves it at /zenkit/themes, so
# themes are loaded on reload with no rebuild (importing registers the route).
try:
    from . import zenkit_themes_api  # noqa: F401
except Exception as e:  # pragma: no cover
    print(f"[ZenKit] theme route failed to load: {e}")

# Serve ./js (the built Vue bundle) as this extension's web directory.
from comfy_api.latest import ComfyExtension, io


class ZenKitExtension(ComfyExtension):
    """Ships no graph nodes — this pack is a frontend extension."""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []


async def comfy_entrypoint() -> ComfyExtension:
    return ZenKitExtension()

WEB_DIRECTORY = "./js"

print("[ZenKit] frontend extension loaded — serving window.ZenKit. Ships no nodes.")

__all__ = ["ZenKitExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
