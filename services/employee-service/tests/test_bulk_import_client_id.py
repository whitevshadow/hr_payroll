"""Bulk employee import must persist client_id (issue H3).

Single-employee create sets client_id, but the bulk-import path omitted it, so
bulk-imported employees were invisible to the client-scoped employee listing
and to downstream payroll. This drives the real route under SQLite (with the
shared cross-schema audit_log patched out) and asserts the created rows carry
client_id.
"""
from __future__ import annotations

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.deps import get_session
from app.main import app as employee_app
from app.models import Employee
from app.settings import settings
from hr_shared import TenantAwareBase

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)

TENANT_ID = uuid.uuid4()
CLIENT_ID = uuid.uuid4()


@pytest_asyncio.fixture(autouse=True, scope="function")
async def _schema():
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.drop_all)


@pytest_asyncio.fixture
async def db() -> AsyncGenerator[AsyncSession, None]:
    async with _session_factory() as s:
        yield s


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override_session():
        yield db

    employee_app.dependency_overrides[get_session] = _override_session
    # audit_log writes to a separate "audit" schema that SQLite can't create;
    # it is orthogonal to this test, so patch it to a no-op.
    with patch("app.routes.audit_log", new=AsyncMock()):
        async with AsyncClient(
            transport=ASGITransport(app=employee_app), base_url="http://test"
        ) as ac:
            yield ac
    employee_app.dependency_overrides.clear()


def _hdr() -> dict:
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "tenant_id": str(TENANT_ID),
            "roles": ["ORG_ADMIN"],
            "email": "admin@test.com",
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return {"Authorization": f"Bearer {token}", "x-client-id": str(CLIENT_ID)}


@pytest.mark.asyncio
async def test_emp_code_is_unique_per_client_not_per_tenant(client: AsyncClient, db: AsyncSession):
    """Two client companies under one tenant may each have an employee "E001".

    The unique key used to be (tenant_id, emp_code), so the second client's E001
    was rejected as a duplicate — unusable for a bureau where every client runs
    its own code sequence.
    """
    other_client = uuid.uuid4()

    def _hdr_for(cid: uuid.UUID) -> dict:
        h = _hdr()
        h["x-client-id"] = str(cid)
        return h

    body = {"emp_code": "E001", "first_name": "Asha", "last_name": "Rao"}

    a = await client.post("/api/v1/employees", json=body, headers=_hdr_for(CLIENT_ID))
    assert a.status_code == 201, a.text
    b = await client.post("/api/v1/employees", json=body, headers=_hdr_for(other_client))
    assert b.status_code == 201, b.text

    rows = (await db.scalars(select(Employee).where(Employee.emp_code == "E001"))).all()
    assert {e.client_id for e in rows} == {CLIENT_ID, other_client}

    # ...but a duplicate within the SAME client is still rejected.
    dup = await client.post("/api/v1/employees", json=body, headers=_hdr_for(CLIENT_ID))
    assert dup.status_code == 409, dup.text


@pytest.mark.asyncio
async def test_bulk_import_persists_client_id(client: AsyncClient, db: AsyncSession):
    body = {
        "rows": [
            {"emp_code": "E1", "first_name": "Asha", "last_name": "Rao"},
            {"emp_code": "E2", "first_name": "Vik", "last_name": "Nair"},
        ]
    }
    r = await client.post("/api/v1/employees/bulk-import", json=body, headers=_hdr())
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2

    rows = (await db.scalars(select(Employee).where(Employee.tenant_id == TENANT_ID))).all()
    assert len(rows) == 2
    assert all(e.client_id == CLIENT_ID for e in rows), (
        "bulk-imported employees must carry client_id or they vanish from "
        "client-scoped listings and payroll"
    )
