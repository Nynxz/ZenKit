"""HTTP routes for the ZenSuite Asset Browser.

Browses ComfyUI's asset directories (output / input / temp), serving a cached
listing with file metadata + embedded-workflow info (PNG), plus fast JPEG
thumbnails. Full files (incl. video) are served by ComfyUI's own /view route.

The metadata index is **persisted to disk** (one JSON per root), so a restart no
longer re-parses every PNG — the expensive embedded-workflow read happens once
per file and is reused while the file's mtime+size are unchanged. A scan after
restart only stats files (fast) and re-reads the few that are new/changed.

Routes
------
GET /zensuite/roots                 available roots: name/dir/exists
GET /zensuite/assets?root=          cached listing for a root (default output)
GET /zensuite/thumb?root=&rel=&size resized JPEG thumbnail for an image
GET /zensuite/outputs               back-compat alias for ?root=output
"""

from __future__ import annotations

import asyncio
import io as _io
import json
import math
import os

from aiohttp import web
from PIL import Image as PILImage

try:
    from server import PromptServer
    import folder_paths
    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    PromptServer = None
    folder_paths = None
    _routes = None
    print(f"[ZenSuite] routes unavailable: {e}")

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif"}
_VIDEO_EXTS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v"}
_AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".opus"}
_MAX_FILES = 20000
# Below this file count a scan is effectively instant — skip job events so the
# global progress chip doesn't flash on every refresh of a small directory.
_JOB_MIN = 150


def _emit_job(job_id: str, name: str, status: str, current: int = 0, total: int = 0, message: str = "") -> None:
    """Emit a ZenKit job event over the websocket (see jobs.ts protocol)."""
    if PromptServer is None:
        return
    try:
        PromptServer.instance.send_sync(
            "zenkit.job",
            {"id": job_id, "name": name, "status": status, "current": current, "total": total, "message": message},
        )
    except Exception:
        pass

# Per-root, per-file metadata cache (rel -> entry), mirrored to disk so PNG
# workflow parsing survives restarts. `_loaded` tracks which roots we've hydrated.
_cache: dict[str, dict[str, dict]] = {}
_loaded: set[str] = set()


def _roots() -> dict[str, str]:
    """Available asset roots (name -> absolute dir)."""
    out: dict[str, str] = {}
    if folder_paths is not None:
        for name, getter in (
            ("output", "get_output_directory"),
            ("input", "get_input_directory"),
            ("temp", "get_temp_directory"),
        ):
            try:
                d = getattr(folder_paths, getter)()
                if d:
                    out[name] = d
            except Exception:
                pass
    if not out:
        out["output"] = os.path.join(os.getcwd(), "output")
    return out


def _root_dir(root: str) -> str | None:
    return _roots().get(root)


def _kind(ext: str) -> str:
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    if ext in _AUDIO_EXTS:
        return "audio"
    return "other"


_IMAGE_EXT_NAMES = {e.lstrip(".") for e in _IMAGE_EXTS}


def _parse_json(raw):
    if raw is None:
        return None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None


