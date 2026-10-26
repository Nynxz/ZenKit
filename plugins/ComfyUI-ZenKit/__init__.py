"""comfyui-zenkit — the ZenKit runtime for ComfyUI.

Serves the built frontend (js/main.js), which ComfyUI loads into the page; that script installs
window.ZenKit, the theme system, the bottom taskbar and the built-in panels. The nodes are the
channel nodes those panels show (suite/).
"""

import os


# Runtime theme discovery: scans themes/ on disk and serves it at /zenkit/themes, so
# themes are loaded on reload with no rebuild (importing registers the route).
try:
    from . import zenkit_themes_api  # noqa: F401
except Exception as e:  # pragma: no cover
    print(f"[ZenKit] theme route failed to load: {e}")

# The shared vue/ui/client modules other Zen plugins import from /zenkit/runtime/.
try:
    from . import zenkit_runtime_api  # noqa: F401
except Exception as e:  # pragma: no cover
    print(f"[ZenKit] runtime route failed to load: {e}")

# Cached thumbnails for input/output/temp files at /zenkit/thumb (client: zenThumbUrl).
try:
    from . import zenkit_thumb_api  # noqa: F401
except Exception as e:  # pragma: no cover
    print(f"[ZenKit] thumbnail route failed to load: {e}")

from comfy_api.latest import ComfyExtension, io

# A ComfyUI-ZenSuite still installed from before it became part of ZenKit registers the same
# nodes and routes itself.
_HERE = os.path.dirname(os.path.abspath(__file__))
_STANDALONE_SUITE = any(
    name.lower() == "comfyui-zensuite"
    and os.path.isfile(os.path.join(os.path.dirname(_HERE), name, "__init__.py"))
    for name in os.listdir(os.path.dirname(_HERE))
)
if _STANDALONE_SUITE:
    print("[ZenKit] ComfyUI-ZenSuite is now part of ZenKit; remove it from custom_nodes.")
    _SUITE_NODES = []
else:
    try:
        from .suite import NODES as _SUITE_NODES
        from .suite import assets_api  # noqa: F401
    except Exception as e:  # noqa: BLE001 - optional; never block loading
        print(f"[ZenKit] built-in panels' nodes and routes failed to load: {e}")
        _SUITE_NODES = []
    # The Memory panel's routes (suite/memory_api.py): its snapshots and per-model unload.
    try:
        from .suite import memory_api  # noqa: F401
    except Exception as e:  # noqa: BLE001 - optional; never block loading
        print(f"[ZenKit] memory route failed to load: {e}")


class ZenKitExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return list(_SUITE_NODES)


async def comfy_entrypoint() -> ComfyExtension:
    return ZenKitExtension()

WEB_DIRECTORY = "./js"

print("[ZenKit] loaded — serving window.ZenKit.")

__all__ = ["ZenKitExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
