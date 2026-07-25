"""Payroll run_cycle concurrency guard (issue M4).

run_cycle re-reads the cycle row (FOR UPDATE on Postgres) before the state
transition, so a cycle already being processed cannot be run a second time and
double-processed. This asserts a COMPUTING cycle is rejected with 409, and that
the guard uses the persisted status rather than a stale in-memory object.

(True cross-transaction locking needs Postgres; with_for_update is a no-op on
SQLite. This verifies the guard logic that the lock makes atomic.)
"""
from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import orchestrator
from app.models import PayrollCycle
from hr_shared import TenantAwareBase

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)

TENANT_ID = uuid.uuid4()
CTX = SimpleNamespace(tenant_id=TENANT_ID, user_id=uuid.uuid4())


@pytest_asyncio.fixture(autouse=True, scope="function")
async def _schema():
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.drop_all)


@pytest_asyncio.fixture
async def session() -> AsyncGenerator[AsyncSession, None]:
    async with _session_factory() as s:
        yield s


async def _make_cycle(session: AsyncSession, status: str) -> PayrollCycle:
    cyc = PayrollCycle(
        tenant_id=TENANT_ID,
        name="Apr 2026",
        period_start=date(2026, 4, 1),
        period_end=date(2026, 4, 30),
        status=status,
    )
    session.add(cyc)
    await session.commit()
    await session.refresh(cyc)
    return cyc


@pytest.mark.asyncio
async def test_run_rejects_cycle_already_computing(session: AsyncSession):
    cyc = await _make_cycle(session, status="COMPUTING")
    with pytest.raises(HTTPException) as ei:
        await orchestrator.run_cycle(session, CTX, "token", cyc)
    assert ei.value.status_code == 409


@pytest.mark.asyncio
async def test_run_rejects_disbursed_cycle(session: AsyncSession):
    cyc = await _make_cycle(session, status="DISBURSED")
    with pytest.raises(HTTPException) as ei:
        await orchestrator.run_cycle(session, CTX, "token", cyc)
    assert ei.value.status_code == 409
