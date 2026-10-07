"""The request guard for this plugin's state-changing routes.

A copy of `request_allowed` from @nynxz/zenkit-nodekit's `server.py` (packages/nodekit/python),
kept standalone because ZenKit's plugins don't vendor nodekit's Python. Keep the two in step.

ComfyUI's own origin middleware stops cross-site pages but not DNS rebinding, and it never checks
the Content-Type. For a route that changes state (POST, PUT, PATCH, DELETE, or a GET with side
effects beyond a cache), `request_allowed(request)` returns None when the request may go ahead,
else the 403 to return:

1. Host: while ComfyUI listens only on loopback (the default), the Host header must name
   loopback (localhost, 127.0.0.1, [::1]). With `--listen <addr>` that address is allowed too;
   with a wildcard (`--listen` alone, 0.0.0.0, ::) the Host isn't checked, since the user chose
   to expose the server.
2. Origin: when present, its host:port must equal the Host header's.
3. Content type: a state-changing request with a body must send `application/json`, which a
   cross-site form can't without a CORS preflight.

    if (denied := request_allowed(request)) is not None:
        return denied
"""

from __future__ import annotations

import logging
from urllib.parse import urlsplit

from aiohttp import web

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
    return _LOOPBACK | names


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


def _deny(request: web.Request, reason: str) -> web.Response:
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


def request_allowed(request: web.Request) -> web.Response | None:
    """None when `request` may change state; else the 403 response to return."""
    scheme = request.scheme
    host = _host_port(request.headers.get("Host", ""), scheme)
    if host is None:
        return _deny(request, "missing or malformed Host header")
    allowed = _listen_hosts()
    if allowed is not None and host[0] not in allowed:
        return _deny(request, f"Host {host[0]!r} is not an address this server listens on")

    origin = request.headers.get("Origin")
    if origin is not None:
        parts = urlsplit(origin)
        if _host_port(parts.netloc, parts.scheme.lower()) != host:
            return _deny(request, "Origin does not match Host")

    if (
        request.method in _UNSAFE_METHODS
        and request.body_exists
        and request.content_type != "application/json"
    ):
        return _deny(request, "state-changing requests must send application/json")
    return None
