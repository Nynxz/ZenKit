"""HTTP routes for the ZenSuite Asset Browser.

Browses ComfyUI's asset directories (output / input / temp), serving a cached
listing with file metadata + embedded-workflow info (PNG), plus fast JPEG
thumbnails. Full files (incl. video) are served by ComfyUI's own /view route.

The metadata index is a SQLite file in ZenSuite's cache dir: a row per file with
what the grid shows plus the generation settings and prompt text read from its
embedded workflow, and a full-text index over the text. The expensive read happens
once per file and is reused while its mtime+size are unchanged; a scan after a
restart only stats files and re-reads the few that are new or changed. It is a
cache built from the files: deleting it means the next scan rebuilds it. ComfyUI's
own asset database is never touched.

Routes
------
GET /zensuite/roots                 available roots: name/dir/exists
GET /zensuite/assets?root=          cached listing for a root (default output)
GET /zensuite/search?root=&q=&visual=1  rels of the files matching a search (see _search, _rank)
GET /zensuite/visual                visual search: the embedding models, the chosen one, indexing
POST /zensuite/visual {model}       choose the visual search model (null turns it off)
POST /zensuite/visual/index         embed the files not embedded yet
GET /zensuite/thumb?root=&rel=&size resized JPEG thumbnail for an image
GET /zensuite/outputs               back-compat alias for ?root=output

Visual search embeds every image and video (and audio, with EmbeddingGemma 2) with a multimodal
embedding model from models/embedders (see embedder.py), so a search can rank by what a file
shows. Nothing loads on its own: indexing runs when asked (in the background, while the queue is
idle) and a search ranks visually only when asked to. The vectors live in the same SQLite file.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time

import numpy as np
from aiohttp import web
from PIL import Image as PILImage

try:
    import comfy.model_management
    import folder_paths
    from server import PromptServer
    _routes = PromptServer.instance.routes
    folder_paths.add_model_folder_path("embedders", os.path.join(folder_paths.models_dir, "embedders"))
except Exception as e:  # pragma: no cover - only outside a running server
    PromptServer = None
    folder_paths = None
    _routes = None
    print(f"[ZenSuite] routes unavailable: {e}")

try:
    from . import embedder
except Exception as e:  # a ComfyUI without Qwen3-VL: the browser works, visual search doesn't
    embedder = None
    print(f"[ZenSuite] visual search unavailable: {e}")

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif"}
_VIDEO_EXTS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v"}
_AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".opus"}
_MODEL3D_EXTS = {".glb", ".gltf", ".obj", ".fbx", ".ply", ".stl", ".usdz"}
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
    if ext in _MODEL3D_EXTS:
        return "model3d"
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


# --- generation metadata ------------------------------------------------------------------------
# What a search can match on, read from a file's embedded ComfyUI prompt (the API graph) or an
# A1111-style parameters string: the prompt text, sampler, scheduler, seed, steps, cfg, model, loras.

_META = ("positive", "negative", "sampler", "scheduler", "seed", "steps", "cfg", "model", "loras")
_TEXT_INPUTS = {"text", "text_g", "text_l", "prompt", "string", "positive", "negative"}
# Links not followed when collecting a prompt's text: they lead to loaders, not text.
_NOT_TEXT = {"clip", "model", "vae", "image", "latent_image", "samples"}


def _number(v, kind):
    try:
        return kind(v)
    except (TypeError, ValueError):
        return None


def _from_graph(prompt: dict) -> dict:
    nodes = {str(k): v for k, v in prompt.items() if isinstance(v, dict)}

    def texts(link, depth=0) -> list[str]:
        node = nodes.get(str(link[0])) if isinstance(link, list) and link else None
        if not node or depth > 8:
            return []
        out = []
        for key, v in (node.get("inputs") or {}).items():
            if isinstance(v, str) and key in _TEXT_INPUTS and v.strip():
                out.append(v.strip())
            elif isinstance(v, list) and len(v) == 2 and key not in _NOT_TEXT:
                out += texts(v, depth + 1)
        return out

    # Samplers first, so their own settings win over the same names elsewhere in the graph.
    ordered = sorted(nodes.values(), key=lambda n: "sampler" not in str(n.get("class_type", "")).lower())
    meta: dict = {}
    positive: list[str] = []
    negative: list[str] = []
    models: list[str] = []
    loras: list[str] = []
    for node in ordered:
        inputs = node.get("inputs") or {}
        if isinstance(inputs.get("positive"), list):
            positive += texts(inputs["positive"])
        if isinstance(inputs.get("negative"), list):
            negative += texts(inputs["negative"])
        for key, field, kind in (
            ("sampler_name", "sampler", str),
            ("scheduler", "scheduler", str),
            ("seed", "seed", int),
            ("noise_seed", "seed", int),
            ("steps", "steps", int),
            ("cfg", "cfg", float),
        ):
            v = inputs.get(key)
            if field not in meta and not isinstance(v, list) and v is not None:
                meta[field] = _number(v, kind)
        for key in ("ckpt_name", "unet_name", "model_name"):
            if isinstance(inputs.get(key), str):
                models.append(inputs[key])
        if isinstance(inputs.get("lora_name"), str):
            loras.append(inputs["lora_name"])
    # A graph without a sampler wired to text encoders (custom samplers, guiders): every text
    # encoder's text counts as the prompt.
    if not positive:
        for node in nodes.values():
            if "textencode" in str(node.get("class_type", "")).lower():
                positive += [v.strip() for k, v in (node.get("inputs") or {}).items() if isinstance(v, str) and k in _TEXT_INPUTS and v.strip()]
    meta["positive"] = "\n".join(dict.fromkeys(positive)) or None
    # A negative made by zeroing the positive (ConditioningZeroOut) reaches the positive's text.
    meta["negative"] = "\n".join(t for t in dict.fromkeys(negative) if t not in positive) or None
    meta["model"] = ", ".join(dict.fromkeys(models)) or None
    meta["loras"] = ", ".join(dict.fromkeys(loras)) or None
    return meta


_A1111_SETTING = re.compile(r"\s*([\w ]+):\s*(\"[^\"]*\"|[^,]*)")


def _from_parameters(text: str) -> dict:
    """An A1111-style string: the prompt, "Negative prompt: …", then "Steps: 20, Sampler: …"."""
    head, _, settings = text.rpartition("\nSteps:")
    if not head:
        head, settings = text, ""
    else:
        settings = "Steps:" + settings
    positive, _, negative = head.partition("\nNegative prompt:")
    found = {k.strip().lower(): v.strip().strip('"') for k, v in _A1111_SETTING.findall(settings)}
    return {
        "positive": positive.strip() or None,
        "negative": negative.strip() or None,
        "sampler": found.get("sampler"),
        "scheduler": found.get("schedule type"),
        "seed": _number(found.get("seed"), int),
        "steps": _number(found.get("steps"), int),
        "cfg": _number(found.get("cfg scale"), float),
        "model": found.get("model"),
        "loras": None,
    }


def _read_meta(path: str, ext: str) -> tuple[bool, int, dict]:
    """(has_workflow, node_count, generation metadata) of an image — png/webp/jpeg."""
    empty = dict.fromkeys(_META)
    if ext.lstrip(".").lower() not in _IMAGE_EXT_NAMES:
        return False, 0, empty
    try:
        with PILImage.open(path) as img:
            emb = _extract_embedded(img)
    except Exception:
        return False, 0, empty
    has = emb["workflow"] is not None or emb["prompt"] is not None
    if isinstance(emb["prompt"], dict):
        meta = _from_graph(emb["prompt"])
    elif emb["params"]:
        meta = _from_parameters(emb["params"])
    else:
        meta = {}
    return has, _count_nodes(emb["workflow"], emb["prompt"]), {**empty, **meta}


def _safe_under(base: str, rel: str) -> str | None:
    full = os.path.realpath(os.path.join(base, rel))
    base = os.path.realpath(base)
    if full == base or full.startswith(base + os.sep):
        return full
    return None


# --- thumbnails ------------------------------------------------------------------------
#
# A thumbnail is made once and kept on disk, keyed by the file's path, mtime and the size asked
# for. Making one means decoding the whole original (a 2048px PNG is ~115 ms), and it used to run
# on every request, on ComfyUI's event loop: a screenful of tiles stalled the whole server for
# seconds while scrolling. Now it runs in a worker thread, a few at a time, and only on a miss.
_THUMB_WORKERS = asyncio.Semaphore(4)


def _thumb_path(path: str, size: int) -> str:
    stat = os.stat(path)
    key = hashlib.sha1(f"{path}|{stat.st_mtime_ns}|{stat.st_size}|{size}".encode()).hexdigest()
    d = os.path.join(_cache_dir(), "thumbs", key[:2])
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, key + ".jpg")


def _first_frame(path: str) -> "PILImage.Image":
    import av  # ComfyUI's own dependency; only needed for video posters

    with av.open(path) as container:
        stream = container.streams.video[0]
        for frame in container.decode(stream):
            return frame.to_image()
    raise ValueError("no video frames")


def _make_thumb(path: str, size: int, out: str) -> None:
    ext = os.path.splitext(path)[1].lower()
    if ext in _VIDEO_EXTS:
        img = _first_frame(path)
    else:
        img = PILImage.open(path)
        img.draft("RGB", (size, size))  # JPEG: decode at a reduced scale instead of full size
        img.seek(0)  # first frame for animated formats
    img = img.convert("RGB")
    # reducing_gap downsamples by whole factors first, then resamples the small remainder.
    img.thumbnail((size, size), PILImage.BICUBIC, reducing_gap=2.0)
    tmp = out + ".tmp"
    img.save(tmp, format="JPEG", quality=82)
    os.replace(tmp, out)


async def _thumbnail(path: str, size: int) -> str:
    out = _thumb_path(path, size)
    if os.path.isfile(out):
        return out
    async with _THUMB_WORKERS:
        if not os.path.isfile(out):  # made by another request while this one waited
            await asyncio.to_thread(_make_thumb, path, size, out)
    return out


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


# --- the index -----------------------------------------------------------------------------------

# Bump when the parser or the table changes: an index of another version is rebuilt from scratch.
_INDEX_VERSION = 4
_LISTED = ("rel", "name", "subfolder", "ext", "kind", "mtime", "size", "has_workflow", "node_count")
_SCHEMA = """
CREATE TABLE files (
  root TEXT NOT NULL, rel TEXT NOT NULL, name TEXT, subfolder TEXT, ext TEXT, kind TEXT,
  mtime REAL, size INTEGER, has_workflow INTEGER, node_count INTEGER,
  positive TEXT, negative TEXT, sampler TEXT, scheduler TEXT, seed INTEGER, steps INTEGER,
  cfg REAL, model TEXT, loras TEXT,
  PRIMARY KEY (root, rel)
);
"""
# The prompt text, file name, model and loras, searchable by word (kept in step by triggers).
_FTS_SCHEMA = """
CREATE VIRTUAL TABLE files_fts USING fts5(
  positive, negative, name, model, loras, content='files', content_rowid='rowid'
);
CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, positive, negative, name, model, loras)
  VALUES (new.rowid, new.positive, new.negative, new.name, new.model, new.loras);
