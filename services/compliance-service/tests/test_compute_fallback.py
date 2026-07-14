"""Compliance /compute must not zero out deductions when no settings exist (H10).

With no ComplianceSetting row, the endpoint fell back to a transient object
whose *_enabled flags were None (column defaults are only applied on flush), so
PF/ESI/PT were all silently skipped and every employee got zero statutory
deductions. This drives the real endpoint with an empty settings table and
asserts the statutory defaults are applied instead.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.deps import get_session
from app.main import app as compliance_app
from app.models import ESIContribution, PFContribution, PTDeduction
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

    compliance_app.dependency_overrides[get_session] = _override_session
    async with AsyncClient(
        transport=ASGITransport(app=compliance_app), base_url="http://test"
    ) as ac:
        yield ac
    compliance_app.dependency_overrides.clear()


def _hdr() -> dict:
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "tenant_id": str(TENANT_ID),
            "roles": ["PAYROLL_ADMIN"],
            "email": "admin@test.com",
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    return {"Authorization": f"Bearer {token}", "x-client-id": str(CLIENT_ID)}


@pytest.mark.asyncio
async def test_compute_without_settings_applies_statutory_defaults(client: AsyncClient):
    body = {
        "employee_id": str(uuid.uuid4()),
        "cycle_id": str(uuid.uuid4()),
        "basic": "20000",
        "monthly_gross": "20000",
        "state": "Maharashtra",
        "month": 5,
        "ceiling_on": True,
        "client_id": str(CLIENT_ID),
    }
    r = await client.post("/api/v1/compliance/compute", json=body, headers=_hdr())
    assert r.status_code == 200, r.text
    data = r.json()
    # Before the fix all of these were 0 because the fallback disabled everything.
    assert Decimal(data["employee_pf"]) == Decimal("1800.00")   # 12% of 15000 ceiling
    assert Decimal(data["employee_esi"]) == Decimal("150.00")   # 0.75% of 20000
    assert data["is_esi_eligible"] is True
    assert Decimal(data["pt_amount"]) == Decimal("200.00")      # Maharashtra, regular month


# ── One contribution row per (tenant, employee, cycle) ──────────────────────

def _compute_body(emp: uuid.UUID, cycle: uuid.UUID) -> dict:
    return {
        "employee_id": str(emp), "cycle_id": str(cycle),
        "basic": "20000", "monthly_gross": "20000",
        "state": "Maharashtra", "month": 5, "ceiling_on": True,
        "client_id": str(CLIENT_ID),
    }


@pytest.mark.asyncio
async def test_recompute_does_not_duplicate_rows(client: AsyncClient, db: AsyncSession):
    """Re-running a cycle must leave one row per employee, not two.

    Duplicate contribution rows would double-count the statutory totals the
    summary endpoint reports (and that get filed).
    """
    emp, cycle = uuid.uuid4(), uuid.uuid4()
    for _ in range(2):
        r = await client.post(
            "/api/v1/compliance/compute", json=_compute_body(emp, cycle), headers=_hdr()
        )
        assert r.status_code == 200, r.text

    for model in (PFContribution, ESIContribution, PTDeduction):
        rows = (await db.scalars(
            select(model).where(model.tenant_id == TENANT_ID, model.cycle_id == cycle)
        )).all()
        assert len(rows) == 1, f"{model.__tablename__} duplicated on recompute"


@pytest.mark.asyncio
async def test_duplicate_contribution_row_is_rejected(db: AsyncSession):
    """The DB itself enforces one row per (tenant, employee, cycle)."""
    emp, cycle = uuid.uuid4(), uuid.uuid4()
    db.add(PFContribution(tenant_id=TENANT_ID, employee_id=emp, cycle_id=cycle))
    await db.commit()

    db.add(PFContribution(tenant_id=TENANT_ID, employee_id=emp, cycle_id=cycle))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
