"""The request guard every state-changing /zenagent route runs first (the same rule as ZenKit's
nodekit `request_allowed`):

1. Host: when ComfyUI listens only on loopback, the Host header must name loopback too, which
   defeats DNS rebinding. When the user listens on other addresses, those are allowed as well, and
   so is this machine's own name (`mybox`, `mybox.local`): a rebinding page sends its own domain
   as the Host, never this machine's name. Listening on every interface (0.0.0.0, ::) allows any
   Host, since that exposure is their choice. Behind a reverse proxy, list the names it serves
   ComfyUI under in ZENKIT_ALLOWED_HOSTS (comma-separated); the proxy must pass the Host through.
2. Origin: when present, its host:port must equal the Host header.
3. Content type: a request with a body must be application/json, which a cross-site form can't
   send without a CORS preflight.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import socket
from urllib.parse import urlsplit

from aiohttp import web

LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1"}
WILDCARDS = {"", "0.0.0.0", "::"}
# This machine's own names. gethostname() asks no DNS server, so this can't stall the import.
OWN_NAMES = {socket.gethostname().lower(), f"{socket.gethostname().lower()}.local"}
_logged: set[str] = set()
log = logging.getLogger(__name__)


def _listen_addresses() -> list[str]:
    try:
        from comfy.cli_args import args

        listen = args.listen
    except (ImportError, AttributeError):  # outside ComfyUI: the default
        listen = "127.0.0.1"
    return [a.strip().strip("[]").lower() for a in str(listen or "").split(",")] or [""]


def _is_loopback(host: str) -> bool:
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _split_host(value: str, scheme: str = "http") -> tuple[str, int] | None:
    """`name:port` (or `[v6]:port`) → (lowercase name, port with the scheme's default)."""
    try:
        parts = urlsplit(f"{scheme}://{value}")
        port = parts.port
    except ValueError:
        return None
    if not parts.hostname:
        return None
    return parts.hostname.lower(), port or (443 if scheme == "https" else 80)


def _proxied_hosts() -> set[str]:
    """Names a reverse proxy serves ComfyUI under (ZENKIT_ALLOWED_HOSTS), ports dropped."""
    out = set()
    for name in os.environ.get("ZENKIT_ALLOWED_HOSTS", "").split(","):
        parsed = _split_host(name.strip()) if name.strip() else None
        if parsed:
            out.add(parsed[0])
    return out


def _host_allowed(hostname: str) -> bool:
    if hostname in _proxied_hosts():
        return True
    listen = _listen_addresses()
    if any(a in WILDCARDS for a in listen):
        return True
    if all(_is_loopback(a) for a in listen):
        return _is_loopback(hostname)
    return _is_loopback(hostname) or hostname in listen or hostname in OWN_NAMES


def _deny(request: web.Request, reason: str) -> web.Response:
    if request.path not in _logged:
        _logged.add(request.path)
        log.warning("[ZenAgent] refused %s %s: %s (logged once per path)", request.method, request.path, reason)
    return web.json_response({"error": f"Request refused: {reason}."}, status=403)


def request_allowed(request: web.Request) -> web.Response | None:
    """None when the request may proceed, else the 403 response to return."""
    host = _split_host(request.headers.get("Host", ""), request.scheme)
    if host is None or not _host_allowed(host[0]):
        named = f" {host[0]!r}" if host else ""
        where = ", ".join(a for a in _listen_addresses() if a) or "127.0.0.1"
        return _deny(
            request,
            f"unexpected Host{named}. Open ComfyUI at an address it listens on ({where}), add it "
            "to --listen, or (behind a proxy) to ZENKIT_ALLOWED_HOSTS",
        )
    origin = request.headers.get("Origin")
    if origin is not None:
        parts = urlsplit(origin)
        theirs = _split_host(parts.netloc, parts.scheme) if parts.scheme in ("http", "https") else None
        if theirs is None or theirs != _split_host(request.headers.get("Host", ""), parts.scheme):
            return _deny(request, "cross-origin request")
    has_body = request.body_exists or "Content-Type" in request.headers
    content_type = request.headers.get("Content-Type", "").split(";")[0].strip().lower()
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and has_body and content_type != "application/json":
        return _deny(request, "the body must be application/json")
    return None
