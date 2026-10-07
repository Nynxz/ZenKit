"""The tools the model can call. They act on the user's live graph, so the browser that sent
the turn runs them (graphTools.ts) and posts each result back; see agent.call_tool."""

from __future__ import annotations

import re


def _tool(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": required or []},
        },
    }


NODE_ID = {"type": "integer", "description": "A node id from read_workflow."}

TOOLS = [
    _tool(
        "read_workflow",
        "Read the current workflow: every node with its id, type, widget values, and the links between nodes. "
        "Nodes whose model files aren't installed here are marked not_installed. Call this before editing, after "
        "switching workflows, and after edits you need to check.",
    ),
    _tool(
        "find_models",
        "Find model files installed in this ComfyUI. With no arguments: the model folders and how many files each "
        "holds. With a type (a folder or a word for it: lora, checkpoint, diffusion/unet, vae, text_encoder/clip, "
        "upscale, controlnet, embedding, clip_vision…): that folder's files. With query: files whose path has those "
        "words, in any order (across every folder if no type). Results say which loader inputs take them (set_on). "
        "Use it to pick a model, or to replace one a workflow names that isn't installed.",
        {
            "type": {"type": "string", "description": "Model folder or a word for it, e.g. 'lora' or 'diffusion_models'."},
            "query": {"type": "string", "description": "Words to match in the file path, e.g. 'flux dev fp8'."},
            "limit": {"type": "integer", "description": "Most files to return (default 40, max 200)."},
        },
    ),
    _tool(
        "find_node_types",
        "Search the node types installed in this ComfyUI by name or category, with their inputs and outputs.",
        {"query": {"type": "string", "description": "Words to match, e.g. 'upscale model' or 'lora'."}},
        ["query"],
    ),
    _tool(
        "add_node",
        "Add a node of an installed type. Returns its id. It is placed for you: once you connect it, it moves "
        "next to the node it is wired to, so never move it yourself.",
        {
            "type": {"type": "string", "description": "Exact node type, e.g. 'KSampler'."},
            "widgets": {"type": "object", "description": "Widget values to set, by widget name."},
        },
        ["type"],
    ),
    _tool(
        "set_widget",
        "Set a widget value on a node, e.g. steps, seed, a prompt's text, or a model file name. A file name that is "
        "close to exactly one installed file (other case, no subfolder or extension) is matched to it; otherwise "
        "the error lists the closest options.",
        {"node_id": NODE_ID, "name": {"type": "string"}, "value": {"description": "The new value."}},
        ["node_id", "name", "value"],
    ),
    _tool(
        "connect",
        "Connect an output of one node to an input of another (replacing whatever fed that input).",
        {
            "from_node": NODE_ID,
            "output": {"type": "string", "description": "Output name or type, e.g. 'MODEL' or 'LATENT'."},
            "to_node": NODE_ID,
            "input": {"type": "string", "description": "Input name, e.g. 'model' or 'positive'."},
        },
        ["from_node", "output", "to_node", "input"],
    ),
    _tool(
        "disconnect",
        "Remove the link feeding an input.",
        {"node_id": NODE_ID, "input": {"type": "string"}},
        ["node_id", "input"],
    ),
    _tool(
        "remove_node",
        "Delete a node and its links. A node of the user's that still feeds others is kept unless force=true, "
        "which you only use when the user asked for that node to go.",
        {"node_id": NODE_ID, "force": {"type": "boolean"}},
        ["node_id"],
    ),
    _tool(
        "move_node",
        "Move a node so its top-left corner is at (x, y) in canvas units. Only when the user asks for a node in a "
        "particular place; new nodes are placed automatically.",
        {"node_id": NODE_ID, "x": {"type": "number"}, "y": {"type": "number"}},
        ["node_id", "x", "y"],
    ),
    _tool(
        "check_layout",
        "Check the layout of the nodes you added: overlaps (title bars included), the overall bounds, and any you "
        "added that are still connected to nothing (remove those unless the user wants them). New nodes are placed "
        "when your reply ends, so you rarely need this.",
    ),
    _tool(
        "resize_node",
        "Resize a node (canvas units), or fit=true to shrink it to its contents. It never goes below the size its "
        "contents need; if the new size would cover another node, it moves to the nearest free spot.",
        {"node_id": NODE_ID, "width": {"type": "number"}, "height": {"type": "number"}, "fit": {"type": "boolean"}},
        ["node_id"],
    ),
    _tool(
        "view_layout",
        "See the workflow's layout as a picture: every node a labelled box (#id title), wires coloured by type, "
        "overlapping nodes in red, nodes you added outlined in blue, with gridlines in canvas coordinates for "
        "move_node. Use it when arranging nodes, and again afterwards to check. Optionally only node_ids.",
        {"node_ids": {"type": "array", "items": {"type": "integer"}}},
    ),
    _tool(
        "tidy_layout",
        "Rearrange nodes into neat columns by data flow (inputs on the left, outputs on the right). Only when the "
        "user asks to tidy, clean up or arrange the workflow; for all nodes or just node_ids. The user can undo it.",
        {"node_ids": {"type": "array", "items": {"type": "integer"}}},
    ),
    _tool(
        "queue_prompt",
        "Run the workflow. To make several versions at once, pass `variations`: one entry per run, each a list of "
        "widget changes for that run only (the graph is left as it is). An empty list runs it unchanged. Example, "
        "three seeds: variations=[[{\"node_id\": 3, \"widget\": \"seed\", \"value\": 1}], "
        "[{\"node_id\": 3, \"widget\": \"seed\", \"value\": 2}], [{\"node_id\": 3, \"widget\": \"seed\", \"value\": 3}]]. "
        "By default it waits for every run and returns each one's status, error and outputs; with wait=false it "
        "returns the prompt ids at once so you can keep working and call wait_for_runs later.",
        {
            "variations": {
                "type": "array",
                "description": "One entry per run; each is a list of widget overrides for that run.",
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "node_id": {"type": "integer"},
                            "widget": {"type": "string"},
                            "value": {},
                        },
                        "required": ["node_id", "widget", "value"],
                    },
                },
            },
            "wait": {"type": "boolean", "description": "Wait for the runs to finish (default true)."},
        },
    ),
    _tool(
        "wait_for_runs",
        "Wait until queued runs finish and return their status, errors and output files.",
        {"prompt_ids": {"type": "array", "items": {"type": "string"}, "description": "Omit to wait for every unfinished run."}},
    ),
    _tool(
        "look_at",
        "See images (or a frame of a video) yourself: run outputs, Stash items, anything with a media ref. Use it to "
        "check a result against what the user asked before saying it is done. At most 4 at a time.",
        {"media": {"type": "array", "items": {"type": "string"}, "description": "Media refs to look at."}},
        ["media"],
    ),
    _tool(
        "use_as_input",
        "Load media into a loader node (LoadImage, LoadVideo, …): sets its file widget to the media ref, copying "
        "it into ComfyUI's input folder when needed. Use it to feed one run's output into the next workflow.",
        {
            "media": {"type": "string", "description": "A media ref, e.g. output/ComfyUI_00012_.png"},
            "node_id": NODE_ID,
            "widget": {"type": "string", "description": "The file widget; defaults to the node's first file widget."},
        },
        ["media", "node_id"],
    ),
]

