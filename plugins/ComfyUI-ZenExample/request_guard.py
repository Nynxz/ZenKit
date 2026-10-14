"""The request guard for this plugin's routes.

A copy of `request_allowed` from @nynxz/zenkit-nodekit's `server.py` (packages/nodekit/python),
kept standalone because ZenKit's plugins don't vendor nodekit's Python. Keep the two in step;
nodekit's docstring has the rules.

Every route that changes state, or reads the user's files or paths, starts with:

    if (denied := request_allowed(request)) is not None:
        return denied
"""

from __future__ import annotations

import json
import logging
import os
import socket
from urllib.parse import urlsplit

LOG_PREFIX = "[ZenExample]"

_LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})
_WILDCARD = frozenset({"", "0.0.0.0", "::"})
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443}
_logged: set[str] = set()


def _listen_hosts() -> frozenset[str] | None:
    """The host names a request may use, or None when ComfyUI listens on every interface."""
    try:
        from comfy.cli_args import args

        listen = str(getattr(args, "listen", "127.0.0.1") or "")
    except Exception:  # noqa: BLE001 - outside ComfyUI: assume its loopback default
        listen = "127.0.0.1"
    names = {part.strip().strip("[]").lower() for part in listen.split(",")}
    if names & _WILDCARD:
        return None
    names |= _proxied_hosts()
    if names - _LOOPBACK:
        # gethostname() asks no DNS server, so this can't stall a request.
        own = socket.gethostname().lower()
        names |= {own, f"{own}.local"}
    return _LOOPBACK | names


#: The ComfyUI setting (Settings > ZenKit > Security) with the names a reverse proxy serves ComfyUI
#: under. Read from the default user's settings file, and read again only when that file changes.
ALLOWED_HOSTS_SETTING = "ZenKit.Security.AllowedHosts"
_hosts_cache: tuple[float, set[str]] | None = None


def _proxied_hosts() -> set[str]:
    """Names a reverse proxy serves ComfyUI under (the Allowed host names setting), ports dropped."""
    global _hosts_cache
    try:
        import folder_paths

        path = os.path.join(folder_paths.get_user_directory(), "default", "comfy.settings.json")
        mtime = os.path.getmtime(path)
    except Exception:  # noqa: BLE001 - outside ComfyUI, or no settings saved yet
        return set()
    if _hosts_cache is not None and _hosts_cache[0] == mtime:
        return _hosts_cache[1]
    try:
        with open(path, encoding="utf-8") as f:
            raw = json.load(f).get(ALLOWED_HOSTS_SETTING, "")
    except (OSError, ValueError, AttributeError):
        raw = ""
    out = set()
    for name in str(raw or "").replace("\n", ",").split(","):
        parsed = _host_port(name.strip(), "http") if name.strip() else None
        if parsed:
            out.add(parsed[0])
    _hosts_cache = (mtime, out)
    return out


def _host_port(netloc: str, scheme: str) -> tuple[str, int | None] | None:
    """(hostname, port) from a Host header or an Origin's netloc; None when it doesn't parse."""
    try:
        parts = urlsplit(f"//{netloc}")
        host, port = parts.hostname, parts.port
    except ValueError:
        return None
    if not host or parts.username is not None or parts.path:
        return None
    return host.lower(), port if port is not None else _DEFAULT_PORTS.get(scheme)


def _deny(request, reason: str):
    from aiohttp import web

    if request.path not in _logged:
        _logged.add(request.path)
        logging.warning(
            "%s refused %s %s: %s (logged once per path)",
            LOG_PREFIX,
            request.method,
            request.path,
            reason,
        )
    return web.json_response({"error": f"forbidden: {reason}"}, status=403)


def request_allowed(request):
    """None when `request` may change state; else the 403 response to return. See the module
    docstring for the rules."""
    scheme = request.scheme
    host = _host_port(request.headers.get("Host", ""), scheme)
    if host is None:
        return _deny(request, "missing or malformed Host header")
    allowed = _listen_hosts()
    if allowed is not None and host[0] not in allowed:
        return _deny(
            request,
            f"Host {host[0]!r} is not an address this server listens on; open ComfyUI at one it "
            "does, add it to --listen, or (behind a proxy) to Settings > ZenKit > Security > Allowed host names",
        )

    origin = request.headers.get("Origin")
    if origin is not None:
        parts = urlsplit(origin)
        theirs = parts.scheme.lower()
        # The Host's default port follows the Origin's scheme: behind a proxy that ends TLS the
        # browser is on https while this server sees plain http.
        if _host_port(parts.netloc, theirs) != _host_port(request.headers.get("Host", ""), theirs):
            return _deny(request, "Origin does not match Host")

    if (
        request.method in _UNSAFE_METHODS
        and request.body_exists
        and request.content_type != "application/json"
    ):
        return _deny(request, "state-changing requests must send application/json")
    return None
