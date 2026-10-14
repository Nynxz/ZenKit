"""The panels and nodes ZenKit comes with (once the separate ComfyUI-ZenSuite pack): the channel
nodes that feed the Media Viewer, and the Asset Browser's routes. Their frontend is src/suite."""

from __future__ import annotations

from .channel_node import ZenSave, ZenSync, ZenSyncImage
from .preview_node import ZenChannelPreview

NODES = [ZenChannelPreview, ZenSave, ZenSync, ZenSyncImage]
