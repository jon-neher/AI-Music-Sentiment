"""Entry point that binds uvicorn to a dual-stack (IPv4 + IPv6) socket.

Railway's private network (*.railway.internal) is IPv6-only, while its
healthcheck probe connects over IPv4 (127.0.0.1). Uvicorn's default
`--host ::` path can end up with IPV6_V6ONLY=1 depending on how the
socket is created, which means IPv4 probes are refused and the
deployment fails its healthcheck. We avoid that by opening the socket
ourselves with V6ONLY=0 and handing it to uvicorn.
"""
from __future__ import annotations

import os
import socket

import uvicorn


def make_dual_stack_socket(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind(("::", port))
    return sock


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    sock = make_dual_stack_socket(port)
    config = uvicorn.Config("app.main:app", log_level="info")
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
