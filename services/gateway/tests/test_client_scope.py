"""Gateway x-client-id ownership enforcement (issue C3).

A JWT is trusted for tenant_id, but x-client-id is attacker-controlled. The
gateway must confirm the client belongs to the caller's tenant (via
client-service) before forwarding the header downstream, and fail closed
otherwise.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app import main
from app.main import app
from app.settings import settings
from hr_shared import create_access_token


def _token(tenant_id: uuid.UUID) -> str:
    return create_access_token(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id,
        roles=["ORG_ADMIN"],
        secret=settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


class _MockHttpx:
    """Stand-in for the gateway's httpx.AsyncClient.

    `.get` answers the client-ownership lookup; `.request` is the downstream
    proxy call and records whether it was reached.
    """

    def __init__(self, lookup_status: int):
        self.lookup_status = lookup_status
        self.request_called = False

    async def get(self, url, headers=None):
        return httpx.Response(self.lookup_status)

    async def request(self, method, url, headers=None, content=None, params=None):
        self.request_called = True
        return httpx.Response(
            200, content=b'{"ok":true}', headers={"content-type": "application/json"}
        )


async def _call(mock: _MockHttpx, *, client_id: str | None):
    main._client = mock
    main._client_ownership_cache.clear()
    headers = {"authorization": f"Bearer {_token(uuid.uuid4())}"}
    if client_id is not None:
        headers["x-client-id"] = client_id
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://gw") as ac:
        return await ac.get(
            f"/api/v1/salary/structures/{uuid.uuid4()}", headers=headers
        )


@pytest.mark.asyncio
async def test_spoofed_client_id_is_rejected():
    mock = _MockHttpx(lookup_status=404)  # client not in caller's tenant
    resp = await _call(mock, client_id=str(uuid.uuid4()))
    assert resp.status_code == 403
    assert mock.request_called is False, "must not forward a spoofed x-client-id"


@pytest.mark.asyncio
async def test_owned_client_id_is_forwarded():
    mock = _MockHttpx(lookup_status=200)  # client belongs to tenant
    resp = await _call(mock, client_id=str(uuid.uuid4()))
    assert resp.status_code == 200
    assert mock.request_called is True


@pytest.mark.asyncio
async def test_malformed_client_id_is_rejected():
    mock = _MockHttpx(lookup_status=200)
    resp = await _call(mock, client_id="not-a-uuid")
    assert resp.status_code == 400
    assert mock.request_called is False


@pytest.mark.asyncio
async def test_request_without_client_id_passes_through():
    mock = _MockHttpx(lookup_status=404)
    resp = await _call(mock, client_id=None)
    assert resp.status_code == 200
    assert mock.request_called is True
