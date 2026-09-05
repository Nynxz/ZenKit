"""Shared base for ZenSuite's nodes: node-id namespace and menu category."""

from __future__ import annotations

from comfy_api.latest import io


class ZenNode(io.ComfyNode):
    """Base for every ZenSuite node. Build the schema via `make_schema`."""

    NAMESPACE = "zen"
    CATEGORY = "Zen/Suite"

    #: Compose `NAMESPACE.node_id` — this pack's ids are `zen.<Group>.<Name>`.
    PREFIX_NODE_IDS = True

    @classmethod
    def make_schema(cls, node_id: str, display_name: str, **kwargs) -> io.Schema:
        return io.Schema(
            node_id=f"{cls.NAMESPACE}.{node_id}" if cls.PREFIX_NODE_IDS else node_id,
            display_name=display_name,
            category=cls.CATEGORY,
            **kwargs,
        )
