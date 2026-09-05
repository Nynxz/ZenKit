"""Zen Sync Image — publish an image to a ZenKit channel.

An OUTPUT node: route any image into it with a channel name, and on execution it
saves the first frame to the temp dir and broadcasts the ``zenkit.channel``
websocket event. ZenKit's channel bus picks it up, so views subscribed to that
channel (ZenSuite's **Media Viewer**) update live. The image passes through
unchanged so the node can sit inline. Use different channel names (e.g. "A" / "B")
to drive the Media Viewer's compare mode, or one channel for its live view.

This is the single canonical publisher for the channel bus.
"""

from __future__ import annotations

from comfy_api.latest import io

from ._base import ZenNode

# The websocket event ZenKit's channel bus listens for (see ZenKit channels.ts).
CHANNEL_EVENT = "zenkit.channel"


class ZenSyncImage(ZenNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return cls.make_schema(
            node_id="Channel.SyncImage",
            display_name="Zen Sync Image",
            description=(
                "Publish this image to a ZenKit channel (ZenSuite's Media Viewer updates "
                "live). Passes the image through so the node can sit inline."
            ),
            inputs=[
                io.Image.Input("image"),
                # Driven from SyncControls.vue; plain inputs so they still work without the JS.
                io.String.Input(
                    "channel",
                    default="default",
                    tooltip=(
                        "ZenKit channel name. Views subscribe to a channel; use e.g. 'A' "
                        "and 'B' to drive the Media Viewer's compare mode."
                    ),
                ),
                io.Boolean.Input(
                    "enable",
                    default=True,
                    tooltip="Turn publishing off without bypassing the node.",
                ),
            ],
            outputs=[io.Image.Output(display_name="image")],
            is_output_node=True,
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        # NaN = always re-run, so the channel updates on a repeat run.
        return float("nan")

    @classmethod
    def execute(cls, image, channel="default", enable=True) -> io.NodeOutput:
        ui_images: list[dict] = []
        if enable and image is not None and getattr(image, "ndim", 0) == 4 and image.shape[0] > 0:
            try:
                import os
                import random
                import time

                import folder_paths
                import numpy as np
                from PIL import Image as PILImage
                from server import PromptServer

                out_dir = folder_paths.get_temp_directory()
                os.makedirs(out_dir, exist_ok=True)
                arr = (image[0].cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
                h, w = arr.shape[0], arr.shape[1]
                fn = f"zen_channel_{int(time.time() * 1000)}_{random.randint(0, 9999)}.png"
                PILImage.fromarray(arr).save(os.path.join(out_dir, fn))
                PromptServer.instance.send_sync(
                    CHANNEL_EVENT,
                    {
                        "filename": fn,
                        "subfolder": "",
                        "type": "temp",
                        "channel": (channel or "default").strip() or "default",
                        "width": int(w),
                        "height": int(h),
                    },
                )
                # Surface in the node's own preview too, so it works without a panel.
                ui_images = [{"filename": fn, "subfolder": "", "type": "temp"}]
            except Exception as e:  # noqa: BLE001 - never fail the graph
                print(f"[ZenSuite] channel publish failed: {e}")

        return io.NodeOutput(image, ui={"images": ui_images})
