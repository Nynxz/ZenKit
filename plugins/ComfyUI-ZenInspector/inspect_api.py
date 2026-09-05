"""Backend introspection for the Zen Inspector — `GET /zeninspector/inspect`.

The frontend can already see everything that *worked*: `/object_info` lists every node
that made it into the registry, `/extensions` lists every JS file a pack serves. What it
can NOT see is the negative space — a pack sitting in `custom_nodes/` that raised on
import contributes nothing to either, so it's simply invisible. That's exactly the case a
debug panel exists for, so this route reports the disk truth instead:

  • every entry ComfyUI *considered* in each `custom_nodes` root, and whether it ended up
    loaded / failed / disabled (mirrors nodes.init_external_custom_nodes' own skip rules),
  • pyproject identity (name / version / description, plus `[tool.zenkit] id`) and the
    current git ref, so "which build of this pack am I actually running" is answerable,
  • the web dirs it serves (the `EXTENSION_WEB_DIRS` keys that live under it), which is
    what turns a `/extensions/<Name>/foo.js` URL back into an owning pack, and
  • declared vs effective node classes — see `_pack_nodes` below. This is the one real way
    to detect a name collision after the fact, and it's the "are my nodes *properly*
    registered" answer.

Registered as an import side effect on `PromptServer.instance.routes`, guarded so importing
outside a running ComfyUI (tests, tooling) is a harmless no-op. Mirrors the shape of
comfyui-zenkit/zenkit_themes_api.py.
"""

from __future__ import annotations

import os
import sys
from typing import Any

from aiohttp import web

try:
    from server import PromptServer
    import folder_paths
    import nodes as comfy_nodes

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    PromptServer = None
    folder_paths = None
    comfy_nodes = None
    _routes = None
    print(f"[ZenInspector] inspect route unavailable: {e}")

try:
    import tomllib as _toml  # py3.11+
except Exception:  # pragma: no cover
    _toml = None


# ── pack identity ──────────────────────────────────────────────────────────────────────

def _pyproject(path: str) -> dict[str, Any]:
    """`pyproject.toml` identity for a pack folder. Everything optional — a plain folder
    with no pyproject is completely normal, and a malformed one must not break the scan."""
    out: dict[str, Any] = {}
    toml = os.path.join(path, "pyproject.toml")
    if _toml is None or not os.path.isfile(toml):
        return out
    try:
        with open(toml, "rb") as fh:
            data = _toml.load(fh)
    except Exception:
        return {"error": "unreadable pyproject.toml"}
    project = data.get("project") or {}
    tool = data.get("tool") or {}
    for key in ("name", "version", "description"):
        val = project.get(key)
        if isinstance(val, str) and val:
            out[key] = val
    comfy = tool.get("comfy") or {}
    for src, dst in (("PublisherId", "publisher"), ("DisplayName", "display_name")):
        val = comfy.get(src)
        if isinstance(val, str) and val:
            out[dst] = val
    zen_id = (tool.get("zenkit") or {}).get("id")
    if isinstance(zen_id, str) and zen_id:
        out["zenkit_id"] = zen_id
    return out


def _git(path: str) -> dict[str, str]:
    """Branch + short commit for the repo a pack lives in — no subprocess, no gitpython.

    Walks up a few levels because a monorepo checkout symlinked into `custom_nodes/`
    (ZenKit's own plugins do exactly this) has its `.git` several folders above the pack.
    When the repo root isn't the pack folder itself we report it, so it's obvious the ref
    describes a containing repo rather than the pack alone.
    """
    real = os.path.realpath(path)
    here = real
    for _ in range(5):
        if os.path.exists(os.path.join(here, ".git")):
            out = _git_at(here)
            if out and here != real:
                out["repo"] = os.path.basename(here)
            return out
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return {}


