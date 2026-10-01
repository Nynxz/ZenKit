"""The agent loop. A turn streams the model's reply; when the model calls tools, each call is
sent to the browser that started the turn (it owns the live graph), the result comes back via
POST /zenagent/tools/{call_id}, and the model continues with it, up to the configured
max_steps model calls.

Events go to that browser over ComfyUI's own websocket as the `zenagent` message:
  {type: "turn_start" | "text" | "thinking" | "tool" | "tool_request" | "notice" | "turn_end",
   thread_id, turn_id, ...}
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid

from . import config as agent_config
from . import store
from .llm import supports_vision, resolve_model, stream_chat
from .tools import CAPABILITY_TIMEOUT, TOOL_TIMEOUTS, TOOLS

try:
    from server import PromptServer
except Exception:  # pragma: no cover - outside ComfyUI
    PromptServer = None

EVENT = "zenagent"
REPEATED_FAILURES = 3  # the same failing call this many times ends the turn
TOOL_TIMEOUT = 60
FLUSH_SECONDS = 0.04

SYSTEM_PROMPT = """You are Zen Agent, an assistant inside ComfyUI. You help the user understand, build, edit and run their workflow, and use the panels and plugins they have installed.
Graph tools act on the open workflow: read_workflow, find_node_types, add_node, set_widget, connect, disconnect, remove_node, move_node, check_layout.
- Reuse what is already in the workflow (an existing Load Image, loader or encoder) instead of adding another; add a node only when nothing there does the job, and remove nodes you added that end up unused.
- connect replaces whatever was linked to that input before; don't disconnect it first or afterwards.
- New nodes are placed automatically next to whatever you connect them to, so connect each new node right after adding it, and don't move nodes yourself. When the user asks for a tidier or rearranged workflow, look at it with view_layout, then use tidy_layout or move_node, and view_layout again to check the result.
Running: queue_prompt runs the workflow. To make several versions (different prompts, seeds, sizes), pass one entry per version in `variations` rather than editing the graph between runs; it waits for them all. With wait=false you can keep working and call wait_for_runs later. If a result is not what was asked for, change things and run again until it is.
Media: images, videos and audio are named by media refs, e.g. output/ComfyUI_00012_.png. Run results list each output's ref and the node_id of the node that saved it; use_as_input loads a ref into a loader node so one result can feed the next step. look_at shows you images yourself (when the model can see): use it to check results. To find media, use media_list (ComfyUI's recent outputs or inputs) or a plugin's search (e.g. stash_search); never guess file names.
Workflows: graph tools and runs act on the active workflow tab. workflows_list shows the open tabs and saved workflows; workflows_open switches tabs or opens a saved one; workflows_new opens a blank one; workflows_templates finds ready-made workflows (e.g. "image edit") and workflows_open_template opens one. After switching, call read_workflow before editing: node ids differ per workflow. To chain steps (e.g. generate an image, then edit it): run the first workflow, switch to or open the second, load the first result into its loader with use_as_input, set its prompt, and run it.
Other tools come from ZenKit and its plugins (named like panels_list or viewer_show): panels_list shows what is open on screen, what each panel shows and the commands it accepts; viewer_show puts media in Media Viewer panels.
Be concise and use Markdown."""

EDIT_TOOLS = {"add_node", "set_widget", "connect", "disconnect", "remove_node", "move_node", "queue_prompt"}
# A reply that reports an edit while no edit tool ran this turn gets one nudge to make it.
CLAIMS_EDIT = re.compile(r"\b(changed|set (?:it |the )?\w* ?to|updated|added|connected|removed|replaced)\b", re.I)
NUDGE = (
    "You described a change, but no edit tool was called this turn, so the workflow is unchanged. "
    "Make the change now with the tools, then report what the tool results show."
)
# Reasoning models sometimes end a turn having only thought; this asks for the answer once.
ASK_FOR_REPLY = "Reply to the user now, briefly, with what you did or found."

pending_tools: dict[str, asyncio.Future] = {}
running_turns: dict[str, asyncio.Task] = {}


def send(client_id: str | None, payload: dict) -> None:
    if PromptServer is not None:
        PromptServer.instance.send_sync(EVENT, payload, client_id)


class Batcher:
    """Collects a token stream and sends it on in small batches, not one frame a token."""

    def __init__(self, flush):
        self._flush = flush
        self.pending = ""
        self.handle: asyncio.TimerHandle | None = None

    def push(self, text: str) -> None:
        self.pending += text
        if self.handle is None:
            self.handle = asyncio.get_running_loop().call_later(FLUSH_SECONDS, self.flush)

    def flush(self) -> None:
        if self.handle:
            self.handle.cancel()
            self.handle = None
        if self.pending:
            text, self.pending = self.pending, ""
            self._flush(text)


async def call_tool(client_id: str | None, emit, call_id: str, name: str, args: dict, timeout: float) -> dict:
    future = asyncio.get_running_loop().create_future()
    pending_tools[call_id] = future
    emit("tool_request", call_id=call_id, name=name, args=args)
    try:
        return await asyncio.wait_for(future, timeout)
    except asyncio.TimeoutError:
        return {"ok": False, "error": "The browser did not answer in time."}
    finally:
        pending_tools.pop(call_id, None)


def resolve_tool(call_id: str, result: dict) -> bool:
    future = pending_tools.get(call_id)
    if future is None or future.done():
        return False
    future.set_result(result)
    return True


def for_model(messages: list[dict], current: dict | None, images: list[str], vision: bool) -> list[dict]:
    """The conversation as the model is sent it: only the fields it knows, attached media named
    by ref in the text, and this turn's attached images included when the model can see."""
    out = []
    for m in messages:
        msg = {k: v for k, v in m.items() if k in ("role", "content", "tool_calls", "tool_call_id")}
        attached = m.get("attachments")
        if attached:
            text = (m.get("content") or "") + "\n\nAttached media: " + ", ".join(
                f"{a['ref']} ({a.get('kind', 'image')})" for a in attached
            )
            msg["content"] = (
                [{"type": "text", "text": text}, *({"type": "image_url", "image_url": {"url": u}} for u in images)]
                if m is current and vision and images
                else text
            )
        out.append(msg)
    return out


