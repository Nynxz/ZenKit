"""Cached thumbnails for files in ComfyUI's input / output / temp folders.

GET /zenkit/thumb?type=output&filename=x.png&subfolder=&size=256 returns a JPEG no larger
than `size` on its longest edge (a video's first frame for videos). This is what
`thumbUrl` in @nynxz/zenkit-client builds URLs for.

A thumbnail is made once and kept on disk under <user>/zenkit/thumbs, keyed by the file's
path, mtime, byte size and the requested size, so an edited file gets a fresh one. Making
one decodes the whole original, so it runs in a worker thread, a few at a time, and never
on ComfyUI's event loop.
"""

from __future__ import annotations

import asyncio
import hashlib
import os

from aiohttp import web

try:
    from server import PromptServer
    import folder_paths

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    folder_paths = None
    _routes = None
    print(f"[ZenKit] thumbnail route unavailable: {e}")

_VIDEO_EXTS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v"}
_MIN_SIZE, _MAX_SIZE = 16, 2048
_WORKERS = asyncio.Semaphore(4)


def _source(kind: str, subfolder: str, filename: str) -> str | None:
    if folder_paths is None or kind not in ("input", "output", "temp"):
        return None
    base = os.path.realpath(folder_paths.get_directory_by_type(kind))
    path = os.path.realpath(os.path.join(base, subfolder, filename))
    if not path.startswith(base + os.sep) or not os.path.isfile(path):
        return None
    return path


def _cache_path(path: str, size: int) -> str:
    stat = os.stat(path)
    key = hashlib.sha1(f"{path}|{stat.st_mtime_ns}|{stat.st_size}|{size}".encode()).hexdigest()
    folder = os.path.join(folder_paths.get_user_directory(), "zenkit", "thumbs", key[:2])
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, key + ".jpg")


def _first_frame(path: str):
    import av  # a ComfyUI dependency; only needed for video posters

    with av.open(path) as container:
        for frame in container.decode(container.streams.video[0]):
            return frame.to_image()
    raise ValueError("no video frames")


def _render(path: str, size: int, out: str) -> None:
    from PIL import Image

    if os.path.splitext(path)[1].lower() in _VIDEO_EXTS:
        img = _first_frame(path)
    else:
        img = Image.open(path)
        img.draft("RGB", (size, size))
        img.seek(0)
    img = img.convert("RGB")
    img.thumbnail((size, size), Image.BICUBIC, reducing_gap=2.0)
    tmp = out + ".tmp"
    img.save(tmp, format="JPEG", quality=82)
    os.replace(tmp, out)


async def _thumbnail(path: str, size: int) -> str:
    out = _cache_path(path, size)
    if os.path.isfile(out):
        return out
    async with _WORKERS:
        if not os.path.isfile(out):
            await asyncio.to_thread(_render, path, size, out)
    return out


if _routes is not None:

    @_routes.get("/zenkit/thumb")
    async def _thumb(request: web.Request) -> web.StreamResponse:
        q = request.rel_url.query
        path = _source(q.get("type", "output"), q.get("subfolder", ""), q.get("filename", ""))
        if path is None:
            return web.Response(status=404)
        try:
            size = min(_MAX_SIZE, max(_MIN_SIZE, int(q.get("size", "256"))))
        except ValueError:
            return web.Response(status=400)
        try:
            out = await _thumbnail(path, size)
        except Exception as e:
            return web.Response(status=415, text=f"cannot thumbnail: {e}")
        return web.FileResponse(out, headers={"Cache-Control": "no-cache"})
