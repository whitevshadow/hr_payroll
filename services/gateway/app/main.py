"""Lightweight FastAPI reverse proxy.

Validates the JWT (except for public auth paths), injects ``x-tenant-id`` for
downstream services, and forwards the request to the matching backend.
"""

from __future__ import annotations

import time
import uuid

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from hr_shared import decode_token

from .settings import PUBLIC_PATHS, ROUTES, settings

# x-client-id ownership cache: (tenant_id, client_id) -> expiry epoch seconds.
# A client that belongs to a tenant does not change tenants, so a short TTL is
# safe and keeps the auth check off the hot path for repeat requests.
_CLIENT_CACHE_TTL = 60.0
_client_ownership_cache: dict[tuple[str, str], float] = {}

_JSON = "application/json"

app = FastAPI(title="gateway")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4050",
        "http://127.0.0.1:4050",
        "http://localhost:4000",
        "http://127.0.0.1:4000"
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

# Identity headers the gateway derives itself. They are stripped from every
# inbound request so a client can never spoof them (even on public paths where
# no JWT is validated); the gateway re-adds the trusted values downstream.
_IDENTITY_HEADERS = {"x-tenant-id", "x-user-id", "x-client-id"}


@app.on_event("startup")
async def _startup() -> None:
    global _client
    # Report downloads render PDFs on demand — a whole payroll cycle's payslips
    # can legitimately take minutes, and a proxy timeout surfaces as an opaque
    # 502 in the browser.
    _client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))


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


async def _client_belongs_to_tenant(
    tenant_id: str, client_id: str, auth_header: str
) -> bool:
    """Confirm ``client_id`` is a client of ``tenant_id``.

    The clients table is owned by client-service, which tenant-scopes its
    ``GET /clients/{id}`` lookup (404 when the client is not in the caller's
    tenant). We treat a 2xx as proof of ownership and cache the positive
    result briefly. Any other outcome — including a validator that is
    unreachable — fails closed so a spoofed ``x-client-id`` can never reach a
    downstream service.
    """
    assert _client is not None
    key = (tenant_id, client_id)
    now = time.monotonic()
    expiry = _client_ownership_cache.get(key)
    if expiry is not None and expiry > now:
        return True

    try:
        resp = await _client.get(
            f"{settings.client_url}/api/v1/clients/{client_id}",
            headers={
                "authorization": auth_header,
                "x-tenant-id": tenant_id,
            },
        )
    except httpx.RequestError:
        return False

    if resp.status_code == 200:
        _client_ownership_cache[key] = now + _CLIENT_CACHE_TTL
        return True
    return False


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
        if k.lower() not in _HOP_BY_HOP and k.lower() not in _IDENTITY_HEADERS
    }

    # Validate JWT and inject x-tenant-id for protected paths.
    if path not in PUBLIC_PATHS:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1]
        elif "token" in request.query_params:
            token = request.query_params["token"]
            headers["authorization"] = f"Bearer {token}"
        else:
            return Response(content='{"detail":"Missing bearer token"}',
                            status_code=401, media_type="application/json")
        try:
            claims = decode_token(token, settings.jwt_secret, settings.jwt_algorithm)
        except Exception:
            return Response(content='{"detail":"Invalid token"}',
                            status_code=401, media_type="application/json")
        tenant_id = str(claims.get("tenant_id", ""))
        headers["x-tenant-id"] = tenant_id
        headers["x-user-id"] = str(claims.get("sub", ""))

        # A client-scoped request carries x-client-id. It was stripped above (it
        # is attacker-controlled), so verify the client belongs to the caller's
        # tenant and only then re-add it downstream — otherwise a user could
        # reference another tenant's client company. client-service itself is
        # exempt from the check (validating a lookup against itself would
        # recurse); its own tenant scoping still applies, so its selector is
        # forwarded as-is.
        client_id = request.headers.get("x-client-id")
        if client_id:
            if base == settings.client_url:
                headers["x-client-id"] = client_id
            else:
                try:
                    uuid.UUID(client_id)
                except ValueError:
                    return Response(content='{"detail":"Invalid x-client-id"}',
                                    status_code=400, media_type=_JSON)
                if not await _client_belongs_to_tenant(tenant_id, client_id, auth):
                    return Response(
                        content='{"detail":"Client not found for tenant"}',
                        status_code=403, media_type=_JSON)
                headers["x-client-id"] = client_id

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
