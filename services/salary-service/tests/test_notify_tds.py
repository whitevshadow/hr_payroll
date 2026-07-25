"""Salary -> TDS auto-compute must send a usable bearer + client scope (M1).

_notify_tds previously sent only x-tenant-id/x-user-id, but the TDS
auto-compute endpoint requires a JWT bearer + x-client-id, so every call was
rejected 401 and swallowed (TDS never auto-populated). This asserts the call
now carries a bearer that decodes to the caller's identity, plus x-client-id.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from jose import jwt

from app import routes
from app.routes import _notify_tds
from app.settings import settings
from hr_shared import RequestContext

_captured: dict = {}


class _MockResp:
    status_code = 200
    text = "ok"


class _MockClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        _captured["url"] = url
        _captured["json"] = json
        _captured["headers"] = headers
        return _MockResp()


@pytest.mark.asyncio
async def test_notify_tds_forwards_bearer_and_client(monkeypatch):
    _captured.clear()
    monkeypatch.setattr(routes.httpx, "AsyncClient", _MockClient)

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    client_id = uuid.uuid4()
    ctx = RequestContext(
        user_id=user_id,
        tenant_id=tenant_id,
        roles=["PAYROLL_ADMIN"],
        email="admin@test.com",
        client_id=client_id,
    )
    structure_out = SimpleNamespace(
        employee_id=uuid.uuid4(),
        ctc="1200000",
        breakdown=SimpleNamespace(basic="40000", hra="20000", is_metro=True),
    )

    await _notify_tds(ctx, structure_out)

    headers = _captured["headers"]
    assert headers["x-client-id"] == str(client_id)

    auth = headers["Authorization"]
    assert auth.startswith("Bearer ")
    claims = jwt.decode(
        auth.split(" ", 1)[1],
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )
    assert claims["tenant_id"] == str(tenant_id)
    assert claims["sub"] == str(user_id)
    assert claims["roles"] == ["PAYROLL_ADMIN"]