END;
CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, positive, negative, name, model, loras)
  VALUES ('delete', old.rowid, old.positive, old.negative, old.name, old.model, old.loras);
END;
CREATE TRIGGER files_au AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, positive, negative, name, model, loras)
  VALUES ('delete', old.rowid, old.positive, old.negative, old.name, old.model, old.loras);
  INSERT INTO files_fts(rowid, positive, negative, name, model, loras)
  VALUES (new.rowid, new.positive, new.negative, new.name, new.model, new.loras);
END;
"""


def _db() -> sqlite3.Connection:
    """The index, created (or rebuilt after a version change) on first use. One connection per
    call: scans and searches run in worker threads."""
    con = sqlite3.connect(os.path.join(_cache_dir(), "assets.sqlite3"), timeout=10)
    con.row_factory = sqlite3.Row
    # Visual search vectors: kept across index rebuilds, stale once the file's mtime moves on.
    con.execute(
        "CREATE TABLE IF NOT EXISTS vectors (root TEXT NOT NULL, rel TEXT NOT NULL, model TEXT NOT NULL, "
        "mtime REAL, vec BLOB, PRIMARY KEY (root, rel))"
    )
    if con.execute("PRAGMA user_version").fetchone()[0] != _INDEX_VERSION:
        with con:
            con.executescript("DROP TABLE IF EXISTS files_fts; DROP TABLE IF EXISTS files;")
            con.executescript(_SCHEMA)
            try:
                con.executescript(_FTS_SCHEMA)
            except sqlite3.OperationalError:
                # SQLite built without FTS5: searches fall back to substring matching.
                pass
            con.execute(f"PRAGMA user_version = {_INDEX_VERSION}")
        # The JSON indexes this replaces.
        for root in ("output", "input", "temp"):
            try:
                os.remove(os.path.join(_cache_dir(), f"index_{root}.json"))
            except OSError:
                pass
    return con


def _has_fts(con: sqlite3.Connection) -> bool:
    return con.execute("SELECT 1 FROM sqlite_master WHERE name = 'files_fts'").fetchone() is not None


def _listed(row: sqlite3.Row) -> dict:
    item = {k: row[k] for k in _LISTED}
    item["has_workflow"] = bool(item["has_workflow"])
    return item


def _scan(root: str, emit=None) -> list[dict]:
    """Scan a root, reusing the index. `emit(status, current, total)` (optional) reports progress:
    counting is one quick walk, then each file is processed (only new/changed files are read)."""
    base = _root_dir(root)
    if not base or not os.path.isdir(base):
        if emit:
            emit("done", 0, 0)
        return []

    # Phase 1 — collect candidate files (cheap; gives us the total up front).
    paths: list[tuple[str, str, str]] = []
    for dirpath, _dirs, files in os.walk(base):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in _IMAGE_EXTS or ext in _VIDEO_EXTS or ext in _AUDIO_EXTS or ext in _MODEL3D_EXTS:
                paths.append((dirpath, f, ext))
                if len(paths) >= _MAX_FILES:
                    break
        if len(paths) >= _MAX_FILES:
            break
    total = len(paths)
    report = emit if (emit and total >= _JOB_MIN) else None
    if report:
        report("start", 0, total)

    # Phase 2 — read only what is new or changed since the index last saw it.
    con = _db()
    try:
        known = {
            r["rel"]: (r["mtime"], r["size"])
            for r in con.execute("SELECT rel, mtime, size FROM files WHERE root = ?", (root,))
        }
        seen: set[str] = set()
        changed: list[tuple] = []
        step = max(1, total // 100)  # ~100 progress updates at most
        cols = ("root", *_LISTED, *_META)
        upsert = (
            f"INSERT INTO files ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
            "ON CONFLICT(root, rel) DO UPDATE SET "
            + ", ".join(f"{c} = excluded.{c}" for c in cols[2:])
        )
        for idx, (dirpath, f, ext) in enumerate(paths):
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, base).replace(os.sep, "/")
            try:
                st = os.stat(full)
            except OSError:
                continue
            seen.add(rel)
            if known.get(rel) != (st.st_mtime, st.st_size):
                kind = _kind(ext)
                has_wf, nodes, meta = _read_meta(full, ext) if kind == "image" else (False, 0, dict.fromkeys(_META))
                changed.append(
                    (root, rel, f, os.path.dirname(rel), ext.lstrip("."), kind, st.st_mtime, st.st_size,
                     int(has_wf), nodes, *(meta[k] for k in _META))
                )
                if len(changed) >= 500:  # saved as it goes: a long first scan keeps its progress
                    with con:
                        con.executemany(upsert, changed)
                    changed.clear()
            if report and (idx % step == 0):
                report("progress", idx + 1, total)
        with con:
            con.executemany(upsert, changed)
            gone = [(root, rel) for rel in set(known) - seen]
            con.executemany("DELETE FROM files WHERE root = ? AND rel = ?", gone)
        items = [_listed(r) for r in con.execute(f"SELECT {', '.join(_LISTED)} FROM files WHERE root = ?", (root,))]
    finally:
        con.close()
    if report:
        report("done", total, total)
    return items


# --- search ------------------------------------------------------------------------------------------
# A search is words (matched in the prompt text, file name, model and loras, by prefix), "quoted
# phrases", and filters: sampler: scheduler: model: lora: name: (contain), seed: steps: (equal),
# cfg: (within 0.05), neg: (words in the negative prompt), kind: ext: and workflow:yes|no.
# A leading - excludes a word or a filter. Every part must match.

_TOKEN = re.compile(r'(-?)(?:(\w+):("[^"]*"|\S+)|"([^"]*)"|(\S+))')
_CONTAINS = {"sampler": "sampler", "scheduler": "scheduler", "model": "model", "lora": "loras", "loras": "loras", "name": "rel"}
_EQUALS = {"seed": int, "steps": int}


def _fts_terms(words: list[str]) -> str:
    """Words as an FTS5 expression: each quoted (no operators slip through), matched by prefix."""
    return " ".join('"' + w.replace('"', '""') + '"*' for w in words)


def _search(root: str, query: str) -> list[str]:
    """Rels of the files in `root` matching `query`."""
    con = _db()
    try:
        fts = _has_fts(con)
        where = ["root = ?"]
        args: list = [root]
        for neg, key, value, phrase, word in _TOKEN.findall(query):
            not_ = "NOT " if neg else ""
            if key:
                key = key.lower()
                value = value.strip('"')
                if key in _CONTAINS:
                    where.append(f"{not_}IFNULL({_CONTAINS[key]}, '') LIKE ?")
                    args.append(f"%{value}%")
                    continue
                if key in _EQUALS and _number(value, _EQUALS[key]) is not None:
                    where.append(f"{not_}IFNULL({key} = ?, 0)")
                    args.append(_number(value, _EQUALS[key]))
                    continue
                if key == "cfg" and _number(value, float) is not None:
                    where.append(f"{not_}IFNULL(ABS(cfg - ?) < 0.05, 0)")
                    args.append(_number(value, float))
                    continue
                if key in ("kind", "type", "ext"):
                    where.append(f"{not_}{'kind' if key != 'ext' else 'ext'} = ?")
                    args.append(value.lower())
                    continue
                if key == "workflow":
                    where.append(f"{not_}has_workflow = ?")
                    args.append(0 if value.lower() in ("no", "0", "false") else 1)
                    continue
                if key in ("neg", "negative"):
                    if fts:
                        where.append(f"{not_}rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)")
                        args.append("negative : (" + _fts_terms(value.split()) + ")")
                    else:
                        where.append(f"{not_}IFNULL(negative, '') LIKE ?")
                        args.append(f"%{value}%")
                    continue
                word = f"{key}:{value}"  # not a filter: search for it as typed
            text = phrase or word
            if not text:
                continue
            # A word matches the indexed text by prefix, or anywhere in the path (as the old
            # name filter did).
            if fts:
                match = ("{positive name model loras} : " + (f'"{text.replace(chr(34), "")}"' if phrase else _fts_terms([text])))
                where.append(f"{not_}(rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?) OR rel LIKE ?)")
                args += [match, f"%{text}%"]
            else:
                where.append(f"{not_}(IFNULL(positive, '') LIKE ? OR rel LIKE ? OR IFNULL(model, '') LIKE ?)")
                args += [f"%{text}%"] * 3
        rows = con.execute(f"SELECT rel FROM files WHERE {' AND '.join(where)}", args).fetchall()
        return [r["rel"] for r in rows]
    finally:
        con.close()


def _split(query: str) -> tuple[str, str]:
    """(the filters, the free text) of a search: what must match exactly, and what describes
    the image. Excluded words (-word) count as filters."""
    filters, text = [], []
    for m in _TOKEN.finditer(query):
        neg, key, _value, phrase, word = m.groups()
        known = key and (key.lower() in _CONTAINS or key.lower() in _EQUALS or key.lower() in (
            "cfg", "kind", "type", "ext", "workflow", "neg", "negative"))
        if neg or known:
            filters.append(m.group(0))
        else:
            text.append(phrase or word or m.group(0))
    return " ".join(filters), " ".join(text).strip()


# --- visual search ---------------------------------------------------------------------------------
# One embedder at a time, loaded when an index or a visual search is asked for and dropped after a
# while unused; the GPU is only touched while ComfyUI's queue is empty, so it never competes with
# a running workflow.

_VISUAL_IDLE = 300  # seconds unused before the model is let go
_VISUAL_PAUSE = 2.0  # seconds between checks while a workflow runs


class _Visual:
    lock = threading.Lock()  # the embedder runs for one caller at a time (indexer or a search)
    wake = threading.Event()
    embedder = None
    loaded = None  # the model name the embedder was loaded from
    used = 0.0
    state = {"state": "idle", "done": 0, "total": 0, "error": ""}
    # root -> (model, version, rels, vectors): the vectors a search compares against.
    matrix: dict[str, tuple] = {}
    version = 0  # bumped whenever vectors are written


def _visual_config_path() -> str:
    return os.path.join(_cache_dir(), "visual_search.json")


def _visual_model() -> str | None:
    try:
        with open(_visual_config_path(), encoding="utf-8") as f:
            name = json.load(f).get("model")
    except (OSError, ValueError):
        return None
    return name if name in _visual_models() else None


def _visual_models() -> list[str]:
    if folder_paths is None or embedder is None:
        return []
    return [n for n in folder_paths.get_filename_list("embedders") if n.endswith((".safetensors", ".sft"))]


def _queue_busy() -> bool:
    return PromptServer is not None and PromptServer.instance.prompt_queue.get_tasks_remaining() > 0


def _embedder(name: str):
    """The loaded embedder for `name` (call with the lock held)."""
    if _Visual.loaded != name:
        _Visual.embedder = None
        _Visual.embedder = embedder.load(folder_paths.get_full_path_or_raise("embedders", name))
        _Visual.loaded = name
    _Visual.used = time.monotonic()
    return _Visual.embedder


def _release() -> None:
    with _Visual.lock:
        if _Visual.embedder is not None:
            _Visual.embedder = None
            _Visual.loaded = None
            comfy.model_management.soft_empty_cache()


_VIDEO_FRAMES = 4  # spread across a video
_AUDIO_SECONDS = 60  # the start of a track is enough to tell what it is


def _video_frames(path: str) -> list:
    import av

    with av.open(path) as container:
        stream = container.streams.video[0]
        duration = float(stream.duration * stream.time_base) if stream.duration else 0.0
        frames = []
        for i in range(_VIDEO_FRAMES):
            # Seeking lands on the keyframe before each point; the next frame decoded is close enough.
            container.seek(int(duration * (i + 0.5) / _VIDEO_FRAMES / stream.time_base), stream=stream)
            frame = next(container.decode(stream), None)
            if frame is not None:
                frames.append(frame.to_image())
    return frames or [_first_frame(path)]


def _audio_samples(path: str) -> np.ndarray:
    import av

    with av.open(path) as container:
        resampler = av.AudioResampler(format="flt", layout="mono", rate=16000)
        out, have = [], 0
        for frame in container.decode(audio=0):
            for f in resampler.resample(frame):
                out.append(f.to_ndarray().reshape(-1))
                have += out[-1].size
            if have >= 16000 * _AUDIO_SECONDS:
                break
    if not out:
        raise ValueError("no audio")
    return np.concatenate(out)[: 16000 * _AUDIO_SECONDS]


def _embed_file(model, path: str, kind: str) -> np.ndarray:
    if kind == "video":
        return model.video(_video_frames(path))
    if kind == "audio":
        return model.audio(_audio_samples(path))
    img = PILImage.open(path)
    img.draft("RGB", (1024, 1024))
    img.seek(0)
    return model.image(img)


def _index_visual(name: str) -> None:
    """Embed every image and video not yet embedded with `name`, in every root."""
    con = _db()
    try:
        # Vectors from another model can't be compared with this one's.
        with con:
            con.execute("DELETE FROM vectors WHERE model != ?", (name,))
        kinds = embedder.kinds(folder_paths.get_full_path_or_raise("embedders", name))
        pending = []
        for root in _roots():
            _scan(root)
            base = _root_dir(root)
            rows = con.execute(
                "SELECT f.rel, f.kind FROM files f LEFT JOIN vectors v ON v.root = f.root AND v.rel = f.rel "
                f"AND v.mtime = f.mtime AND v.model = ? WHERE f.root = ? AND f.kind IN ({', '.join('?' * len(kinds))}) "
                "AND v.rel IS NULL ORDER BY f.mtime DESC",
                (name, root, *kinds),
            ).fetchall()
            pending += [(root, base, r["rel"], r["kind"]) for r in rows]
        total = len(pending)
        indexed = con.execute("SELECT COUNT(*) FROM vectors").fetchone()[0]
        _Visual.state.update(state="indexing" if total else "idle", done=indexed, total=indexed + total, error="")
        if not total:
            return
        job = "zensuite:visual"
        _emit_job(job, "Visual search index", "start", 0, total)
        batch = []
        for i, (root, base, rel, kind) in enumerate(pending):
            while _queue_busy():
                _Visual.state["state"] = "paused"
                time.sleep(_VISUAL_PAUSE)
            if _visual_model() != name:  # turned off or switched while indexing
                break
            _Visual.state["state"] = "indexing"
            path = _safe_under(base, rel)
            try:
                st = os.stat(path)
                with _Visual.lock:
                    vec = _embed_file(_embedder(name), path, kind)
            except Exception as e:  # noqa: BLE001 - one unreadable file mustn't stop the index
                print(f"[ZenSuite] visual search skipped {rel}: {e}")
                continue
            batch.append((root, rel, name, st.st_mtime, vec.tobytes()))
            _Visual.state["done"] += 1
            if len(batch) >= 16 or i == total - 1:
                with con:
                    con.executemany("INSERT OR REPLACE INTO vectors VALUES (?, ?, ?, ?, ?)", batch)
                batch.clear()
                _Visual.version += 1
                _emit_job(job, "Visual search index", "progress", i + 1, total)
        if batch:
            with con:
                con.executemany("INSERT OR REPLACE INTO vectors VALUES (?, ?, ?, ?, ?)", batch)
            _Visual.version += 1
        _emit_job(job, "Visual search index", "done", total, total)
        _Visual.state["state"] = "idle"
    finally:
        con.close()


def _visual_loop() -> None:
    """Runs an index when one is asked for (wake), and lets an unused model go."""
    while True:
        if _Visual.wake.wait(timeout=30):
            _Visual.wake.clear()
            name = _visual_model()
            try:
                if name is not None:
                    _index_visual(name)
            except Exception as e:  # noqa: BLE001 - report it; indexing again retries
                _Visual.state.update(state="error", error=str(e))
                print(f"[ZenSuite] visual search index failed: {e}")
        if _Visual.embedder is not None and (
            _visual_model() != _Visual.loaded or time.monotonic() - _Visual.used > _VISUAL_IDLE
        ):
            _release()


def _visual_status() -> dict:
    """The models, the chosen one, the index's state, and how many files it has (done) and lacks
    (pending) — counted from the metadata index, so the model needn't load."""
    name = _visual_model()
    out = {"models": _visual_models(), "model": name, **_Visual.state, "pending": 0}
    if name is None or _Visual.state["state"] in ("loading", "indexing", "paused"):
        return out
    kinds = embedder.kinds(folder_paths.get_full_path_or_raise("embedders", name))
    con = _db()
    try:
        out["done"] = con.execute("SELECT COUNT(*) FROM vectors WHERE model = ?", (name,)).fetchone()[0]
        out["pending"] = con.execute(
            "SELECT COUNT(*) FROM files f LEFT JOIN vectors v ON v.root = f.root AND v.rel = f.rel "
            f"AND v.mtime = f.mtime AND v.model = ? WHERE f.kind IN ({', '.join('?' * len(kinds))}) "
            "AND v.rel IS NULL",
            (name, *kinds),
        ).fetchone()[0]
    finally:
        con.close()
    out["total"] = out["done"] + out["pending"]
    return out


