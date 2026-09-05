"""Zen Channel Preview — an on-graph wall of the last N images on a ZenKit channel.

A pure DISPLAY node: no image inputs, no outputs. Drop it anywhere on the graph,
point it at a channel (blank = most recent on any channel), and it shows a rolling
grid of the most recent images published there by a **Zen Sync Image** node.

All rendering is frontend (ChannelPreview.vue, over ZenKit's channel bus). This
Python side only declares the node and its serialised settings so they persist with
the workflow (and degrade to plain widgets if the JS never loads). With no outputs
and `is_output_node` unset, the graph never executes it.
"""

from __future__ import annotations

from comfy_api.latest import io

from ._base import ZenNode


class ZenChannelPreview(ZenNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return cls.make_schema(
            node_id="Channel.Preview",
            display_name="Zen Channel Preview",
            description=(
                "A live wall of a range of recent images published to a ZenKit channel — a "
                "preview of previous generations you can drop anywhere on the graph. No "
                "inputs/outputs; frontend-only (the on-graph twin of the Media Viewer)."
            ),
            # Driven from ChannelPreview.vue; they serialise with the workflow either way.
            inputs=[
                io.String.Input(
                    "channel",
                    default="",
                    tooltip=(
                        "ZenKit channel to watch. Blank = most recent on any channel. "
                        "Match a Zen Sync Image node's channel name."
                    ),
                ),
                io.Int.Input(
                    "count",
                    default=4,
                    min=1,
                    max=32,
                    tooltip="How many images to show (the length of the range).",
                ),
                io.Int.Input(
                    "skip",
                    default=0,
                    min=0,
                    max=32,
                    tooltip=(
                        "Skip the N most recent images — offset the range back in time "
                        "(0 = start at the newest)."
                    ),
                ),
                io.Combo.Input(
                    "layout",
                    options=["column", "row"],
                    default="column",
                    tooltip=(
                        "Stack the images vertically (column, each full node width) or in "
                        "a horizontally-scrolling row (fixed height)."
                    ),
                ),
                io.Int.Input(
                    "row_height",
                    default=180,
                    min=96,
                    max=640,
                    tooltip=(
                        "Strip height (px) in row layout — how tall the row of images is. "
                        "Ignored in column layout."
                    ),
                ),
            ],
            outputs=[],
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        return io.NodeOutput()  # display-only; the graph never runs this
