"""Zen Agent's HTTP routes (also served under /api by ComfyUI):

GET  /zenagent/settings                endpoint, model, max_tokens, whether a key is set
PUT  /zenagent/settings                save any of llm_url, model, api_key, max_tokens
GET  /zenagent/models                  chat models the endpoint offers
GET  /zenagent/threads                 saved conversations, newest first
GET  /zenagent/threads/{id}            one conversation's messages
DELETE /zenagent/threads/{id}
POST /zenagent/threads/{id|new}/messages  {content, client_id, turn_id, workflow, tools} -> {thread_id, turn_id}
POST /zenagent/turns/{turn_id}/cancel
POST /zenagent/tools/{call_id}         a tool's result from the browser: {ok, result | error}
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import aiohttp
from aiohttp import web

from . import agent, store
from . import config as agent_config
from .context import summarize_workflow
from .tools import capability_tools
from .llm import list_models

try:
    from server import PromptServer

    _routes = PromptServer.instance.routes
except Exception as e:  # pragma: no cover - only outside a running server
    _routes = None
    print(f"[ZenAgent] routes unavailable: {e}")

_object_info: dict | None = None


async def node_definitions(origin: str) -> dict | None:
    """ComfyUI's /object_info, fetched from this server once and kept."""
    global _object_info
    if _object_info is None:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                async with session.get(f"{origin}/object_info") as res:
                    if res.status == 200:
                        _object_info = await res.json()
        except (aiohttp.ClientError, TimeoutError):
            return None
    return _object_info


MAX_IMAGES = 6


def _attachments(raw: object) -> list[dict]:
    """The media the user attached to a message: refs, kind and label only (no image data)."""
    out = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict) and isinstance(item.get("ref"), str):
            out.append({k: str(item[k]) for k in ("ref", "kind", "label", "url") if isinstance(item.get(k), str)})
    return out[:20]


def _settings_view() -> dict:
    c = agent_config.load()
    return {
        "llm_url": c.base_url,
        "model": c.model,
        "max_tokens": c.max_tokens,
        "max_steps": c.max_steps,
        "vision": c.vision,
        "has_key": bool(c.api_key),
    }


if _routes is not None:

    @_routes.get("/zenagent/settings")
    async def _get_settings(request: web.Request) -> web.Response:
        return web.json_response(_settings_view())

    @_routes.put("/zenagent/settings")
    async def _put_settings(request: web.Request) -> web.Response:
        body = await request.json()
        path = agent_config.config_path()
        if path is None:
            return web.json_response({"error": "no user directory"}, status=500)
        current = {}
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                current = json.load(f)
        for key in ("llm_url", "model", "api_key", "max_tokens", "max_steps", "vision"):
            if key in body:
                current[key] = body[key]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
        return web.json_response(_settings_view())

    @_routes.get("/zenagent/models")
    async def _models(request: web.Request) -> web.Response:
        return web.json_response({"models": await list_models(agent_config.load())})

    @_routes.get("/zenagent/threads")
    async def _threads(request: web.Request) -> web.Response:
        return web.json_response({"threads": store.summaries()})

    @_routes.get("/zenagent/threads/{thread_id}")
    async def _thread(request: web.Request) -> web.Response:
        thread = store.load(request.match_info["thread_id"])
        return web.json_response(thread) if thread else web.json_response({"error": "not found"}, status=404)

    @_routes.delete("/zenagent/threads/{thread_id}")
    async def _delete_thread(request: web.Request) -> web.Response:
        store.delete(request.match_info["thread_id"])
        return web.json_response({"deleted": True})

    @_routes.post("/zenagent/threads/{thread_id}/messages")
    async def _post_message(request: web.Request) -> web.Response:
        body = await request.json()
        content = str(body.get("content") or "").strip()
        if not content:
            return web.json_response({"error": "empty message"}, status=400)
        thread = store.load(request.match_info["thread_id"]) or store.new_thread(content)
        message: dict = {"role": "user", "content": content}
        attachments = _attachments(body.get("attachments"))
        if attachments:
            message["attachments"] = attachments
        thread["messages"].append(message)
        images = [i for i in body.get("images") or [] if isinstance(i, str) and i.startswith("data:image/")][:MAX_IMAGES]
        store.save(thread)
        origin = f"{request.scheme}://{request.host}"
        summary = summarize_workflow(body.get("workflow"), await node_definitions(origin))
        # The browser names the turn, so it can match events that beat this response back.
        requested = str(body.get("turn_id") or "")
        turn_id = requested if requested and requested not in agent.running_turns else str(uuid.uuid4())
        agent.running_turns[turn_id] = asyncio.get_running_loop().create_task(
            agent.run_turn(thread, turn_id, body.get("client_id"), summary, images, *capability_tools(body.get("tools")))
        )
        return web.json_response({"thread_id": thread["id"], "turn_id": turn_id})

    @_routes.post("/zenagent/turns/{turn_id}/cancel")
    async def _cancel(request: web.Request) -> web.Response:
        task = agent.running_turns.get(request.match_info["turn_id"])
        if task:
            task.cancel()
        return web.json_response({"cancelled": task is not None})

    @_routes.post("/zenagent/tools/{call_id}")
    async def _tool_result(request: web.Request) -> web.Response:
        accepted = agent.resolve_tool(request.match_info["call_id"], await request.json())
        return web.json_response({"accepted": accepted}, status=200 if accepted else 404)
