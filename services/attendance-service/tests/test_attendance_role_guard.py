"""
Attendance service role-guard tests.

Threat model: a JWT-authenticated EMPLOYEE must be blocked from every
write endpoint in the attendance service. Only HR_MANAGER+ may write
attendance records; only ADMIN roles may unlock a locked month.

Matrix tested:
  Endpoint                        EMPLOYEE   HR_MANAGER  PAYROLL_ADMIN  ORG_ADMIN
  POST /manual                      403          200          200          200
  POST /bulk                        403          200          200          200
  POST /monthly/{m}/validate        403          200          200          200
  POST /monthly/{m}/lock            403          200          200          200
  POST /monthly/{m}/unlock          403          403          200          200
  GET  /monthly/{m}                 200          200          200          200  (read — open)
  GET  /{emp_id}/{m}                200          200          200          200  (read — open)
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.deps import get_session, runtime
from app.main import app as attendance_app
from app.models import AttendanceMonth, AttendanceRecord
from hr_shared import TenantAwareBase

# ---------------------------------------------------------------------------
# Schema + session setup
# ---------------------------------------------------------------------------

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)


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


# ---------------------------------------------------------------------------
# JWT helpers (no real secret needed — we override get_context)
# ---------------------------------------------------------------------------

TENANT_ID = uuid.uuid4()
JWT_SECRET = "test-secret"
JWT_ALG = "HS256"


def _token(roles: list[str], user_id: uuid.UUID | None = None) -> str:
    uid = user_id or uuid.uuid4()
    return jwt.encode(
        {
            "sub": str(uid),
            "tenant_id": str(TENANT_ID),
            "roles": roles,
            "email": "user@test.com",
        },
        JWT_SECRET,
        algorithm=JWT_ALG,
    )


# ---------------------------------------------------------------------------
# Client fixture with session + JWT secret overrides
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override_session():
        yield db

    attendance_app.dependency_overrides[get_session] = _override_session

    # Patch jwt_secret so decode_token accepts our test tokens.
    with patch.object(runtime.settings, "jwt_secret", JWT_SECRET), \
         patch.object(runtime.settings, "jwt_algorithm", JWT_ALG):
        async with AsyncClient(
            transport=ASGITransport(app=attendance_app),
            base_url="http://test",
        ) as ac:
            yield ac

    attendance_app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Shared payloads
# ---------------------------------------------------------------------------

MONTH = "2026-04"
EMP_ID = str(uuid.uuid4())

_MANUAL_BODY = {
    "employee_id": EMP_ID,
    "month": "2026-04-01",
    "total_days": 30,
    "present_days": 28,
    "cl_days": 0,
    "sl_days": 0,
    "pl_days": 0,
    "wo_days": 4,
    "holiday_days": 0,
    "wfh_days": 0,
    "overtime_hours": 0,
}

_BULK_BODY = {
    "month": "2026-04-01",
    "source": "CSV_UPLOAD",
    "records": [_MANUAL_BODY],
}

_LOCK_BODY = {"reason": "Payroll cut-off"}
_UNLOCK_BODY = {"reason": "Correction required"}


# ---------------------------------------------------------------------------
# Role tokens
# ---------------------------------------------------------------------------

EMPLOYEE_HDR = {"Authorization": f"Bearer {_token(['EMPLOYEE'])}"}
HR_MGR_HDR = {"Authorization": f"Bearer {_token(['HR_MANAGER'])}"}
PAYROLL_HDR = {"Authorization": f"Bearer {_token(['PAYROLL_ADMIN'])}"}
ORG_ADMIN_HDR = {"Authorization": f"Bearer {_token(['ORG_ADMIN'])}"}


# ---------------------------------------------------------------------------
# POST /manual
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manual_employee_blocked(client: AsyncClient):
    r = await client.post("/api/v1/attendance/manual", json=_MANUAL_BODY, headers=EMPLOYEE_HDR)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_manual_hr_manager_allowed(client: AsyncClient):
    r = await client.post("/api/v1/attendance/manual", json=_MANUAL_BODY, headers=HR_MGR_HDR)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_manual_payroll_admin_allowed(client: AsyncClient):
    r = await client.post("/api/v1/attendance/manual", json=_MANUAL_BODY, headers=PAYROLL_HDR)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_manual_org_admin_allowed(client: AsyncClient):
    r = await client.post("/api/v1/attendance/manual", json=_MANUAL_BODY, headers=ORG_ADMIN_HDR)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_manual_unauthenticated_blocked(client: AsyncClient):
    r = await client.post("/api/v1/attendance/manual", json=_MANUAL_BODY)
    assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# POST /bulk
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bulk_employee_blocked(client: AsyncClient):
    r = await client.post("/api/v1/attendance/bulk", json=_BULK_BODY, headers=EMPLOYEE_HDR)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_bulk_hr_manager_allowed(client: AsyncClient):
    r = await client.post("/api/v1/attendance/bulk", json=_BULK_BODY, headers=HR_MGR_HDR)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# POST /monthly/{month}/validate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_validate_employee_blocked(client: AsyncClient):
    r = await client.post(f"/api/v1/attendance/monthly/{MONTH}/validate", headers=EMPLOYEE_HDR)
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_validate_hr_manager_allowed(client: AsyncClient):
    r = await client.post(f"/api/v1/attendance/monthly/{MONTH}/validate", headers=HR_MGR_HDR)
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# POST /monthly/{month}/lock
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_lock_employee_blocked(client: AsyncClient):
    r = await client.post(
        f"/api/v1/attendance/monthly/{MONTH}/lock", json=_LOCK_BODY, headers=EMPLOYEE_HDR
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_lock_hr_manager_allowed(client: AsyncClient):
    r = await client.post(
        f"/api/v1/attendance/monthly/{MONTH}/lock", json=_LOCK_BODY, headers=HR_MGR_HDR
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# POST /monthly/{month}/unlock — ADMIN_ROLES only (HR_MANAGER excluded)
# ---------------------------------------------------------------------------

async def _lock_month(db: AsyncSession) -> None:
    """Seed a LOCKED AttendanceMonth so unlock has something to act on."""
    m = date(2026, 4, 1)
    ctrl = AttendanceMonth(
        tenant_id=TENANT_ID,
        month=m,
        status="LOCKED",
        locked_by=uuid.uuid4(),
    )
    db.add(ctrl)
    await db.commit()


# Unlock requires client context (get_client_context), so x-client-id is
# required in addition to an admin role.
_UNLOCK_CLIENT = {"x-client-id": str(uuid.uuid4())}


@pytest.mark.asyncio
async def test_unlock_employee_blocked(client: AsyncClient, db: AsyncSession):
    await _lock_month(db)
    r = await client.post(
        f"/api/v1/attendance/monthly/{MONTH}/unlock", json=_UNLOCK_BODY,
        headers={**EMPLOYEE_HDR, **_UNLOCK_CLIENT},
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_unlock_hr_manager_blocked(client: AsyncClient, db: AsyncSession):
    """HR_MANAGER can lock but NOT unlock — admin-only action."""
    await _lock_month(db)
    r = await client.post(
        f"/api/v1/attendance/monthly/{MONTH}/unlock", json=_UNLOCK_BODY,
        headers={**HR_MGR_HDR, **_UNLOCK_CLIENT},
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_unlock_payroll_admin_allowed(client: AsyncClient, db: AsyncSession):
    await _lock_month(db)
    r = await client.post(
        f"/api/v1/attendance/monthly/{MONTH}/unlock", json=_UNLOCK_BODY,
        headers={**PAYROLL_HDR, **_UNLOCK_CLIENT},
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_unlock_org_admin_allowed(client: AsyncClient, db: AsyncSession):
    await _lock_month(db)
    r = await client.post(
        f"/api/v1/attendance/monthly/{MONTH}/unlock", json=_UNLOCK_BODY,
        headers={**ORG_ADMIN_HDR, **_UNLOCK_CLIENT},
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Read endpoints — accessible to all authenticated roles including EMPLOYEE
# ---------------------------------------------------------------------------

# Read endpoints are client-scoped, so a valid x-client-id is required.
_EMP_READ_HDR = {**EMPLOYEE_HDR, "x-client-id": str(uuid.uuid4())}


@pytest.mark.asyncio
async def test_get_monthly_employee_allowed(client: AsyncClient):
    r = await client.get(f"/api/v1/attendance/monthly/{MONTH}", headers=_EMP_READ_HDR)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_get_single_record_employee_allowed(client: AsyncClient, db: AsyncSession):
    """Employee can read their own record (404 if none exists — not 403)."""
    r = await client.get(
        f"/api/v1/attendance/{EMP_ID}/{MONTH}", headers=_EMP_READ_HDR
    )
    assert r.status_code in (200, 404), r.text
    assert r.status_code != 403


# ---------------------------------------------------------------------------
# Tenant isolation sanity check — guard uses ctx.tenant_id from JWT
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manual_write_scoped_to_jwt_tenant(client: AsyncClient, db: AsyncSession):
    """
    After a successful write, the created AttendanceRecord must carry the
    tenant_id from the JWT, not any value from the request body.
    """
    r = await client.post("/api/v1/attendance/manual", json=_MANUAL_BODY, headers=HR_MGR_HDR)
    assert r.status_code == 200, r.text

    record = await db.scalar(
        __import__("sqlalchemy", fromlist=["select"]).select(AttendanceRecord).where(
            AttendanceRecord.employee_id == uuid.UUID(EMP_ID)
        )
    )
    assert record is not None
    assert record.tenant_id == TENANT_ID, (
        "AttendanceRecord tenant_id must match the JWT tenant, not be left as default"
    )


# ---------------------------------------------------------------------------
# client_id round-trip (issue H1): a written record must carry client_id so the
# client-scoped read can find it — otherwise payroll falls back to zero LOP.
# ---------------------------------------------------------------------------

CLIENT_ID = str(uuid.uuid4())
CLIENT_HDR = {**HR_MGR_HDR, "x-client-id": CLIENT_ID}


@pytest.mark.asyncio
async def test_written_record_carries_client_id_and_is_readable(client: AsyncClient):
    # present 25 of 30 with 4 week-offs -> LOP = 30 - 25 - 4 = 1 day.
    body = {**_MANUAL_BODY, "present_days": 25}
    w = await client.post("/api/v1/attendance/manual", json=body, headers=CLIENT_HDR)
    assert w.status_code == 200, w.text
    assert w.json()["client_id"] == CLIENT_ID

    # Client-scoped read: before the fix client_id was NULL, so this 404'd and
    # the payroll orchestrator treated the employee as full-attendance.
    r = await client.get(f"/api/v1/attendance/{EMP_ID}/{MONTH}", headers=CLIENT_HDR)
    assert r.status_code == 200, r.text
    assert r.json()["client_id"] == CLIENT_ID
    assert Decimal(str(r.json()["lop_days"])) == Decimal("1")


@pytest.mark.asyncio
async def test_wfh_is_included_in_present_not_lop(client: AsyncClient):
    # The grid counts a WFH day as present, so present_days already includes the
    # 6 WFH days: 26 present (20 office + 6 WFH) + 4 week-offs = 30 -> LOP 0.
    # _calc must NOT subtract wfh again (that would double-count it).
    body = {**_MANUAL_BODY, "present_days": 26, "wfh_days": 6}
    w = await client.post("/api/v1/attendance/manual", json=body, headers=CLIENT_HDR)
    assert w.status_code == 200, w.text
    assert Decimal(str(w.json()["lop_days"])) == Decimal("0")
    assert Decimal(str(w.json()["payable_days"])) == Decimal("30")


@pytest.mark.asyncio
async def test_absent_days_are_lop_even_with_wfh(client: AsyncClient):
    # 20 office + 4 WFH (all in present_days=24) + 4 week-offs = 28 accounted;
    # the remaining 2 days are absent -> LOP 2. The double-subtract regression
    # would have wrongly reported LOP 0 and paid the absent days.
    body = {**_MANUAL_BODY, "present_days": 24, "wfh_days": 4, "wo_days": 4}
    w = await client.post("/api/v1/attendance/manual", json=body, headers=CLIENT_HDR)
    assert w.status_code == 200, w.text
    assert Decimal(str(w.json()["lop_days"])) == Decimal("2")
    assert Decimal(str(w.json()["payable_days"])) == Decimal("28")