def _json_safe(o):
    """Replace non-finite floats (NaN/Infinity) with None so the result is STRICT
    JSON. ComfyUI embeds prompts containing NaN (e.g. IS_CHANGED=float('nan')),
    which Python's json emits verbatim but the browser's JSON.parse rejects."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _json_safe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_json_safe(v) for v in o]
    return o


def _exif_pairs(img):
    """Yield (key, value) from ComfyUI-style EXIF, where webp/jpeg store metadata
    as ``"<key>:<json>"`` strings in IFD0 tags: 0x0110 (Model) = prompt, 0x010F
    (Make) = workflow, then 0x010E… decrementing for extra_pnginfo keys."""
    try:
        exif = img.getexif()
    except Exception:
        return
    for tag in (0x0110, 0x010F, 0x010E, 0x010D, 0x010C, 0x010B, 0x010A):
        v = exif.get(tag)
        if isinstance(v, bytes):
            try:
                v = v.decode("utf-8", "replace")
            except Exception:
                continue
        if isinstance(v, str) and ":" in v:
            key, val = v.split(":", 1)
            yield key.strip().lower(), val


def _exif_usercomment(img) -> str | None:
    """A1111-style generation string from the EXIF UserComment (0x9286)."""
    try:
        uc = img.getexif().get_ifd(0x8769).get(0x9286)
    except Exception:
        return None
    if isinstance(uc, bytes):
        body = uc[8:] if uc[:8] == b"UNICODE\x00" else uc
        enc = "utf-16-be" if uc[:8] == b"UNICODE\x00" else "utf-8"
        try:
            uc = body.decode(enc, "replace")
        except Exception:
            return None
    return uc if isinstance(uc, str) and uc.strip() else None


def _extract_embedded(img) -> dict:
    """Pull ComfyUI workflow/prompt (+ A1111 params) out of an open image,
    covering PNG text chunks AND webp/jpeg EXIF. Returns parsed objects."""
    out: dict = {"workflow": None, "prompt": None, "params": None}
    # 1) PNG text chunks (and any format that exposes them via .info).
    try:
        info = getattr(img, "text", None) or img.info or {}
    except Exception:
        info = {}
    if isinstance(info, dict):
        out["workflow"] = _parse_json(info.get("workflow"))
        out["prompt"] = _parse_json(info.get("prompt"))
        for k in ("parameters", "Comment", "Description"):
            if info.get(k):
                out["params"] = info[k] if isinstance(info[k], str) else str(info[k])
                break
    # 2) EXIF "<key>:<json>" pairs (webp/jpeg).
    for key, val in _exif_pairs(img):
        if key == "workflow" and out["workflow"] is None:
            out["workflow"] = _parse_json(val)
        elif key == "prompt" and out["prompt"] is None:
            out["prompt"] = _parse_json(val)
        elif key == "parameters" and not out["params"]:
            out["params"] = val
    # 3) A1111 UserComment fallback.
    if not out["params"]:
        uc = _exif_usercomment(img)
        if uc:
            out["params"] = uc
    return out


def _count_nodes(workflow, prompt) -> int:
    if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list):
        return len(workflow["nodes"])
    if isinstance(prompt, dict):
        return len(prompt)
    return 0


def _read_workflow_meta(path: str, ext: str) -> tuple[bool, int]:
    """(has_workflow, node_count) for the grid badge — covers png/webp/jpeg."""
    if ext.lstrip(".").lower() not in _IMAGE_EXT_NAMES:
        return False, 0
    try:
        with PILImage.open(path) as img:
            emb = _extract_embedded(img)
    except Exception:
        return False, 0
    has = emb["workflow"] is not None or emb["prompt"] is not None
    return has, _count_nodes(emb["workflow"], emb["prompt"])




def _safe_under(base: str, rel: str) -> str | None:
    full = os.path.realpath(os.path.join(base, rel))
    base = os.path.realpath(base)
    if full == base or full.startswith(base + os.sep):
        return full
    return None


# --- persistent index -------------------------------------------------------
def _cache_dir() -> str:
    base = None
    if folder_paths is not None:
        try:
            base = folder_paths.get_user_directory()
        except Exception:
            base = None
    if not base:
        base = os.path.join(os.path.dirname(os.path.realpath(__file__)), ".cache")
    d = os.path.join(base, "zensuite")
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        pass
    return d


def _index_path(root: str) -> str:
    return os.path.join(_cache_dir(), f"index_{root}.json")


# Bump when the parser changes so cached entries are re-evaluated on upgrade
# (e.g. v2 added webp/jpeg EXIF workflow extraction — old entries had it wrong;
#  v3 added audio files to the scan).
_INDEX_VERSION = 3


def _load_index(root: str) -> None:
    if root in _loaded:
        return
    _loaded.add(root)
    _cache.setdefault(root, {})
    try:
        with open(_index_path(root), "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("v") == _INDEX_VERSION:
            items = data.get("items")
            if isinstance(items, dict):
                _cache[root] = items
    except Exception:
        pass


def _save_index(root: str) -> None:
    try:
        path = _index_path(root)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"v": _INDEX_VERSION, "items": _cache.get(root, {})}, f)
        os.replace(tmp, path)
    except Exception as e:  # pragma: no cover
        print(f"[ZenSuite] failed to persist index for {root}: {e}")


def _scan(root: str, emit=None) -> list[dict]:
    """Scan a root, reusing the persisted index. `emit(status, current, total)`
    (optional) reports progress: counting is one quick walk, then each file is
    processed (only new/changed files are re-parsed)."""
    base = _root_dir(root)
    if not base or not os.path.isdir(base):
        if emit:
            emit("done", 0, 0)
        return []
    _load_index(root)
    cache = _cache.setdefault(root, {})

    # Phase 1 — collect candidate files (cheap; gives us the total up front).
    paths: list[tuple[str, str, str]] = []
    for dirpath, _dirs, files in os.walk(base):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in _IMAGE_EXTS or ext in _VIDEO_EXTS or ext in _AUDIO_EXTS:
                paths.append((dirpath, f, ext))
                if len(paths) >= _MAX_FILES:
                    break
        if len(paths) >= _MAX_FILES:
            break
    total = len(paths)
    report = emit if (emit and total >= _JOB_MIN) else None
    if report:
        report("start", 0, total)

    # Phase 2 — process, reusing cached metadata where mtime+size match.
    items: list[dict] = []
    seen: set[str] = set()
    dirty = False
    step = max(1, total // 100)  # ~100 progress updates at most
    for idx, (dirpath, f, ext) in enumerate(paths):
        full = os.path.join(dirpath, f)
        rel = os.path.relpath(full, base).replace(os.sep, "/")
        try:
            st = os.stat(full)
        except OSError:
            continue
        seen.add(rel)
        cached = cache.get(rel)
        if cached and cached.get("mtime") == st.st_mtime and cached.get("size") == st.st_size:
            items.append(cached)
        else:
            kind = _kind(ext)
            has_wf, nodes = _read_workflow_meta(full, ext) if kind == "image" else (False, 0)
            entry = {
                "rel": rel,
                "name": f,
                "subfolder": os.path.dirname(rel),
                "ext": ext.lstrip("."),
                "kind": kind,
                "mtime": st.st_mtime,
                "size": st.st_size,
                "has_workflow": has_wf,
                "node_count": nodes,
            }
            cache[rel] = entry
            items.append(entry)
            dirty = True
        if report and (idx % step == 0):
            report("progress", idx + 1, total)

    # drop cache entries for files that no longer exist
    for gone in set(cache) - seen:
        cache.pop(gone, None)
        dirty = True
    if dirty:
        _save_index(root)
    if report:
        report("done", total, total)
    return items


if _routes is not None:

    @_routes.get("/zensuite/roots")
    async def zs_roots(request):
        out = [{"name": n, "dir": d, "exists": os.path.isdir(d)} for n, d in _roots().items()]
        return web.json_response({"roots": out})

    @_routes.get("/zensuite/assets")
    async def zs_assets(request):
        root = (request.rel_url.query.get("root", "output") or "output").strip()
        if root not in _roots():
            return web.json_response({"error": f"unknown root: {root}", "items": [], "root": root})
        job_id = f"zensuite:scan:{root}"
        name = f"Scanning {root}"

        def emit(status, current, total):
            _emit_job(job_id, name, status, current, total)

        items = await asyncio.get_event_loop().run_in_executor(None, _scan, root, emit)
        return web.json_response(
            {"root": root, "dir": _root_dir(root), "items": items, "truncated": len(items) >= _MAX_FILES}
        )

    # Back-compat: the old Output Browser route.
    @_routes.get("/zensuite/outputs")
    async def zs_outputs(request):
        items = await asyncio.get_event_loop().run_in_executor(None, _scan, "output")
        return web.json_response(
            {"root": "output", "dir": _root_dir("output"), "items": items, "truncated": len(items) >= _MAX_FILES}
        )

    @_routes.get("/zensuite/thumb")
    async def zs_thumb(request):
        q = request.rel_url.query
        root = (q.get("root", "output") or "output").strip()
        rel = q.get("rel", "").strip()
        try:
            size = int(q.get("size", "256"))
        except ValueError:
            size = 256
        base = _root_dir(root)
        path = _safe_under(base, rel) if base else None
        if not path or not os.path.isfile(path):
            return web.Response(status=404, text="not found")
        if os.path.splitext(path)[1].lower() not in _IMAGE_EXTS:
            return web.Response(status=415, text="not an image")
        try:
            img = PILImage.open(path)
            img.seek(0)  # first frame for animated formats
            img = img.convert("RGB")
            w, h = img.size
            longest = max(w, h)
            if longest > size:
                scale = size / longest
                img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), PILImage.LANCZOS)
            buf = _io.BytesIO()
            img.save(buf, format="JPEG", quality=82)
            return web.Response(body=buf.getvalue(), content_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})
        except Exception as e:
            return web.Response(status=500, text=str(e))

    print("[ZenSuite] asset browser routes registered under /zensuite/")
