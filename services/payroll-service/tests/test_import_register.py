"""Excel register import (orchestrator.import_register).

The import path must do the identical DRAFT -> LOCKED -> COMPUTING ->
COMPUTED transition as run_cycle, write one PayrollResult per row, and in
"compute" mode derive PF/ESI/PT/TDS via the compliance/tds services instead
of taking them from the sheet.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import client as svc_client
from app import orchestrator
from app.models import PayrollCycle, PayrollResult
from app.schemas import ImportRegisterRow
from hr_shared import TenantAwareBase

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)

TENANT_ID = uuid.uuid4()
CTX = SimpleNamespace(tenant_id=TENANT_ID, user_id=uuid.uuid4())

EMP_A = {
    "id": str(uuid.uuid4()),
    "emp_code": "E001",
    "first_name": "Asha",
    "last_name": "Kumar",
    "pan_number": "ABCDE1234F",
    "bank_account": "12345678901",
    "designation": "Operator",
    "work_location": "Pune",
    "state": "Maharashtra",
}
EMP_B = {
    "id": str(uuid.uuid4()),
    "emp_code": "E002",
    "first_name": "Ravi",
    "last_name": "Patil",
    "pan_number": None,
    "bank_account": None,
    "designation": None,
    "work_location": None,
    "state": "Maharashtra",
}


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


class _DummyHTTP:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


@pytest.fixture()
def audit_events(monkeypatch) -> list[dict]:
    """audit_logs lives in a Postgres schema SQLite can't create; record
    the calls instead so the tests can assert on the emitted events."""
    events: list[dict] = []

    async def _audit(session, **kwargs):
        events.append(kwargs)

    monkeypatch.setattr(orchestrator, "audit_log", _audit)
    return events


@pytest.fixture(autouse=True)
def _stub_services(monkeypatch):
    """Stub the outbound service calls; returns the compliance payloads sent."""
    monkeypatch.setattr(svc_client, "make_client", lambda: _DummyHTTP())

    async def _employees(http, token, client_id=None):
        return [EMP_A, EMP_B]

    monkeypatch.setattr(svc_client, "list_active_employees", _employees)

    compliance_payloads: list[dict] = []

    async def _compliance(http, token, payload, client_id=None):
        compliance_payloads.append(payload)
        return {
            "employee_pf": "1800",
            "employee_esi": "150",
            "pt_amount": "200",
            "employer_eps": "1250",
            "employer_epf": "550",
            "employer_esi": "650",
        }

    monkeypatch.setattr(svc_client, "compute_compliance", _compliance)

    async def _tds(http, token, payload, client_id=None):
        return {"monthly_tds": "500", "tax_trace": {"regime": "new"}}

    monkeypatch.setattr(svc_client, "compute_tds", _tds)
    return compliance_payloads


async def _make_cycle(session: AsyncSession, status: str = "DRAFT") -> PayrollCycle:
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


def _row(employee_id: str, **overrides) -> ImportRegisterRow:
    base = dict(
        employee_id=uuid.UUID(employee_id),
        present_days=Decimal("24"),
        holiday_days=Decimal("2"),
        wo_days=Decimal("4"),
        total_days=30,
        basic=Decimal("12000"),
        da=Decimal("1500"),
        hra=Decimal("6000"),
        bonus=Decimal("500"),
        gross=Decimal("20000"),
        employee_esi=Decimal("150"),
        employee_pf=Decimal("1440"),
        pt=Decimal("200"),
        total_deductions=Decimal("2000"),
        net_pay=Decimal("18000"),
    )
    base.update(overrides)
    return ImportRegisterRow(**base)


@pytest.mark.asyncio
async def test_prefilled_import_stores_sheet_figures(session: AsyncSession, audit_events: list[dict]):
    cyc = await _make_cycle(session)
    rows = [_row(EMP_A["id"]), _row(EMP_B["id"], gross=Decimal("15000"),
                                     total_deductions=Decimal("1000"),
                                     net_pay=Decimal("14000"))]
    summary = await orchestrator.import_register(session, CTX, "token", cyc, rows, "prefilled")

    assert summary["status"] == "COMPUTED"
    assert summary["computed"] == 2
    assert summary["failed"] == 0

    results = list(await session.scalars(select(PayrollResult)))
    assert len(results) == 2
    ra = next(r for r in results if str(r.employee_id) == EMP_A["id"])
    assert ra.gross_earnings == Decimal("20000.00")
    assert ra.total_deductions == Decimal("2000.00")
    assert ra.net_pay == Decimal("18000.00")
    bd = ra.breakdown_json
    assert bd["source"] == "excel_import"
    assert bd["earnings"]["da"] == "1500.00"
    assert bd["earnings"]["bonus"] == "500.00"
    assert bd["attendance"]["present_days"] == "24"
    # Deduction rows must add up to the sheet's Total Ded: residual -> "other".
    assert bd["deductions"]["other"] == "210.00"  # 2000 - (1440+150+200)
    # PAN/bank must be stored masked.
    assert bd["employee"]["pan"] != EMP_A["pan_number"]

    imported_events = [e for e in audit_events if e["event_type"] == "PAYROLL_REGISTER_IMPORTED"]
    assert len(imported_events) == 1
    assert imported_events[0]["payload"]["imported"] == 2


@pytest.mark.asyncio
async def test_compute_mode_derives_deductions(
    session: AsyncSession, audit_events: list[dict], _stub_services: list[dict]
):
    cyc = await _make_cycle(session)
    rows = [
        _row(
            EMP_A["id"],
            employee_esi=Decimal("0"),
            employee_pf=Decimal("0"),
            pt=Decimal("0"),
            total_deductions=None,
            net_pay=None,
        )
    ]
    summary = await orchestrator.import_register(session, CTX, "token", cyc, rows, "compute")

    assert summary["status"] == "COMPUTED"
    # Statutory bases: PF wages = Basic + DA; ESI wages = gross minus the
    # bonus head; PT gets the state and gender for slab/exemption rules.
    (payload,) = _stub_services
    assert payload["basic"] == "13500.00"        # 12000 + 1500 DA
    assert payload["esi_gross"] == "19500.00"    # 20000 - 500 bonus
    assert payload["state"] == "Maharashtra"
    assert "gender" in payload
    result = await session.scalar(select(PayrollResult))
    # 1800 PF + 150 ESI + 200 PT + 500 TDS from the stubbed services.
    assert result.total_deductions == Decimal("2650.00")
    assert result.net_pay == Decimal("17350.00")
    bd = result.breakdown_json
    assert bd["deductions"]["employee_pf"] == "1800.00"
    assert bd["deductions"]["tds"] == "500.00"
    assert bd["employer_contrib"]["employer_epf"] == "550.00"
    assert bd["import_mode"] == "compute"


@pytest.mark.asyncio
async def test_unknown_employee_fails_row(session: AsyncSession, audit_events: list[dict]):
    cyc = await _make_cycle(session)
    rows = [_row(str(uuid.uuid4()))]
    summary = await orchestrator.import_register(session, CTX, "token", cyc, rows, "prefilled")

    assert summary["computed"] == 0
    assert summary["failed"] == 1
    assert summary["status"] == "FAILED"
    assert "not an active employee" in summary["errors"][0]


@pytest.mark.asyncio
async def test_reimport_is_idempotent(session: AsyncSession, audit_events: list[dict]):
    cyc = await _make_cycle(session)
    await orchestrator.import_register(session, CTX, "token", cyc, [_row(EMP_A["id"])], "prefilled")
    corrected = _row(EMP_A["id"], net_pay=Decimal("17500"), total_deductions=Decimal("2500"))
    summary = await orchestrator.import_register(session, CTX, "token", cyc, [corrected], "prefilled")

    assert summary["status"] == "COMPUTED"
    results = list(await session.scalars(select(PayrollResult)))
    assert len(results) == 1
    assert results[0].net_pay == Decimal("17500.00")


@pytest.mark.asyncio
async def test_import_rejects_disbursed_cycle(session: AsyncSession):
    cyc = await _make_cycle(session, status="DISBURSED")
    with pytest.raises(HTTPException) as ei:
        await orchestrator.import_register(session, CTX, "token", cyc, [_row(EMP_A["id"])], "prefilled")
    assert ei.value.status_code == 409
