"""Financial-year endpoints.

Two regressions covered:
  1. create_financial_year passed client_id, which FinancialYear does not have
     (FY is tenant-level — the statutory 1 Apr-31 Mar year is the same for every
     client company). SQLAlchemy raised TypeError, so the endpoint 500'd on
     every call and no FY could ever be created.
  2. activate_financial_year set is_active=True without clearing the others,
     leaving several "active" FYs and an ambiguous downstream selection.
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
from app.models import FinancialYear
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
    with patch("app.routes.audit_log", new=AsyncMock()):
        async with AsyncClient(
            transport=ASGITransport(app=employee_app), base_url="http://test"
        ) as ac:
            yield ac
    employee_app.dependency_overrides.clear()


def _hdr() -> dict:
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "tenant_id": str(TENANT_ID),
         "roles": ["ORG_ADMIN"], "email": "admin@test.com"},
        settings.jwt_secret, algorithm=settings.jwt_algorithm,
    )
    return {"Authorization": f"Bearer {token}", "x-client-id": str(CLIENT_ID)}


def _body(name: str, y: int, active: bool = True) -> dict:
    return {
        "name": name,
        "start_date": f"{y}-04-01",
        "end_date": f"{y + 1}-03-31",
        "is_active": active,
    }


@pytest.mark.asyncio
async def test_create_financial_year(client: AsyncClient):
    # Previously 500 (TypeError: 'client_id' is an invalid keyword argument).
    r = await client.post("/api/v1/financial-years", json=_body("FY 2025-26", 2025), headers=_hdr())
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "FY 2025-26"

    listed = await client.get("/api/v1/financial-years", headers=_hdr())
    assert listed.status_code == 200
    assert [f["name"] for f in listed.json()] == ["FY 2025-26"]


@pytest.mark.asyncio
async def test_activate_deactivates_the_others(client: AsyncClient, db: AsyncSession):
    a = await client.post("/api/v1/financial-years", json=_body("FY 2025-26", 2025), headers=_hdr())
    b = await client.post("/api/v1/financial-years", json=_body("FY 2026-27", 2026), headers=_hdr())
    assert a.status_code == 201 and b.status_code == 201

    # Activating one must leave exactly one active FY for the tenant.
    r = await client.patch(f"/api/v1/financial-years/{b.json()['id']}/activate", headers=_hdr())
    assert r.status_code == 200, r.text

    rows = (await db.scalars(select(FinancialYear).where(FinancialYear.tenant_id == TENANT_ID))).all()
    active = [f for f in rows if f.is_active]
    assert len(active) == 1
    assert str(active[0].id) == b.json()["id"]
