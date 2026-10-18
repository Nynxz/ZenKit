"""comfyui-zenintegrations — ZenKit adapters for other node packs.

Each adapter checks, client-side, whether its target pack is installed and only then adds
that pack's ZenKit surfaces (panels, jobs, …). The target packs stay unmodified: adapters use
only what those packs already serve over HTTP and websockets.

Ships no nodes.
"""

from comfy_api.latest import ComfyExtension, io


class ZenIntegrationsExtension(ComfyExtension):
    """Ships no graph nodes — this pack is a frontend extension."""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []


async def comfy_entrypoint() -> ComfyExtension:
    return ZenIntegrationsExtension()


WEB_DIRECTORY = "./js"

__all__ = ["ZenIntegrationsExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
