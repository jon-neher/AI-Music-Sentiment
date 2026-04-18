"""Dual-stack (IPv4 + IPv6) uvicorn launcher.

Why not just `uvicorn --host :: --port $PORT`?

Railway's private network is IPv6-only (hostnames resolve to AAAA records
in the fd12::/32 range) while the public edge and Railway's healthcheck
probe come in over IPv4. Uvicorn's default socket-creation path does not
clear the IPV6_V6ONLY socket option, and the container kernel defaults it
to 1, so `--host ::` ends up listening on IPv6 only -- healthcheck fails
and the deploy is rolled back (this actually happened during deploy
a5d92a89-...).

We pre-create an AF_INET6 socket with IPV6_V6ONLY disabled, which on
Linux makes it accept both IPv6 and IPv4-mapped-IPv6 connections, then
hand the fd to uvicorn. Net effect: one listener, both families.
"""
from __future__ import annotations

import os
import socket
import sys

import uvicorn


def _build_dualstack_socket(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    except (AttributeError, OSError) as exc:
        # Extremely unlikely on Linux; log and continue so at least IPv6 works.
        print(f"warn: could not disable IPV6_V6ONLY ({exc}); IPv4 may be unreachable", file=sys.stderr)
    sock.bind(("::", port))
    sock.listen(128)
    sock.set_inheritable(True)
    return sock


def main() -> None:
    port = int(os.environ.get("PORT") or 8000)
    sock = _build_dualstack_socket(port)
    print(f"serve: dual-stack listener on port {port} (IPv4 + IPv6), pid={os.getpid()}", flush=True)

    # fd takes precedence over host/port in uvicorn.Config, so we don't need
    # to (and shouldn't) pass --host/--port here.
    uvicorn.run(
        "app.main:app",
        fd=sock.fileno(),
        log_level=os.environ.get("UVICORN_LOG_LEVEL", "info"),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
