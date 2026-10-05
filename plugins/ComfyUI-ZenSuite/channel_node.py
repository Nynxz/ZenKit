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
        if (
            enable
            and image is not None
            and getattr(image, "ndim", 0) == 4
            and image.shape[0] > 0
        ):
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


# What Zen Sync accepts; its output takes on whichever of these is wired in.
_MEDIA = io.MatchType.Template(
    "media", allowed_types=[io.Image, io.Mask, io.Video, io.Audio]
)


def _publish(
    channel: str, saved: dict, kind: str, label: str = "", width=None, height=None
) -> None:
    from server import PromptServer

    payload = {**saved, "channel": channel, "kind": kind}
    if label:
        payload["label"] = label
    if width and height:
        payload["width"], payload["height"] = int(width), int(height)
    PromptServer.instance.send_sync(CHANNEL_EVENT, payload)


def _file_in_comfy(path) -> dict | None:
    """`{filename, subfolder, type}` for a file inside ComfyUI's input / output / temp folders."""
    import os

    import folder_paths

    if not isinstance(path, str):
        return None
    real = os.path.realpath(path)
    for folder in ("output", "input", "temp"):
        base = os.path.realpath(folder_paths.get_directory_by_type(folder))
        if os.path.commonpath([base, real]) == base:
            rel = os.path.relpath(real, base)
            return {
                "filename": os.path.basename(rel),
                "subfolder": os.path.dirname(rel),
                "type": folder,
            }
    return None


def _save_video(video) -> dict:
    """Write a VIDEO to the temp folder; `{filename, subfolder, type}`."""
    import os
    import random
    import time

    import folder_paths

    name = f"zen_channel_{int(time.time() * 1000)}_{random.randint(0, 9999)}.mp4"
    video.save_to(os.path.join(folder_paths.get_temp_directory(), name))
    return {"filename": name, "subfolder": "", "type": "temp"}