def _git_at(path: str) -> dict[str, str]:
    """Read HEAD out of one `.git`. Handles the worktree/submodule `gitdir:` indirection."""
    try:
        git = os.path.join(path, ".git")
        if os.path.isfile(git):  # worktree or submodule: a "gitdir: <path>" pointer
            with open(git, encoding="utf-8") as fh:
                ref = fh.read().strip()
            if not ref.startswith("gitdir:"):
                return {}
            git = os.path.normpath(os.path.join(path, ref[len("gitdir:"):].strip()))
        if not os.path.isdir(git):
            return {}
        with open(os.path.join(git, "HEAD"), encoding="utf-8") as fh:
            head = fh.read().strip()
        if not head.startswith("ref:"):
            return {"commit": head[:8]}  # detached HEAD
        branch = head[len("ref:"):].strip()
        out = {"branch": branch.rsplit("/", 1)[-1]}
        loose = os.path.join(git, branch)
        if os.path.isfile(loose):
            with open(loose, encoding="utf-8") as fh:
                out["commit"] = fh.read().strip()[:8]
        else:  # packed-refs
            packed = os.path.join(git, "packed-refs")
            if os.path.isfile(packed):
                with open(packed, encoding="utf-8") as fh:
                    for line in fh:
                        if line.endswith(f" {branch}\n") or line.rstrip().endswith(f" {branch}"):
                            out["commit"] = line.split(" ", 1)[0][:8]
                            break
        return out
    except Exception:
        return {}


# ── node ownership ─────────────────────────────────────────────────────────────────────

def _declared_index() -> dict[str, list[str]]:
    """`realpath(module.__file__)` → the NODE_CLASS_MAPPINGS keys that module *declares*.

    Walks the live `sys.modules` because a pack's own mapping dict is the only surviving
    record of what it tried to register — the global registry keeps just the winner.
    """
    out: dict[str, list[str]] = {}
    for mod in list(sys.modules.values()):
        try:
            file = getattr(mod, "__file__", None)
            mappings = getattr(mod, "NODE_CLASS_MAPPINGS", None)
            if not file or not isinstance(mappings, dict) or not mappings:
                continue
            out[os.path.realpath(file)] = [str(k) for k in mappings]
        except Exception:
            continue  # lazy/proxy modules can raise on attribute access
    return out


def _owners() -> dict[str, str]:
    """Global registry: node class name → the module that *won* it. ComfyUI stamps
    `RELATIVE_PYTHON_MODULE` on the class as it registers; absent means a built-in."""
    out: dict[str, str] = {}
    try:
        for name, cls in list(comfy_nodes.NODE_CLASS_MAPPINGS.items()):
            out[str(name)] = str(getattr(cls, "RELATIVE_PYTHON_MODULE", "nodes"))
    except Exception:
        pass
    return out


def _pack_nodes(
    pack_dir: str, is_file: bool, py_module: str,
    declared_idx: dict[str, list[str]], owners: dict[str, str],
) -> dict[str, Any]:
    """Split a pack's node classes into what it *declared* vs what it actually *owns*.

    They diverge in two ways worth surfacing:
      • declared, but the registry attributes the name to someone else → a collision. The
        other pack (or a built-in — `load_custom_node` passes core names as `ignore`, so a
        pack that reuses a built-in name is silently skipped) shadows this one.
      • owned but never declared here → the pack registers through the V3 `comfy_entrypoint`
        / `get_node_list()` API and has no NODE_CLASS_MAPPINGS dict to compare against.

    `style` records which of the two registration APIs was used, so the UI can say "V3" for
    a pack with zero declared nodes rather than implying something went wrong.
    """
    declared: list[str] = []
    if is_file:
        declared = declared_idx.get(os.path.realpath(pack_dir), [])
    else:
        root = declared_idx.get(os.path.realpath(os.path.join(pack_dir, "__init__.py")))
        if root is not None:
            declared = root  # the package entry point is authoritative when present
        else:  # single-file-per-node-group layouts: union every module under the pack
            prefix = os.path.realpath(pack_dir) + os.sep
            seen: set[str] = set()
            for file, names in declared_idx.items():
                if file.startswith(prefix):
                    for n in names:
                        if n not in seen:
                            seen.add(n)
                            declared.append(n)

    effective = sorted(n for n, owner in owners.items() if owner == py_module)
    eff_set = set(effective)
    shadowed = [
        {"class": n, "owner": owners.get(n) or "(dropped)"}
        for n in declared
        if n not in eff_set
    ]
    return {
        "declared": sorted(declared),
        "nodes": effective,
        "shadowed": shadowed,
        # Only meaningful against a declaration list; a V3 pack declares nothing, and
        # listing all of its nodes as "undeclared" would be noise, not a finding.
        "undeclared": sorted(eff_set - set(declared)) if declared else [],
        "style": "v1" if declared else ("v3" if effective else "none"),
    }


