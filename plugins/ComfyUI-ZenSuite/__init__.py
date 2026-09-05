"""comfyui-zensuite — the ZenKit core panel pack + the channel-bus nodes (V3).

Panels (Media Viewer, Asset Browser, Timer) register client-side via window.ZenKit
(requires ComfyUI-ZenKit, the runtime). This Python side ships:
  - "Zen Sync Image" — publishes an image to a ZenKit channel so the Media Viewer
    updates live;
  - "Zen Channel Preview" — the on-graph display twin;
  - the Asset Browser's HTTP routes.

Must not define NODE_CLASS_MAPPINGS: ComfyUI checks for it first and returns early, so
`comfy_entrypoint` would never run.
"""

from __future__ import annotations

from comfy_api.latest import ComfyExtension, io

from .channel_node import ZenSyncImage
from .preview_node import ZenChannelPreview

# Importing registers the Asset Browser's routes on PromptServer.
try:
    from . import assets_api  # noqa: F401
except Exception as e:  # noqa: BLE001 - optional; never block loading
    print(f"[ZenSuite] routes failed to load: {e}")


class ZenSuiteExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [ZenChannelPreview, ZenSyncImage]


async def comfy_entrypoint() -> ComfyExtension:
    return ZenSuiteExtension()


WEB_DIRECTORY = "./js"

print("[ZenSuite] loaded — panels register client-side via ZenKit.")

__all__ = ["ZenSuiteExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
