"""Zen Agent's HTTP routes (also served under /api by ComfyUI):

GET  /zenagent/settings                endpoint, model, limits, whether a key is set
PUT  /zenagent/settings                save any of llm_url, model, api_key, max_tokens, max_steps,
                                       max_runs, vision, ask_before_actions
GET  /zenagent/models                  chat models the endpoint offers
GET  /zenagent/threads                 saved conversations, newest first
GET  /zenagent/threads/{id}            one conversation's messages
DELETE /zenagent/threads/{id}
POST /zenagent/threads/{id|new}/messages  {content, client_id, turn_id, workflow, tools} -> {thread_id, turn_id}
POST /zenagent/turns/{turn_id}/cancel  {client_id}
POST /zenagent/approvals/{token}       the user's decision on a call: {client_id, decision}
POST /zenagent/tools/{token}           a tool's result from the browser: {client_id, ok, result | error}

Every route runs guard.request_allowed first (Host, Origin and JSON content type checks).
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid

import aiohttp
from aiohttp import web

from . import agent, store
from . import config as agent_config
from .context import summarize_workflow
from .guard import request_allowed
from .llm import list_models
from .tools import capability_tools

try:
    from server import PromptServer

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    _routes = None
    print(f"[ZenAgent] routes unavailable: {e}")

OBJECT_INFO_SECONDS = 300
_object_info: tuple[float, dict] | None = None


def _own_origin() -> str:
    """This ComfyUI, reached over loopback on its own port (never the request's Host)."""
    try:
        from comfy.cli_args import args

        port, tls = args.port, bool(args.tls_keyfile and args.tls_certfile)
        listen = [a.strip().strip("[]") for a in str(args.listen or "").split(",") if a.strip()]
    except (ImportError, AttributeError):
        port, tls, listen = 8188, False, []
    loopback = not listen or any(a in ("0.0.0.0", "::", "127.0.0.1", "localhost", "::1") for a in listen)
    host = "127.0.0.1" if loopback else listen[0]
    host = f"[{host}]" if ":" in host else host
    return f"{'https' if tls else 'http'}://{host}:{port}"


async def node_definitions() -> dict | None:
    """ComfyUI's /object_info from this server, kept for a few minutes."""
    global _object_info
    if _object_info and time.monotonic() - _object_info[0] < OBJECT_INFO_SECONDS:
        return _object_info[1]
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            async with session.get(f"{_own_origin()}/object_info", ssl=False) as res:
                if res.status == 200:
                    data = await res.json()
                    if isinstance(data, dict):
                        _object_info = (time.monotonic(), data)
    except (aiohttp.ClientError, TimeoutError, ValueError):
        pass
    return _object_info[1] if _object_info else None


MAX_IMAGES = 6
TURN_ID = re.compile(r"^[0-9a-fA-F-]{8,64}$")


def _attachments(raw: object) -> list[dict]:
    """The media the user attached to a message: refs, kind and label only. No URL is kept; the
    panel rebuilds one from the ref."""
    out = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict) and isinstance(item.get("ref"), str):
            kept = {k: str(item[k])[:500] for k in ("ref", "kind", "label") if isinstance(item.get(k), str)}
            if kept.get("kind") not in ("image", "video", "audio"):
                kept["kind"] = "image"
            out.append(kept)
    return out[:20]


def _settings_view() -> dict:
    c = agent_config.load()
    return {
        "llm_url": c.base_url,
        "model": c.model,
        "max_tokens": c.max_tokens,
        "max_steps": c.max_steps,
        "max_runs": c.max_runs,
        "vision": c.vision,
        "ask_before_actions": c.ask_before_actions,
        "has_key": bool(c.api_key),
    }


async def _json(request: web.Request) -> dict | None:
    try:
        body = await request.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _client_connected(client_id: str) -> bool:
    sockets = getattr(PromptServer.instance, "sockets", None) if _routes is not None else None
    return sockets is None or client_id in sockets