class ZenSync(ZenNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return cls.make_schema(
            node_id="Channel.Sync",
            display_name="Zen Sync",
            description=(
                "Publish an image, mask, video or audio to a ZenKit channel, so the Media Viewer (or "
                "any panel following the channel) shows it the moment it's made. Passes it through "
                "unchanged, so the node can sit inline — after a Save Video, it shows the saved file."
            ),
            search_aliases=[
                "sync video",
                "sync audio",
                "channel",
                "send to viewer",
                "media viewer",
            ],
            inputs=[
                io.MatchType.Input(
                    "media", _MEDIA, tooltip="An image, mask, video or audio."
                ),
                io.String.Input(
                    "channel",
                    default="default",
                    tooltip="ZenKit channel name. Views follow a channel; e.g. 'A' and 'B' drive the "
                    "Media Viewer's compare mode.",
                ),
                io.Boolean.Input(
                    "enable",
                    default=True,
                    tooltip="Turn publishing off without bypassing the node.",
                ),
                io.Combo.Input(
                    "image_batch",
                    options=["as video", "first image"],
                    default="as video",
                    advanced=True,
                    tooltip="A batch of several images (e.g. decoded video frames): publish it as a clip, "
                    "or just its first image.",
                ),
                io.Float.Input(
                    "fps",
                    default=24.0,
                    min=1.0,
                    max=120.0,
                    step=1.0,
                    advanced=True,
                    tooltip="Frame rate for an image batch published as a clip.",
                ),
            ],
            outputs=[io.MatchType.Output(_MEDIA, display_name="media")],
            is_output_node=True,
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        return float("nan")

    @classmethod
    def execute(
        cls, media, channel="default", enable=True, image_batch="as video", fps=24.0
    ) -> io.NodeOutput:
        name = (channel or "default").strip() or "default"
        if not enable or media is None:
            return io.NodeOutput(media)
        try:
            return io.NodeOutput(
                media, ui=cls._publish_media(media, name, image_batch, fps)
            )
        except Exception as e:  # noqa: BLE001 - never fail the graph over a preview
            print(f"[ZenSuite] Zen Sync publish failed: {e}")
            return io.NodeOutput(media)

    @classmethod
    def _publish_media(cls, media, channel, image_batch, fps):
        from fractions import Fraction

        from comfy_api.latest import InputImpl, Types, ui

        if isinstance(media, dict) and "waveform" in media:
            preview = ui.PreviewAudio(media, cls=cls)
            _publish(channel, dict(preview.values[0]), "audio")
            return preview

        if hasattr(media, "get_components"):
            width, height = media.get_dimensions()
            saved = None
            if isinstance(
                media, InputImpl.VideoFromFile
            ) and media.get_active_trim_window() == (0.0, 0.0):
                saved = _file_in_comfy(media.get_stream_source())
            saved = saved or _save_video(media)
            _publish(channel, saved, "video", width=width, height=height)
            return ui.PreviewVideo([saved])

        images = media
        if images.ndim == 3:  # MASK → grey image
            images = (
                images.reshape((-1, 1, images.shape[-2], images.shape[-1]))
                .movedim(1, -1)
                .expand(-1, -1, -1, 3)
            )
        height, width = images.shape[1], images.shape[2]
        if images.shape[0] > 1 and image_batch == "as video":
            clip = InputImpl.VideoFromComponents(
                Types.VideoComponents(
                    images=images[..., :3],
                    frame_rate=Fraction(fps).limit_denominator(1000),
                )
            )
            saved = _save_video(clip)
            _publish(channel, saved, "video", width=width, height=height)
            return ui.PreviewVideo([saved])
        preview = ui.PreviewImage(images[:1], cls=cls)
        _publish(channel, dict(preview.values[0]), "image", width=width, height=height)
        return preview


def _video_metadata(cls) -> dict | None:
    from comfy.cli_args import args

    if args.disable_metadata:
        return None
    metadata = dict(cls.hidden.extra_pnginfo or {})
    if cls.hidden.prompt is not None:
        metadata["prompt"] = cls.hidden.prompt
    return metadata or None


def _save_video_output(video, prefix: str, metadata: dict | None) -> dict:
    """Save a VIDEO into the output folder as core's Save Video names it; `{filename, subfolder, type}`."""
    import os

    import folder_paths

    width, height = video.get_dimensions()
    folder, name, counter, subfolder, _ = folder_paths.get_save_image_path(
        prefix, folder_paths.get_output_directory(), width, height
    )
    file = f"{name}_{counter:05}_.mp4"
    video.save_to(os.path.join(folder, file), metadata=metadata)
    return {"filename": file, "subfolder": subfolder, "type": "output"}


class ZenSave(ZenNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return cls.make_schema(
            node_id="Channel.Save",
            display_name="Zen Save",
            description=(
                "Save an image, mask, video or audio to the output folder — like Save Image / Save Video "
                "/ Save Audio, workflow embedded — and publish the saved file to a ZenKit channel. What "
                "the Media Viewer shows is then the real output, so it survives a refresh or a restart."
            ),
            search_aliases=[
                "save and sync",
                "save video",
                "save image",
                "save audio",
                "media viewer",
            ],
            inputs=[
                io.MatchType.Input(
                    "media", _MEDIA, tooltip="An image, mask, video or audio."
                ),
                io.String.Input(
                    "filename_prefix",
                    default="zen/ZenKit",
                    tooltip="Where to save, under the output folder. Accepts the same %date:…% / "
                    "%Node.widget% formatting as Save Image.",
                ),
                io.String.Input(
                    "channel",
                    default="default",
                    tooltip="ZenKit channel to publish to.",
                ),
                io.Boolean.Input(
                    "enable",
                    default=True,
                    tooltip="Publish to the channel. Saving happens either way.",
                ),
                io.Combo.Input(
                    "image_batch",
                    options=["as video", "each image"],
                    default="each image",
                    advanced=True,
                    tooltip="A batch of several images: save every image, or save the batch as one clip.",
                ),
                io.Float.Input(
                    "fps",
                    default=24.0,
                    min=1.0,
                    max=120.0,
                    step=1.0,
                    advanced=True,
                    tooltip="Frame rate for an image batch saved as a clip.",
                ),
            ],
            outputs=[io.MatchType.Output(_MEDIA, display_name="media")],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(
        cls,
        media,
        filename_prefix="zen/ZenKit",
        channel="default",
        enable=True,
        image_batch="each image",
        fps=24.0,
    ) -> io.NodeOutput:
        from fractions import Fraction

        from comfy_api.latest import InputImpl, Types, ui

        name = (channel or "default").strip() or "default"
        prefix = filename_prefix or "zen/ZenKit"
        published: list[tuple[dict, str, int | None, int | None]] = []

        if isinstance(media, dict) and "waveform" in media:
            results = ui.AudioSaveHelper.save_audio(
                media, prefix, io.FolderType.output, cls, format="flac"
            )
            published = [(dict(r), "audio", None, None) for r in results]
            out_ui = ui.SavedAudios(results)
        elif hasattr(media, "get_components"):
            width, height = media.get_dimensions()
            saved = None
            if isinstance(
                media, InputImpl.VideoFromFile
            ) and media.get_active_trim_window() == (0.0, 0.0):
                found = _file_in_comfy(media.get_stream_source())
                saved = found if found and found["type"] == "output" else None
            saved = saved or _save_video_output(media, prefix, _video_metadata(cls))
            published = [(saved, "video", width, height)]
            out_ui = ui.PreviewVideo([saved])
        else:
            images = media
            if images.ndim == 3:  # MASK → grey image
                images = (
                    images.reshape((-1, 1, images.shape[-2], images.shape[-1]))
                    .movedim(1, -1)
                    .expand(-1, -1, -1, 3)
                )
            height, width = images.shape[1], images.shape[2]
            if images.shape[0] > 1 and image_batch == "as video":
                clip = InputImpl.VideoFromComponents(
                    Types.VideoComponents(
                        images=images[..., :3],
                        frame_rate=Fraction(fps).limit_denominator(1000),
                    )
                )
                saved = _save_video_output(clip, prefix, _video_metadata(cls))
                published = [(saved, "video", width, height)]
                out_ui = ui.PreviewVideo([saved])
            else:
                results = ui.ImageSaveHelper.save_images(
                    images, prefix, io.FolderType.output, cls
                )
                published = [(dict(r), "image", width, height) for r in results]
                out_ui = ui.SavedImages(results)

        if enable:
            for saved, kind, w, h in published:
                try:
                    _publish(name, saved, kind, width=w, height=h)
                except Exception as e:  # noqa: BLE001 - the file is saved; only the live view misses it
                    print(f"[ZenSuite] Zen Save publish failed: {e}")
        return io.NodeOutput(media, ui=out_ui)
