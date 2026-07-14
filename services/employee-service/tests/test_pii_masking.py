"""Employee PII is masked by default; raw values only via audited reveal (H7).

GET /employees/{id} previously returned full PAN/Aadhaar/bank/UAN, so any user
who opened the page could read all PII from the network tab with no audit
trail. Now the detail/list responses mask PII and the pii-access endpoint is
the only way to obtain the raw value (and it records an audit event).
"""
from __future__ import annotations

import os
import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# EncryptedString needs a key before the models are used.
os.environ["FIELD_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

import hr_shared.crypto as crypto_module  # noqa: E402
crypto_module.reset_fernet()

from app.deps import get_session  # noqa: E402
from app.main import app as employee_app  # noqa: E402
from app.models import Employee  # noqa: E402
from app.settings import settings  # noqa: E402
from hr_shared import TenantAwareBase  # noqa: E402

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)

TENANT_ID = uuid.uuid4()
CLIENT_ID = uuid.uuid4()
RAW_PAN = "ABCDE1234F"
RAW_AADHAAR = "123412341234"
RAW_BANK = "50100123456789"


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


async def _seed(db: AsyncSession) -> uuid.UUID:
    emp = Employee(
        tenant_id=TENANT_ID, client_id=CLIENT_ID, emp_code="E1",
        first_name="Asha", last_name="Rao",
        pan_number=RAW_PAN, aadhaar_number=RAW_AADHAAR, bank_account=RAW_BANK,
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return emp.id


@pytest.mark.asyncio
async def test_get_employee_masks_pii(client: AsyncClient, db: AsyncSession):
    emp_id = await _seed(db)
    r = await client.get(f"/api/v1/employees/{emp_id}", headers=_hdr())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["pan_number"] == "ABCDE####F"
    assert data["pan_number"] != RAW_PAN
    assert data["aadhaar_number"].endswith("1234") and "XXXX" in data["aadhaar_number"]
    assert data["bank_account"].endswith("6789") and data["bank_account"] != RAW_BANK


@pytest.mark.asyncio
async def test_pii_access_returns_raw_values(client: AsyncClient, db: AsyncSession):
    emp_id = await _seed(db)
    r = await client.post(
        f"/api/v1/employees/{emp_id}/pii-access",
        json={"fields": ["pan_number", "bank_account"]},
        headers=_hdr(),
    )
    assert r.status_code == 200, r.text
    values = r.json()["values"]
    assert values["pan_number"] == RAW_PAN
    assert values["bank_account"] == RAW_BANK
