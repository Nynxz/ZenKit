"""Where Zen Agent's model lives. Read on every turn, so edits apply without a restart.

Sources, later winning: built-in defaults, environment variables (ZENAGENT_LLM_URL,
ZENAGENT_LLM_MODEL, ZENAGENT_LLM_KEY, ZENAGENT_MAX_TOKENS, ZENAGENT_MAX_STEPS), then
<user>/zenagent/config.json, which the panel's settings write. The API key stays on the server;
the browser never sees it, and it is only ever sent to the endpoint it was saved for.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from urllib.parse import urlsplit

try:
    import folder_paths
except Exception:  # pragma: no cover - outside ComfyUI
    folder_paths = None

DEFAULT_URL = "http://127.0.0.1:1234/v1"  # LM Studio's default server
# Hard limits: settings outside them are refused, values read from disk are clamped.
LIMITS = {"max_tokens": (64, 32768), "max_steps": (1, 100), "max_runs": (1, 20)}
VISION = ("auto", "on", "off")


@dataclass
class LlmConfig:
    base_url: str = DEFAULT_URL
    model: str | None = None  # None: the loaded model, else the first listed
    api_key: str | None = None
    max_tokens: int = 2048
    max_steps: int = 50  # model calls in one turn before it stops
    vision: str = "auto"  # whether the model is sent images: auto (ask LM Studio), on, off
    max_runs: int = 4  # workflow runs one turn may queue
    ask_before_actions: bool = True  # the panel asks before every tool that changes something


def origin_of(url: str) -> str | None:
    """scheme://host:port of an http(s) URL, lowercased, or None when it isn't one."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return f"{parts.scheme}://{parts.hostname.lower()}:{port or (443 if parts.scheme == 'https' else 80)}"


def config_path() -> str | None:
    if folder_paths is None:
        return None
    return os.path.join(folder_paths.get_user_directory(), "zenagent", "config.json")


def _int(value, key: str, fallback: int) -> int:
    low, high = LIMITS[key]
    try:
        return min(max(int(value), low), high)
    except (TypeError, ValueError):
        return fallback


def read_file() -> dict:
    """config.json as saved, or {} when missing or unreadable."""
    path = config_path()
    if not path or not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as e:
        print(f"[ZenAgent] ignoring unreadable {path}: {e}")
        return {}


def write_file(data: dict) -> None:
    """Replace config.json atomically, readable only by this user (it may hold an API key)."""
    path = config_path()
    if path is None:
        raise OSError("no user directory")
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".config-", suffix=".tmp", dir=folder)  # created 0600
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def load() -> LlmConfig:
    env_url = os.environ.get("ZENAGENT_LLM_URL") or DEFAULT_URL
    config = LlmConfig(base_url=env_url, model=os.environ.get("ZENAGENT_LLM_MODEL") or None)
    config.max_tokens = _int(os.environ.get("ZENAGENT_MAX_TOKENS"), "max_tokens", config.max_tokens)
    config.max_steps = _int(os.environ.get("ZENAGENT_MAX_STEPS"), "max_steps", config.max_steps)
    data = read_file()
    url = data.get("llm_url")
    if isinstance(url, str) and origin_of(url):
        config.base_url = url.strip()
    if "model" in data:
        config.model = data["model"] if isinstance(data["model"], str) and data["model"] else None
    config.max_tokens = _int(data.get("max_tokens"), "max_tokens", config.max_tokens)
    config.max_steps = _int(data.get("max_steps"), "max_steps", config.max_steps)
    config.max_runs = _int(data.get("max_runs"), "max_runs", config.max_runs)
    if data.get("vision") in VISION:
        config.vision = data["vision"]
    if isinstance(data.get("ask_before_actions"), bool):
        config.ask_before_actions = data["ask_before_actions"]
    config.base_url = config.base_url.rstrip("/")
    # A key is bound to the endpoint it was saved for: never sent anywhere else.
    here = origin_of(config.base_url)
    saved = data.get("api_key")
    if isinstance(saved, str) and saved and (data.get("key_origin") or origin_of(str(url or ""))) == here:
        config.api_key = saved
    elif os.environ.get("ZENAGENT_LLM_KEY") and origin_of(env_url) == here:
        config.api_key = os.environ["ZENAGENT_LLM_KEY"]
    return config


class SettingsError(ValueError):
    pass


def _bounded_int(body: dict, key: str) -> int:
    value = body[key]
    low, high = LIMITS[key]
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise SettingsError(f"{key} must be a whole number from {low} to {high}")
    return value


def apply_settings(current: dict, body: object) -> dict:
    """The saved settings after a PUT body is applied; raises SettingsError on a bad value.
    Changing the endpoint's host clears the saved key unless a new one comes with it."""
    if not isinstance(body, dict):
        raise SettingsError("expected a JSON object")
    unknown = set(body) - {"llm_url", "model", "api_key", "max_tokens", "max_steps", "max_runs", "vision", "ask_before_actions"}
    if unknown:
        raise SettingsError(f"unknown setting(s): {', '.join(sorted(unknown))}")
    out = dict(current)
    before = origin_of(str(current.get("llm_url") or os.environ.get("ZENAGENT_LLM_URL") or DEFAULT_URL))
    if "llm_url" in body:
        url = body["llm_url"]
        if not isinstance(url, str) or len(url) > 2048 or not origin_of(url):
            raise SettingsError("llm_url must be an http:// or https:// URL")
        out["llm_url"] = url.strip().rstrip("/")
    if "model" in body:
        model = body["model"]
        if model is not None and (not isinstance(model, str) or len(model) > 256):
            raise SettingsError("model must be a name or null")
        out["model"] = model or None
    for key in ("max_tokens", "max_steps", "max_runs"):
        if key in body:
            out[key] = _bounded_int(body, key)
    if "vision" in body:
        if body["vision"] not in VISION:
            raise SettingsError(f"vision must be one of {', '.join(VISION)}")
        out["vision"] = body["vision"]
    if "ask_before_actions" in body:
        if not isinstance(body["ask_before_actions"], bool):
            raise SettingsError("ask_before_actions must be true or false")
        out["ask_before_actions"] = body["ask_before_actions"]
    after = origin_of(str(out.get("llm_url") or os.environ.get("ZENAGENT_LLM_URL") or DEFAULT_URL))
    if "api_key" in body:
        key = body["api_key"]
        if key is not None and (not isinstance(key, str) or len(key) > 4096):
            raise SettingsError("api_key must be a string")
        out["api_key"] = key or None
    elif after != before:
        out["api_key"] = None
    if out.get("api_key"):
        out["key_origin"] = after
    else:
        out.pop("key_origin", None)
        out.pop("api_key", None)
    return out
