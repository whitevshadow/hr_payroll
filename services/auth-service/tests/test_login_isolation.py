"""
Multi-tenant login isolation tests.

Verifies that a user from Tenant A cannot authenticate as Tenant B,
even when both tenants have a user registered with the same email address.

Threat model:
  - Attacker controls Tenant A credentials.
  - Victim is a user at Tenant B with the same email.
  - Fix: login query filters on (tenant_id, email), not email alone.
"""
from __future__ import annotations

import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.deps import get_session
from app.main import app as auth_app
from app.models import Role, Tenant, User
from app.security import hash_password
from app.settings import settings
from hr_shared import TenantAwareBase

# ---------------------------------------------------------------------------
# In-process SQLite engine (no Postgres needed for unit tests)
# ---------------------------------------------------------------------------
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

_engine = create_async_engine(TEST_DATABASE_URL, future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True, scope="function")
async def _create_schema():
    """Re-create tables fresh for every test function."""
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with _session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """TestClient with the session dependency overridden to use the test DB."""

    async def _override_session() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    auth_app.dependency_overrides[get_session] = _override_session
    async with AsyncClient(
        transport=ASGITransport(app=auth_app), base_url="http://test"
    ) as ac:
        yield ac
    auth_app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _seed_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    role: str = "ORG_ADMIN",
) -> tuple[uuid.UUID, uuid.UUID]:
    """Insert a tenant + user and return (tenant_id, user_id)."""
    tenant_id = uuid.uuid4()
    tenant = Tenant(id=tenant_id, tenant_id=tenant_id, name=f"Tenant-{tenant_id}")
    session.add(tenant)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        tenant_id=tenant_id,
        email=email.lower(),
        password_hash=hash_password(password),
        is_active=True,
    )
    session.add(user)
    await session.flush()
    session.add(Role(tenant_id=tenant_id, user_id=user_id, role_name=role))
    await session.commit()
    return tenant_id, user_id


def _decode_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

SHARED_EMAIL = "alice@example.com"
TENANT_A_PASSWORD = "passwordA-secure"
TENANT_B_PASSWORD = "passwordB-secure"


@pytest.mark.asyncio
async def test_correct_tenant_login_succeeds(
    client: AsyncClient, db_session: AsyncSession
):
    """Tenant A can log in with their own credentials."""
    tenant_a_id, user_a_id = await _seed_user(
        db_session, email=SHARED_EMAIL, password=TENANT_A_PASSWORD
    )

    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": str(tenant_a_id),
            "email": SHARED_EMAIL,
            "password": TENANT_A_PASSWORD,
        },
    )

    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    claims = _decode_token(token)

    assert claims["tenant_id"] == str(tenant_a_id), "JWT tenant must match login tenant"
    assert claims["sub"] == str(user_a_id), "JWT sub must be the correct user"


@pytest.mark.asyncio
async def test_cross_tenant_same_email_is_rejected(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Tenant A cannot log in by supplying Tenant B's tenant_id.
    Both tenants have the same email; passwords are different.
    Before the fix, scalar() returned whichever row the DB gave first,
    so an attacker who knew their own valid password could land on their
    own row even when supplying the victim's tenant_id.
    After the fix, the WHERE clause binds to the supplied tenant_id,
    so only the exact (tenant_id, email) row is considered.
    """
    tenant_a_id, _ = await _seed_user(
        db_session, email=SHARED_EMAIL, password=TENANT_A_PASSWORD
    )
    tenant_b_id, _ = await _seed_user(
        db_session, email=SHARED_EMAIL, password=TENANT_B_PASSWORD
    )

    # Attacker knows Tenant A's password but supplies Tenant B's tenant_id.
    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": str(tenant_b_id),  # victim's tenant
            "email": SHARED_EMAIL,
            "password": TENANT_A_PASSWORD,  # attacker's password
        },
    )

    assert resp.status_code == 401, (
        f"Expected 401, got {resp.status_code}. "
        "Cross-tenant login must be rejected."
    )


@pytest.mark.asyncio
async def test_cross_tenant_correct_password_returns_own_tenant_jwt(
    client: AsyncClient, db_session: AsyncSession
):
    """
    Tenant B can log in correctly; the returned JWT must carry Tenant B's
    tenant_id, not Tenant A's — even though both share the same email.
    """
    tenant_a_id, _ = await _seed_user(
        db_session, email=SHARED_EMAIL, password=TENANT_A_PASSWORD
    )
    tenant_b_id, user_b_id = await _seed_user(
        db_session, email=SHARED_EMAIL, password=TENANT_B_PASSWORD
    )

    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": str(tenant_b_id),
            "email": SHARED_EMAIL,
            "password": TENANT_B_PASSWORD,
        },
    )

    assert resp.status_code == 200, resp.text
    claims = _decode_token(resp.json()["access_token"])

    assert claims["tenant_id"] == str(tenant_b_id)
    assert claims["sub"] == str(user_b_id)
    assert claims["tenant_id"] != str(tenant_a_id), (
        "JWT must not carry Tenant A's id when Tenant B logged in"
    )


@pytest.mark.asyncio
async def test_wrong_tenant_id_for_nonexistent_user_returns_401(
    client: AsyncClient, db_session: AsyncSession
):
    """Supplying a random tenant_id for a valid email gives 401, not 500."""
    tenant_a_id, _ = await _seed_user(
        db_session, email=SHARED_EMAIL, password=TENANT_A_PASSWORD
    )

    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": str(uuid.uuid4()),  # tenant that doesn't exist
            "email": SHARED_EMAIL,
            "password": TENANT_A_PASSWORD,
        },
    )

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_disabled_user_cannot_login(
    client: AsyncClient, db_session: AsyncSession
):
    """is_active=False blocks login even with correct (tenant_id, email, password)."""
    tenant_id = uuid.uuid4()
    tenant = Tenant(id=tenant_id, tenant_id=tenant_id, name="Disabled Corp")
    db_session.add(tenant)

    user = User(
        tenant_id=tenant_id,
        email=SHARED_EMAIL,
        password_hash=hash_password(TENANT_A_PASSWORD),
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/auth/login",
        json={
            "tenant_id": str(tenant_id),
            "email": SHARED_EMAIL,
            "password": TENANT_A_PASSWORD,
        },
    )

    assert resp.status_code == 403
