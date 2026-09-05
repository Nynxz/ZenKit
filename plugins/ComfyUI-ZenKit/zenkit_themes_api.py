"""Runtime theme discovery for ZenKit.

Themes are pure JSON — `themes/<id>/theme.json` — NOT part of the frontend build.
This route scans the theme folder(s) on disk at request time and returns the parsed
packs, so dropping a new JSON in (or editing one) shows up on a browser reload with
no rebuild. The frontend (`fetchThemes` in @nynxz/zenkit-core) registers what it gets and
applies the one the user picked.

This is what replaces the old build-time `import.meta.glob` that baked every theme
into js/main.js — see plugins/ComfyUI-ZenKit/src/main.ts.

Theme folders scanned (later wins on an id clash, so a user theme overrides a
built-in of the same id):
  1. ``<plugin>/themes``          — the built-ins. Tracked source (not generated, not
                                     copied at build) and ships with the plugin.
  2. ``<user>/zenkit/themes``     — a user-writable drop-in folder (survives plugin
                                     updates). Create it and drop `theme.json`s in.

A pack may carry a ``css`` field: either CSS *text* (kept as-is) or a filename / list
of filenames relative to the theme folder, which we read and inline here — so the
frontend only ever sees resolved CSS, never a path. (Structured ``regions`` styling
and per-theme image assets from ComfyUI-NynxzExperimental are intentionally NOT
handled yet — this route is the minimal "load themes without a rebuild" piece.)

Route mirrors comfyui-zensuite/assets_api.py: registered as an import side effect on
``PromptServer.instance.routes``, guarded so importing outside a running ComfyUI
(tests, tooling) is a harmless no-op.
"""

from __future__ import annotations

import json
import os

from aiohttp import web

try:
    from server import PromptServer
    import folder_paths

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    PromptServer = None
    folder_paths = None
    _routes = None
    print(f"[ZenKit] theme route unavailable: {e}")

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _theme_dirs() -> list[str]:
    """Ordered list of existing theme folders. Built-ins first, user drop-ins last
    (so a user theme overrides a built-in with the same id)."""
    dirs = [
        os.path.join(_PLUGIN_DIR, "themes"),  # built-ins — tracked source, ships with the plugin
    ]
    if folder_paths is not None:
        try:
            user = folder_paths.get_user_directory()
            if user:
                dirs.append(os.path.join(user, "zenkit", "themes"))  # user drop-ins
        except Exception:
            pass
    # Dedupe by real path while preserving order, and keep only folders that exist.
    seen: set[str] = set()
    out: list[str] = []
    for d in dirs:
        real = os.path.realpath(d)
        if real in seen or not os.path.isdir(real):
            continue
        seen.add(real)
        out.append(real)
    return out


def _resolve_css(pack: dict, folder: str) -> None:
    """Resolve a ``css`` field of filename ref(s) into inlined CSS text, in place.

    A ``css`` that already looks like CSS (contains ``{``) is left untouched. Missing
    files are dropped so a dangling ref never reaches the client as bogus CSS. Only
    the basename is used, so a ref can never escape the theme folder.
    """
    css = pack.get("css")
    refs = css if isinstance(css, list) else [css] if isinstance(css, str) else []
    if not refs:
        return
    if any(isinstance(r, str) and "{" in r for r in refs):
        return  # already CSS text, not filename refs
    parts: list[str] = []
    for ref in refs:
        if not isinstance(ref, str) or not ref.strip():
            continue
        name = os.path.basename(ref)  # never escape the theme folder
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                parts.append(fh.read())
        except OSError:
            continue
    if parts:
        pack["css"] = "\n".join(parts)
    else:
        pack.pop("css", None)


def _list_themes() -> list[dict]:
    """Every ``themes/<id>/theme.json`` across the scanned folders. Bad files are
    skipped; a later folder's theme with the same id overrides an earlier one."""
    by_id: dict[str, dict] = {}
    order: list[str] = []
    for base in _theme_dirs():
        for name in sorted(os.listdir(base)):
            folder = os.path.join(base, name)
            path = os.path.join(folder, "theme.json")
            if not os.path.isfile(path):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    pack = json.load(fh)
            except (OSError, ValueError):
                continue
            if not isinstance(pack, dict) or not isinstance(pack.get("id"), str):
                continue
            _resolve_css(pack, folder)
            pid = pack["id"]
            if pid not in by_id:
                order.append(pid)
            by_id[pid] = pack  # later folder wins
    return [by_id[pid] for pid in order]


if _routes is not None:

    @_routes.get("/zenkit/themes")
    async def zenkit_themes(_request):
        return web.json_response({"themes": _list_themes()})

    print("[ZenKit] theme discovery route registered at /zenkit/themes")