# ── scan ───────────────────────────────────────────────────────────────────────────────

def _roots() -> list[str]:
    try:
        return [p for p in folder_paths.get_folder_paths("custom_nodes") if os.path.isdir(p)]
    except Exception:
        return []


def _web_dirs_under(pack_dir: str) -> list[dict[str, str]]:
    """The `EXTENSION_WEB_DIRS` entries this pack owns. The key is what shows up in a
    `/extensions/<key>/…` URL, which is how the frontend maps served JS back to a pack —
    and it's the *pyproject* name when one exists, so it often differs from the folder."""
    out: list[dict[str, str]] = []
    real = os.path.realpath(pack_dir)
    try:
        for name, path in list(comfy_nodes.EXTENSION_WEB_DIRS.items()):
            rp = os.path.realpath(path)
            if rp == real or rp.startswith(real + os.sep):
                out.append({"name": str(name), "path": rp})
    except Exception:
        pass
    return out


def _scan() -> dict[str, Any]:
    declared_idx = _declared_index()
    owners = _owners()
    loaded: dict[str, str] = {}
    try:
        loaded = {k: os.path.realpath(v) for k, v in comfy_nodes.LOADED_MODULE_DIRS.items()}
    except Exception:
        pass

    packs: list[dict[str, Any]] = []
    for root in _roots():
        try:
            entries = sorted(os.listdir(os.path.realpath(root)))
        except OSError:
            continue
        for entry in entries:
            path = os.path.join(root, entry)
            is_file = os.path.isfile(path)
            # Mirror init_external_custom_nodes' skip rules so "considered" means the same
            # thing here as it does in the loader.
            if entry == "__pycache__":
                continue
            if is_file and os.path.splitext(entry)[1] != ".py":
                continue
            if not is_file and not os.path.isdir(path):
                continue

            module = os.path.splitext(entry)[0] if is_file else entry
            disabled = entry.endswith(".disabled")
            real = os.path.realpath(path)
            # LOADED_MODULE_DIRS records the *containing* directory for a single-file pack
            # (`module_dir = os.path.split(module_path)[0]`), not the file itself — compare
            # against the right one, or every loose .py in custom_nodes reads as a failure.
            recorded = os.path.dirname(real) if is_file else real
            if disabled:
                state = "disabled"
            elif loaded.get(module) == recorded:
                state = "loaded"
            else:
                state = "failed"

            pack: dict[str, Any] = {
                "module": module,
                "python_module": f"custom_nodes.{module}",
                "path": real,
                "kind": "file" if is_file else "dir",
                "state": state,
                "web": _web_dirs_under(path) if state == "loaded" else [],
                "project": _pyproject(path) if not is_file else {},
                "git": _git(path) if not is_file else {},
            }
            if state == "loaded":
                pack.update(_pack_nodes(path, is_file, pack["python_module"], declared_idx, owners))
            else:
                pack.update({"declared": [], "nodes": [], "shadowed": [], "undeclared": [], "style": "none"})
            packs.append(pack)

    return {
        "ok": True,
        "packs": packs,
        "server": {
            "python": sys.version.split()[0],
            "roots": _roots(),
            "total_nodes": len(owners),
        },
    }


if _routes is not None:

    @_routes.get("/zeninspector/inspect")
    async def zeninspector_inspect(_request):
        try:
            return web.json_response(_scan())
        except Exception as e:  # never let the debug panel take the server down
            return web.json_response({"ok": False, "error": str(e), "packs": []}, status=200)

    print("[ZenInspector] introspection route registered at /zeninspector/inspect")
