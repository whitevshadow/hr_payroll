from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from hr_shared.auth import RequestContext

from app.auth import require_roles, require_tenant


def _ctx(tenant_id=None, roles=None):
    return RequestContext(
        user_id=uuid.uuid4(),
        tenant_id=tenant_id or uuid.uuid4(),
        roles=roles or [],
        email="u@example.com",
    )


class TestRequireTenant:
    @pytest.mark.asyncio
    async def test_returns_token_tenant_when_no_header(self):
        ctx = _ctx()
        assert await require_tenant(ctx=ctx, x_tenant_id=None) == ctx.tenant_id

    @pytest.mark.asyncio
    async def test_matching_header_allowed(self):
        ctx = _ctx()
        assert await require_tenant(ctx=ctx, x_tenant_id=ctx.tenant_id) == ctx.tenant_id

    @pytest.mark.asyncio
    async def test_mismatched_header_rejected(self):
        ctx = _ctx()
        with pytest.raises(HTTPException) as exc:
            await require_tenant(ctx=ctx, x_tenant_id=uuid.uuid4())
        assert exc.value.status_code == 403


class TestRequireRoles:
    @pytest.mark.asyncio
    async def test_allows_when_role_present(self):
        guard = require_roles("ORG_ADMIN")
        ctx = _ctx(roles=["ORG_ADMIN"])
        assert await guard(ctx=ctx) is ctx

    @pytest.mark.asyncio
    async def test_rejects_when_role_absent(self):
        guard = require_roles("ORG_ADMIN")
        with pytest.raises(HTTPException) as exc:
            await guard(ctx=_ctx(roles=["EMPLOYEE"]))
        assert exc.value.status_code == 403
