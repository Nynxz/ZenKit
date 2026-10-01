"""A streaming client for any OpenAI-compatible chat endpoint (LM Studio, Ollama, llama.cpp,
vLLM, a hosted API)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from urllib.parse import urlsplit

import aiohttp

from .config import LlmConfig


def _headers(config: LlmConfig) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    return headers


def _is_chat_model(model: dict) -> bool:
    model_id = model.get("id")
    return isinstance(model_id, str) and model.get("type") != "embeddings" and "embed" not in model_id.lower()


async def _get_json(session: aiohttp.ClientSession, url: str, config: LlmConfig) -> dict | None:
    try:
        async with session.get(url, headers=_headers(config), timeout=aiohttp.ClientTimeout(total=3)) as res:
            return await res.json() if res.status == 200 else None
    except (aiohttp.ClientError, TimeoutError, ValueError):
        return None


async def resolve_model(config: LlmConfig) -> str | None:
    """The configured model; else the one LM Studio has loaded (its /api/v0 listing reports
    load state); else the first chat model listed. None when the endpoint is unreachable."""
    if config.model:
        return config.model
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(config.base_url))
    async with aiohttp.ClientSession() as session:
        lm_studio = await _get_json(session, f"{origin}/api/v0/models", config)
        for model in (lm_studio or {}).get("data", []):
            if model.get("state") == "loaded" and _is_chat_model(model):
                return model["id"]
        listed = await _get_json(session, f"{config.base_url}/models", config)
        for model in (listed or {}).get("data", []):
            if _is_chat_model(model):
                return model["id"]
    return None


async def supports_vision(config: LlmConfig, model: str) -> bool:
    """Whether to send the model images: the vision setting, or on auto, whether LM Studio lists
    the model as a vision model (other servers don't say, so auto means no)."""
    if config.vision != "auto":
        return config.vision == "on"
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(config.base_url))
    async with aiohttp.ClientSession() as session:
        lm_studio = await _get_json(session, f"{origin}/api/v0/models", config)
    return any(m.get("id") == model and m.get("type") == "vlm" for m in (lm_studio or {}).get("data", []))


async def list_models(config: LlmConfig) -> list[str]:
    """Chat models the endpoint offers, for the panel's model picker."""
    async with aiohttp.ClientSession() as session:
        listed = await _get_json(session, f"{config.base_url}/models", config)
    return [m["id"] for m in (listed or {}).get("data", []) if _is_chat_model(m)]


async def stream_chat(
    config: LlmConfig, model: str, messages: list[dict], tools: list[dict] | None = None
) -> AsyncIterator[tuple[str, object]]:
    """Yields ("text", str) and ("reasoning", str) as they stream, then ("tool_calls", list)
    when the model asked for tools, and finally ("usage", dict | None). Streamed tool calls
    arrive as fragments keyed by index and are assembled here."""
    body = {
        "model": model,
        "messages": messages,
        "stream": True,
        "stream_options": {"include_usage": True},
        "max_tokens": config.max_tokens,
    }
    if tools:
        body["tools"] = tools
    usage = None
    calls: dict[int, dict] = {}
    timeout = aiohttp.ClientTimeout(total=None, sock_read=300)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(f"{config.base_url}/chat/completions", json=body, headers=_headers(config)) as res:
            if res.status != 200:
                raise RuntimeError(f"{res.status} {(await res.text())[:300]}")
            async for raw in res.content:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                chunk = json.loads(data)
                delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
                if delta.get("reasoning_content"):
                    yield "reasoning", delta["reasoning_content"]
                if delta.get("content"):
                    yield "text", delta["content"]
                for fragment in delta.get("tool_calls") or []:
                    call = calls.setdefault(fragment.get("index", 0), {"id": "", "name": "", "arguments": ""})
                    call["id"] = fragment.get("id") or call["id"]
                    function = fragment.get("function") or {}
                    call["name"] += function.get("name") or ""
                    call["arguments"] += function.get("arguments") or ""
                if chunk.get("usage"):
                    u = chunk["usage"]
                    usage = {"input_tokens": u.get("prompt_tokens"), "output_tokens": u.get("completion_tokens")}
    if calls:
        yield "tool_calls", [calls[i] for i in sorted(calls)]
    yield "usage", usage