def _vectors(root: str, name: str) -> tuple[list[str], np.ndarray]:
    """The rels and vectors of a root, kept in memory until the index changes."""
    cached = _Visual.matrix.get(root)
    if cached and cached[0] == name and cached[1] == _Visual.version:
        return cached[2], cached[3]
    con = _db()
    try:
        rows = con.execute(
            "SELECT v.rel, v.vec FROM vectors v JOIN files f ON f.root = v.root AND f.rel = v.rel "
            "AND f.mtime = v.mtime WHERE v.root = ? AND v.model = ?",
            (root, name),
        ).fetchall()
    finally:
        con.close()
    rels = [r["rel"] for r in rows]
    vecs = np.stack([np.frombuffer(r["vec"], dtype=np.float16) for r in rows]) if rows else np.zeros((0, 1), np.float16)
    _Visual.matrix[root] = (name, _Visual.version, rels, vecs)
    return rels, vecs


def _rank(root: str, query: str, visual: bool) -> tuple[list[str], str, int]:
    """Rels matching a search, what visual search did ('ranked', 'off' when not asked for or no
    model is chosen, 'busy' while a workflow runs, or 'filters' when there is no free text), and
    how many lead the list as close matches. Ranked, every file the filters allow comes back best
    first: the close matches (near the best score, or matching the words), then the rest."""
    filters, text = _split(query)
    name = _visual_model() if visual else None
    if name is None or not text or _queue_busy():
        rels = _search(root, query)
        return rels, "off" if name is None else "filters" if not text else "busy", len(rels)
    with _Visual.lock:
        model = _embedder(name)
        q = model.query(text)
    allowed = set(_search(root, filters))
    words = set(_search(root, query))  # what matches the text as words too
    rels, vecs = _vectors(root, name)
    scores = vecs.astype(np.float32) @ q.astype(np.float32) if rels else []
    scored = {r: float(s) for r, s in zip(rels, scores) if r in allowed}
    best = max(scored.values(), default=0.0)
    close = {r for r, s in scored.items() if s >= best - model.spread} | words
    # Word matches not embedded yet sort last among the close ones.
    order = sorted(allowed | words, key=lambda r: (r in close, scored.get(r, -1.0) + (0.05 if r in words else 0.0)), reverse=True)
    return order, "ranked", len(close)