NO_VISION = (
    "The model in use can't see images. Load a vision model in LM Studio (e.g. a Qwen VL or Gemma model), "
    "or turn Vision on in the agent settings if this model supports it."
)


async def run_turn(
    thread: dict,
    turn_id: str,
    client_id: str | None,
    workflow_summary: str | None,
    images: list[str],
    extra_tools: list[dict],
    extra_writes: set[str],
) -> None:
    def emit(event_type: str, **data) -> None:
        send(client_id, {"type": event_type, "thread_id": thread["id"], "turn_id": turn_id, **data})

    emit("turn_start")
    status, error, usage = "done", None, None
    nudge_message = {"role": "user", "content": NUDGE}
    reply_message = {"role": "user", "content": ASK_FOR_REPLY}
    # Images look_at showed the model; sent for the rest of this turn, not kept in the thread.
    looks: list[dict] = []
    current = thread["messages"][-1] if thread["messages"] else None
    try:
        settings = agent_config.load()
        model = await resolve_model(settings)
        if model is None:
            raise RuntimeError(
                f"No model reachable at {settings.base_url}. Start LM Studio's server (or Ollama), "
                "or set the endpoint in the panel's settings."
            )
        vision = await supports_vision(settings, model)
        tools = [*TOOLS, *extra_tools]
        extra_names = {t["function"]["name"] for t in extra_tools}

        def timeout_of(name: str) -> float:
            return TOOL_TIMEOUTS.get(name, CAPABILITY_TIMEOUT if name in extra_names else TOOL_TIMEOUT)

        system = SYSTEM_PROMPT + (f"\n\nThe workflow when the user sent this message:\n{workflow_summary}" if workflow_summary else "")
        edited, nudged, asked = False, False, False
        failures: dict[str, int] = {}
        stuck = False
        for _ in range(settings.max_steps):
            text, reasoning = Batcher(lambda d: emit("text", delta=d)), Batcher(lambda d: emit("thinking", delta=d))
            reply, calls = "", []
            async for kind, value in stream_chat(settings, model, [{"role": "system", "content": system}, *for_model(thread["messages"], current, images, vision)], tools):
                if kind == "text":
                    reply += value
                    text.push(value)
                elif kind == "reasoning":
                    reasoning.push(value)
                elif kind == "tool_calls":
                    calls = value
                else:
                    usage = value
            reasoning.flush()
            text.flush()
            message: dict = {"role": "assistant", "content": reply or None}
            if calls:
                for call in calls:
                    call["id"] = call["id"] or f"call_{uuid.uuid4().hex[:12]}"
                message["tool_calls"] = [
                    {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                    for c in calls
                ]
            if not calls and not reply:
                if asked:
                    emit("notice", text="The model finished without a written reply.")
                    break
                asked = True
                thread["messages"].append(reply_message)
                continue
            thread["messages"].append(message)
            if not calls:
                if edited or nudged or not CLAIMS_EDIT.search(reply):
                    break
                nudged = True
                thread["messages"].append(nudge_message)
                emit("notice", text="The model described a change without making it; asking it to make the change.")
                continue
            seen_images: list[str] = []
            for call in calls:
                try:
                    args = json.loads(call["arguments"] or "{}")
                except ValueError:
                    args = None
                emit("tool", call_id=call["id"], name=call["name"], args=args, status="running")
                if not isinstance(args, dict):
                    result = {"ok": False, "error": "Arguments were not valid JSON."}
                elif call["name"] in ("look_at", "view_layout") and not vision:
                    result = {"ok": False, "error": NO_VISION}
                else:
                    result = await call_tool(client_id, emit, call["id"], call["name"], args, timeout_of(call["name"]))
                seen = result.get("result", {}).pop("images", None) if isinstance(result.get("result"), dict) else None
                if seen:
                    seen_images.extend(seen)
                emit("tool", call_id=call["id"], name=call["name"], args=args, status="done" if result.get("ok") else "error", result=result)
                thread["messages"].append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
                edited = edited or ((call["name"] in EDIT_TOOLS or call["name"] in extra_writes) and bool(result.get("ok")))
                if not result.get("ok"):
                    key = call["name"] + (call["arguments"] or "")
                    failures[key] = failures.get(key, 0) + 1
                    stuck = stuck or failures[key] >= REPEATED_FAILURES
            if seen_images:
                look = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Here are the images you asked to look at, in order."},
                        *({"type": "image_url", "image_url": {"url": u}} for u in seen_images),
                    ],
                }
                looks.append(look)
                thread["messages"].append(look)
            if stuck:
                status, error = "error", "Stopped: the model kept repeating a call that fails."
                break
        else:
            status, error = "error", f"Stopped after {settings.max_steps} steps (raise Max steps in settings)."
    except asyncio.CancelledError:
        status = "cancelled"
    except Exception as e:  # reported in the panel rather than hanging the turn
        status, error = "error", str(e)
    finally:
        running_turns.pop(turn_id, None)
        # The nudges steered this turn only; they are not part of the conversation.
        transient = [nudge_message, reply_message, *looks]
        thread["messages"] = [m for m in thread["messages"] if not any(m is t for t in transient)]
        store.save(thread)
        emit("turn_end", status=status, error=error, usage=usage)
