"""A compact, model-readable summary of the workflow the panel sends with each turn
(`draft.content`, the canvas graph in the frontend's workflow format). Widget values are
labelled from ComfyUI's node definitions, so the model reads `steps=8` rather than a bare 8.
"""

from __future__ import annotations

import json

MAX_CHARS = 6000
MAX_VALUE_CHARS = 160
WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}
SEED_NAMES = {"seed", "noise_seed"}
CONTROL = " control"


def widget_names(object_info: dict, node_type: str) -> list[str] | None:
    """A node type's widget names in `widgets_values` order: its value inputs (required, then
    optional), each followed by the hidden "control after generate" value a seed carries."""
    definition = object_info.get(node_type)
    inputs = (definition or {}).get("input")
    if not inputs:
        return None
    names: list[str] = []
    for group in (inputs.get("required") or {}, inputs.get("optional") or {}):
        for name, spec in group.items():
            kind = spec[0] if isinstance(spec, (list, tuple)) and spec else None
            opts = spec[1] if isinstance(spec, (list, tuple)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
            if not isinstance(kind, list) and kind not in WIDGET_TYPES:
                continue
            names.append(name)
            if opts.get("control_after_generate") or (kind == "INT" and name in SEED_NAMES):
                names.append(name + CONTROL)
    return names


def _value(value) -> str:
    text = json.dumps(value)
    return text if len(text) <= MAX_VALUE_CHARS else text[:MAX_VALUE_CHARS] + "…"


def _describe(node: dict, object_info: dict | None) -> str:
    node_type, title = node.get("type"), node.get("title")
    name = f'{node_type} "{title}"' if title and title != node_type else node_type
    raw = node.get("widgets_values") if isinstance(node.get("widgets_values"), list) else []
    names = widget_names(object_info, node_type) if object_info and node_type else None
    # Values are labelled only when they line up with the node's widgets; a guess would mislead.
    if names and len(names) == len(raw):
        values = [f"{n}={_value(v)}" for n, v in zip(names, raw) if v not in (None, "") and not n.endswith(CONTROL)]
    else:
        values = [_value(v) for v in raw if v not in (None, "")]
    state = " (bypassed)" if node.get("mode") == 4 else " (muted)" if node.get("mode") == 2 else ""
    return f"- #{node.get('id')} {name}{state}" + (f": {', '.join(values)}" if values else "")


def summarize_workflow(content, object_info: dict | None) -> str | None:
    nodes = content.get("nodes") if isinstance(content, dict) else None
    if not isinstance(nodes, list) or not nodes:
        return None
    lines = [f"The user's current workflow has {len(nodes)} nodes:"]
    size = len(lines[0])
    for node in nodes:
        line = _describe(node, object_info)
        if size + len(line) > MAX_CHARS:
            lines.append(f"- … and {len(nodes) - len(lines) + 1} more")
            break
        lines.append(line)
        size += len(line)
    return "\n".join(lines)