if _routes is not None:
    if embedder is not None:
        threading.Thread(target=_visual_loop, name="zensuite-visual", daemon=True).start()

    @_routes.get("/zensuite/visual")
    async def zs_visual(request):
        return web.json_response(await asyncio.get_event_loop().run_in_executor(None, _visual_status))

    @_routes.post("/zensuite/visual")
    async def zs_visual_set(request):
        name = (await request.json()).get("model") or None
        if name is not None and name not in _visual_models():
            return web.json_response({"error": f"no embedding model named {name}"}, status=400)
        with open(_visual_config_path(), "w", encoding="utf-8") as f:
            json.dump({"model": name}, f)
        _Visual.state["error"] = ""
        return web.json_response(await asyncio.get_event_loop().run_in_executor(None, _visual_status))

    @_routes.post("/zensuite/visual/index")
    async def zs_visual_index(request):
        if _visual_model() is None:
            return web.json_response({"error": "choose a visual search model first"}, status=400)
        if _Visual.state["state"] not in ("loading", "indexing", "paused"):
            _Visual.state.update(state="loading", error="")
            _Visual.wake.set()
        return web.json_response(await asyncio.get_event_loop().run_in_executor(None, _visual_status))

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

    @_routes.get("/zensuite/search")
    async def zs_search(request):
        q = request.rel_url.query
        root = (q.get("root", "output") or "output").strip()
        if root not in _roots():
            return web.json_response({"error": f"unknown root: {root}", "rels": []})
        loop = asyncio.get_event_loop()
        # Fresh first, so a search sees what was just generated.
        await loop.run_in_executor(None, _scan, root, None)
        try:
            rels, visual, close = await loop.run_in_executor(None, _rank, root, q.get("q", ""), q.get("visual") == "1")
        except sqlite3.OperationalError as e:
            return web.json_response({"error": f"couldn't run that search: {e}", "rels": []}, status=400)
        return web.json_response({"root": root, "rels": rels, "visual": visual, "close": close})

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
            size = max(16, min(1024, int(q.get("size", "256"))))
        except ValueError:
            size = 256
        base = _root_dir(root)
        path = _safe_under(base, rel) if base else None
        if not path or not os.path.isfile(path):
            return web.Response(status=404, text="not found")
        ext = os.path.splitext(path)[1].lower()
        if ext not in _IMAGE_EXTS and ext not in _VIDEO_EXTS:
            return web.Response(status=415, text="no thumbnail for this type")
        try:
            thumb = await _thumbnail(path, size)
        except Exception as e:
            return web.Response(status=500, text=str(e))
        # The client versions the URL with the file's mtime, so a response never goes stale.
        return web.FileResponse(thumb, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    print("[ZenSuite] asset browser routes registered under /zensuite/")
