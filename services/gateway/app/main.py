"""Lightweight FastAPI reverse proxy.

Validates the JWT (except for public auth paths), injects ``x-tenant-id`` for
downstream services, and forwards the request to the matching backend.
"""

from __future__ import annotations

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from hr_shared import decode_token

from .settings import PUBLIC_PATHS, ROUTES, settings

app = FastAPI(title="gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

_client: httpx.AsyncClient | None = None

# Hop-by-hop headers that must not be forwarded.
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


@app.on_event("startup")
async def _startup() -> None:
    global _client
    _client = httpx.AsyncClient(timeout=30.0)


@app.on_event("shutdown")
async def _shutdown() -> None:
    if _client:
        await _client.aclose()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "gateway"}


def _resolve(path: str) -> str | None:
    for prefix, base in ROUTES:
        if path == prefix or path.startswith(prefix + "/"):
            return base
    return None


@app.api_route(
    "/api/v1/{full_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def proxy(full_path: str, request: Request) -> Response:
    assert _client is not None
    path = request.url.path
    base = _resolve(path)
    if base is None:
        return Response(content='{"detail":"No route"}', status_code=404,
                        media_type="application/json")

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }

    # Validate JWT and inject x-tenant-id for protected paths.
    if path not in PUBLIC_PATHS:
        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            return Response(content='{"detail":"Missing bearer token"}',
                            status_code=401, media_type="application/json")
        token = auth.split(" ", 1)[1]
        try:
            claims = decode_token(token, settings.jwt_secret, settings.jwt_algorithm)
        except Exception:
            return Response(content='{"detail":"Invalid token"}',
                            status_code=401, media_type="application/json")
        headers["x-tenant-id"] = str(claims.get("tenant_id", ""))
        headers["x-user-id"] = str(claims.get("sub", ""))

    body = await request.body()
    url = base + path
    try:
        upstream = await _client.request(
            request.method,
            url,
            headers=headers,
            content=body,
            params=request.query_params,
        )
    except httpx.RequestError as exc:
        return Response(
            content=f'{{"detail":"Upstream unavailable: {exc}"}}',
            status_code=502,
            media_type="application/json",
        )

    resp_headers = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )
