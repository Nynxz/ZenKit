"""comfyui-zeninspector — the ComfyUI debug/introspection panel.

Inspects the whole install, not just ZenKit. It joins four views of the same system:

  • /object_info      — every registered node, attributed to its pack by `python_module`
  • /extensions       — every JS file each pack serves to the frontend
  • the live page     — app.extensions + LiteGraph.registered_node_types + the open graph
  • /zeninspector/inspect (below) — disk truth: packs that FAILED to import, versions,
                        git refs, and declared-vs-effective node ownership

…and reports per pack whether it is actually, properly registered. ZenKit's own plugin
ledger (window.ZenKit.plugins) is folded in as one more layer, so a ZenKit plugin shows
its panels/apps/themes alongside its Python nodes.

Ships no nodes of its own.
"""


# Backend introspection: the only source for packs that failed to import (they contribute
# nothing to /object_info or /extensions, so the frontend can't see them at all).
try:
    from . import inspect_api  # noqa: F401
except Exception as e:  # pragma: no cover
    print(f"[ZenInspector] inspect route failed to load: {e}")

# Serve ./js (the built Vue bundle) as this extension's web directory.
from comfy_api.latest import ComfyExtension, io


class ZenInspectorExtension(ComfyExtension):
    """Ships no graph nodes — this pack is a frontend extension."""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []


async def comfy_entrypoint() -> ComfyExtension:
    return ZenInspectorExtension()

WEB_DIRECTORY = "./js"

print("[ZenInspector] loaded — the Zen Inspector panel registers client-side via ZenKit.")


__all__ = ["ZenInspectorExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
