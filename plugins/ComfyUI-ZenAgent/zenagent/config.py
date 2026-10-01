"""Where Zen Agent's model lives. Read on every turn, so edits apply without a restart.

Sources, later winning: built-in defaults, environment variables (ZENAGENT_LLM_URL,
ZENAGENT_LLM_MODEL, ZENAGENT_LLM_KEY, ZENAGENT_MAX_TOKENS), then <user>/zenagent/config.json,
which the panel's settings write. The API key stays on the server; the browser never sees it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

try:
    import folder_paths
except Exception:  # pragma: no cover - outside ComfyUI
    folder_paths = None


@dataclass
class LlmConfig:
    base_url: str = "http://127.0.0.1:1234/v1"  # LM Studio's default server
    model: str | None = None  # None: the loaded model, else the first listed
    api_key: str | None = None
    max_tokens: int = 2048
    max_steps: int = 50  # model calls in one turn before it stops
    vision: str = "auto"  # whether the model is sent images: auto (ask LM Studio), on, off


def config_path() -> str | None:
    if folder_paths is None:
        return None
    return os.path.join(folder_paths.get_user_directory(), "zenagent", "config.json")


def load() -> LlmConfig:
    config = LlmConfig(
        base_url=os.environ.get("ZENAGENT_LLM_URL", LlmConfig.base_url),
        model=os.environ.get("ZENAGENT_LLM_MODEL") or None,
        api_key=os.environ.get("ZENAGENT_LLM_KEY") or None,
        max_tokens=int(os.environ.get("ZENAGENT_MAX_TOKENS", LlmConfig.max_tokens)),
        max_steps=int(os.environ.get("ZENAGENT_MAX_STEPS", LlmConfig.max_steps)),
    )
    path = config_path()
    if path and os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            config.base_url = str(data.get("llm_url") or config.base_url)
            if "model" in data:
                config.model = data["model"] or None
            config.api_key = data.get("api_key") or config.api_key
            config.max_tokens = int(data.get("max_tokens") or config.max_tokens)
            config.max_steps = int(data.get("max_steps") or config.max_steps)
            if data.get("vision") in ("auto", "on", "off"):
                config.vision = data["vision"]
        except (OSError, ValueError) as e:
            print(f"[ZenAgent] ignoring unreadable {path}: {e}")
    config.base_url = config.base_url.rstrip("/")
    return config
