"""A streaming client for any OpenAI-compatible chat endpoint (LM Studio, Ollama, llama.cpp,
vLLM, a hosted API)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from urllib.parse import urlsplit

import aiohttp

from .config import LlmConfig

log = logging.getLogger(__name__)


class UpstreamError(RuntimeError):
    """A failure the panel may show as is: it carries no text from the endpoint."""


def _headers(config: LlmConfig, auth: bool = True) -> dict[str, str]:
    """Request headers; the key only goes with requests under the configured base URL."""
    headers = {"Content-Type": "application/json"}
    if config.api_key and auth:
        headers["Authorization"] = f"Bearer {config.api_key}"
    return headers


def _is_chat_model(model: dict) -> bool:
    model_id = model.get("id")
    return isinstance(model_id, str) and model.get("type") != "embeddings" and "embed" not in model_id.lower()


async def _get_json(session: aiohttp.ClientSession, url: str, config: LlmConfig, auth: bool = True) -> dict | None:
    try:
        async with session.get(url, headers=_headers(config, auth), timeout=aiohttp.ClientTimeout(total=3)) as res:
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
        # LM Studio's own listing sits outside the base path, so it is asked without the key.
        lm_studio = await _get_json(session, f"{origin}/api/v0/models", config, auth=False)
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
        lm_studio = await _get_json(session, f"{origin}/api/v0/models", config, auth=False)
    return any(m.get("id") == model and m.get("type") == "vlm" for m in (lm_studio or {}).get("data", []))


CHARS_PER_TOKEN = 3.5


def estimate_tokens(*parts: object) -> int:
    """A rough token count of text or JSON-able parts (about 3.5 characters a token): enough to
    tell 3,000 from 9,000, not to count exactly."""
    return int(sum(len(p) if isinstance(p, str) else len(json.dumps(p)) for p in parts) / CHARS_PER_TOKEN)


async def loaded_context(config: LlmConfig, model: str | None) -> int | None:
    """The context length LM Studio loaded `model` with (the loaded model's, for None). None when
    the endpoint isn't LM Studio or doesn't say. LM Studio loads models with a small context
    unless told otherwise, far below what the model supports."""
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(config.base_url))
    async with aiohttp.ClientSession() as session:
        listed = await _get_json(session, f"{origin}/api/v1/models", config, auth=False)
    for entry in (listed or {}).get("models") or []:
        if not isinstance(entry, dict):
            continue
        for instance in entry.get("loaded_instances") or []:
            names = {entry.get("key"), instance.get("id")}
            length = (instance.get("config") or {}).get("context_length")
            if isinstance(length, int) and (model is None or model in names):
                return length
    return None


async def probe(config: LlmConfig) -> tuple[list[str], str | None]:
    """The chat models the endpoint offers, or why it can't list them, in words the settings can
    show as is (no text from the endpoint itself)."""
    url = f"{config.base_url}/models"
    try:
        async with aiohttp.ClientSession() as session, session.get(
            url, headers=_headers(config), timeout=aiohttp.ClientTimeout(total=5)
        ) as res:
            if res.status in (401, 403):
                return [], "The server refused the API key." if config.api_key else "The server wants an API key."
            if res.status == 404:
                return [], f"Nothing answers at {url}. OpenAI-compatible servers usually end in /v1."
            if res.status >= 400:
                return [], f"The server answered HTTP {res.status}."
            body = await res.json(content_type=None)
    except aiohttp.ClientConnectorError:
        return [], "Couldn't connect. Is the server running, and is the address right?"
    except TimeoutError:
        return [], "The server didn't answer within 5 seconds."
    except (aiohttp.ClientError, ValueError):
        return [], "That doesn't look like an OpenAI-compatible endpoint."
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list):
        return [], "That doesn't look like an OpenAI-compatible endpoint."
    models = [m["id"] for m in data if isinstance(m, dict) and _is_chat_model(m)]
    if not models:
        return [], "Connected, but it lists no chat models. Load one in LM Studio, or pull one in Ollama."
    return models, None


async def stream_chat(
    config: LlmConfig, model: str, messages: list[dict], tools: list[dict] | None = None
) -> AsyncIterator[tuple[str, object]]:
    """Yields ("text", str) and ("reasoning", str) as they stream, then ("tool_calls", list)
    when the model asked for tools, ("finish", str) with the finish reason when the endpoint
    gave one ("length": it hit max_tokens), and finally ("usage", dict | None). Streamed tool
    calls arrive as fragments keyed by index and are assembled here."""
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
    finish = None
    calls: dict[int, dict] = {}
    # The turn's own deadline bounds the whole stream (agent.run_turn); this catches a stall.
    timeout = aiohttp.ClientTimeout(total=None, sock_read=300)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(f"{config.base_url}/chat/completions", json=body, headers=_headers(config)) as res:
            if res.status != 200:
                # The body stays in the server log: it may come from any URL the endpoint names.
                log.warning("[ZenAgent] model endpoint answered %s: %s", res.status, (await res.text())[:500])
                raise UpstreamError(f"The model endpoint answered HTTP {res.status}. Details are in the ComfyUI log.")
            async for raw in res.content:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                chunk = json.loads(data)
                choice = (chunk.get("choices") or [{}])[0]
                finish = choice.get("finish_reason") or finish
                delta = choice.get("delta") or {}
                # LM Studio and DeepSeek name it reasoning_content; Ollama, vLLM and newer LM
                # Studio builds, reasoning.
                thought = delta.get("reasoning_content") or delta.get("reasoning")
                if isinstance(thought, str) and thought:
                    yield "reasoning", thought
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
    if finish:
        yield "finish", finish
    yield "usage", usage