def _bad(message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": message}, status=status)


async def get_settings(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    return web.json_response(_settings_view())


async def put_settings(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    body = await _json(request)
    if body is None:
        return _bad("expected a JSON object")
    if agent_config.config_path() is None:
        return _bad("no user directory", 500)
    try:
        agent_config.write_file(agent_config.apply_settings(agent_config.read_file(), body))
    except agent_config.SettingsError as e:
        return _bad(str(e))
    return web.json_response(_settings_view())


async def get_models(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    return web.json_response({"models": await list_models(agent_config.load())})


async def get_threads(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    return web.json_response({"threads": store.summaries()})


async def get_thread(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    thread = store.load(request.match_info["thread_id"])
    return web.json_response(thread) if thread else _bad("not found", 404)


async def delete_thread(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    thread_id = request.match_info["thread_id"]
    if thread_id in agent.busy_threads:
        return _bad("a reply is still running in this conversation", 409)
    store.delete(thread_id)
    return web.json_response({"deleted": True})


async def post_message(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    body = await _json(request)
    if body is None:
        return _bad("expected a JSON object")
    content = str(body.get("content") or "").strip()
    if not content:
        return _bad("empty message")
    client_id = body.get("client_id")
    if not isinstance(client_id, str) or not client_id or not _client_connected(client_id):
        return _bad("client_id must name this browser's live ComfyUI connection; reload the page")
    if agent.turns_of(client_id) >= agent.MAX_TURNS_PER_CLIENT:
        return _bad(f"at most {agent.MAX_TURNS_PER_CLIENT} replies can run at once", 429)
    requested = request.match_info["thread_id"]
    thread = (store.load(requested) if requested != "new" else None) or store.new_thread(content)
    if thread["id"] in agent.busy_threads:
        return _bad("a reply is still running in this conversation", 409)
    # The browser names the turn, so it can match events that beat this response back.
    turn_id = str(body.get("turn_id") or "")
    if not TURN_ID.match(turn_id) or turn_id in agent.turns:
        turn_id = str(uuid.uuid4())
    # From here to the task's start nothing awaits, so the thread is claimed atomically.
    agent.busy_threads.add(thread["id"])
    turn = agent.Turn(id=turn_id, client_id=client_id, thread_id=thread["id"])
    agent.turns[turn_id] = turn
    try:
        message: dict = {"role": "user", "content": content}
        attachments = _attachments(body.get("attachments"))
        if attachments:
            message["attachments"] = attachments
        thread["messages"].append(message)
        images = [i for i in body.get("images") or [] if isinstance(i, str) and i.startswith("data:image/")][:MAX_IMAGES]
        store.save(thread)
        tools, writes = capability_tools(body.get("tools"))
        workflow = body.get("workflow")
    except BaseException:
        agent.busy_threads.discard(thread["id"])
        agent.turns.pop(turn_id, None)
        raise

    async def start() -> None:
        summary = summarize_workflow(workflow, await node_definitions())
        await agent.run_turn(thread, turn, summary, images, tools, writes)

    turn.task = asyncio.get_running_loop().create_task(start())
    return web.json_response({"thread_id": thread["id"], "turn_id": turn_id})


async def post_cancel(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    body = await _json(request) or {}
    cancelled = agent.cancel(request.match_info["turn_id"], body.get("client_id"))
    return web.json_response({"cancelled": cancelled}, status=200 if cancelled else 404)


async def post_approval(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    body = await _json(request) or {}
    decision = body.get("decision")
    if decision not in ("approve", "deny", "allow_turn"):
        return _bad("decision must be approve, deny or allow_turn")
    accepted = agent.resolve(request.match_info["token"], body.get("client_id"), "approval", decision)
    return web.json_response({"accepted": accepted}, status=200 if accepted else 404)


async def post_tool_result(request: web.Request) -> web.Response:
    if denied := request_allowed(request):
        return denied
    body = await _json(request)
    if body is None:
        return _bad("expected a JSON object")
    client_id = body.pop("client_id", None)
    accepted = agent.resolve(request.match_info["token"], client_id, "result", body)
    return web.json_response({"accepted": accepted}, status=200 if accepted else 404)


def register(routes: web.RouteTableDef) -> None:
    routes.get("/zenagent/settings")(get_settings)
    routes.put("/zenagent/settings")(put_settings)
    routes.get("/zenagent/models")(get_models)
    routes.get("/zenagent/threads")(get_threads)
    routes.get("/zenagent/threads/{thread_id}")(get_thread)
    routes.delete("/zenagent/threads/{thread_id}")(delete_thread)
    routes.post("/zenagent/threads/{thread_id}/messages")(post_message)
    routes.post("/zenagent/turns/{turn_id}/cancel")(post_cancel)
    routes.post("/zenagent/approvals/{token}")(post_approval)
    routes.post("/zenagent/tools/{token}")(post_tool_result)


if _routes is not None:
    register(_routes)
