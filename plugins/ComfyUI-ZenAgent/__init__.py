"""comfyui-zenagent — the ComfyUI agent panel, backed by a local model.

The frontend's agent panel talks to an agent service at /api/agent. This pack serves that
contract from ComfyUI itself and answers with any OpenAI-compatible model (LM Studio,
Ollama, llama.cpp, a hosted API). The panel opens as a ZenKit panel from the start menu.
Ships no nodes.
"""

try:
    from .zenagent import routes  # noqa: F401  (registers /agent/* on PromptServer)
except Exception as e:  # pragma: no cover
    print(f"[ZenAgent] routes failed to load: {e}")

from comfy_api.latest import ComfyExtension, io


class ZenAgentExtension(ComfyExtension):
    """Ships no graph nodes — this pack is the agent backend plus a ZenKit panel."""

    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return []


async def comfy_entrypoint() -> ComfyExtension:
    return ZenAgentExtension()


WEB_DIRECTORY = "./js"

__all__ = ["ZenAgentExtension", "comfy_entrypoint", "WEB_DIRECTORY"]