# How long the browser has to answer each tool; a run can take minutes. A turn's own deadline
# (agent.TURN_SECONDS) bounds these too.
TOOL_TIMEOUTS = {"queue_prompt": 3600, "wait_for_runs": 3600}

# Tools that only read, which run without asking. Everything else (graph edits, runs, loading
# media into a node, and any capability that doesn't declare itself read-only) waits for the
# user's approval in the panel.
READ_TOOLS = {"read_workflow", "find_models", "find_node_types", "check_layout", "view_layout", "wait_for_runs", "look_at"}
CAPABILITY_TIMEOUT = 300
_TOOL_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def capability_tools(declared: object) -> tuple[list[dict], set[str]]:
    """Tools for the capabilities the browser has registered (sent with each message), and the
    names of those that may change things: declared `write`, or undeclared and not one of
    ZenKit's known readers. Malformed entries and clashes with built-ins are dropped."""
    builtin = {t["function"]["name"] for t in TOOLS}
    tools: list[dict] = []
    writes: set[str] = set()
    for item in (declared if isinstance(declared, list) else [])[:200]:
        if not isinstance(item, dict):
            continue
        name, description, params = item.get("name"), item.get("description"), item.get("parameters")
        if not isinstance(name, str) or not _TOOL_NAME.match(name) or name in builtin or not isinstance(description, str):
            continue
        schema = params if isinstance(params, dict) and params.get("type") == "object" else {"type": "object", "properties": {}}
        tools.append({"type": "function", "function": {"name": name, "description": description[:2000], "parameters": schema}})
        builtin.add(name)
        effect = item.get("effect")
        if effect != "read":
            writes.add(name)
    return tools, writes


def needs_approval(name: str, extra_names: set[str], writes: set[str]) -> bool:
    """Whether a call waits for the user: anything not known to only read."""
    if name in READ_TOOLS:
        return False
    return not (name in extra_names and name not in writes)


def run_count(args: dict) -> int:
    """How many runs a queue_prompt call would queue."""
    variations = args.get("variations")
    return len(variations) if isinstance(variations, list) and variations else 1
