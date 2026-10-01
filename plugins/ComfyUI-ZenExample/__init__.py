"""comfyui-zenexample — a reference ZenKit plugin.

Each feature it shows off is one panel registered client-side through ZenKit. Ships no nodes.
"""

try:
    from . import jobs_api  # noqa: F401  (registers the Job Lab's routes)
except Exception as e:  # pragma: no cover
    print(f"[ZenExample] routes failed to load: {e}")

from comfy_api.latest import ComfyExtension, io


class ZenExampleExtension(ComfyExtension):
    """Ships no graph nodes — this pack is a frontend extension."""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []


async def comfy_entrypoint() -> ComfyExtension:
    return ZenExampleExtension()


WEB_DIRECTORY = "./js"

__all__ = ["ZenExampleExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
