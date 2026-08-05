"""Daily-wage compute path (orchestrator._compute_for_daily_employee).

Golden figures follow two real client wage registers (Tanmay Enterprises).
The rate card holds MONTHLY wages and the day rate is derived per cycle as
monthly / calendar days in that month — which is why the same Rs 9,705 basic
produces 313.06/day in 31-day May and 323.50/day in 30-day June. Bonus is a
percentage of earned Basic+DA, PF wages = gross − HRA, ESI wages = gross −
bonus. Missing attendance must produce zero pay flagged NO_ATTENDANCE —
never a full-period fallback.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import client as svc_client
from app import orchestrator
from app.models import PayrollCycle
from hr_shared import TenantAwareBase

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)

TENANT_ID = uuid.uuid4()
CTX = SimpleNamespace(tenant_id=TENANT_ID, user_id=uuid.uuid4())

# The client-level rate card every worker on this register shares.
RATE_CARD = {
    "id": str(uuid.uuid4()),
    "name": "Chakan Helper 2026",
    "monthly_basic": "9705",
    "monthly_da": "3375",
    "monthly_hra": "654",
    "bonus_pct": "8.33",
}

# Register row 1 (Sanubai Kadale): 14 present + 2 weekly offs = 16 paid days.
DAILY_EMP = {
    "id": str(uuid.uuid4()),
    "emp_code": "D001",
    "first_name": "Sanubai",
    "last_name": "Kadale",
    "pan_number": None,
    "bank_account": None,
    "designation": "Helper",
    "work_location": "Chakan",
    "state": "Maharashtra",
    "gender": "F",
    "wage_type": "DAILY",
    "daily_rate_card_id": RATE_CARD["id"],
    "daily_rate_card": RATE_CARD,
}

ATTENDANCE = {
    "total_days": 31,
    "present_days": "14",
    "payable_days": "16",
    "lop_days": "0",
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


@pytest.fixture()
def stubs(monkeypatch):
    """Stub outbound calls; expose the payloads and attendance switch."""
    state = SimpleNamespace(attendance=ATTENDANCE, compliance_payloads=[])

    async def _attendance(http, token, employee_id, month, client_id=None):
        return state.attendance

    async def _compliance(http, token, payload, client_id=None):
        state.compliance_payloads.append(payload)
        # What compliance-service returns for the register's row 1:
        # PF 12% of 7313.23, ESI 0.75% of 7088.48, PT nil (woman under the
        # Maharashtra exemption).
        return {
            "employee_pf": "877.59",
            "employee_esi": "53.16",
            "pt_amount": "0",
            "employer_eps": "609.19",
            "employer_epf": "268.40",
            "employer_esi": "230.38",
        }

    monkeypatch.setattr(svc_client, "get_attendance", _attendance)
    monkeypatch.setattr(svc_client, "compute_compliance", _compliance)
    return state


async def _make_cycle(session: AsyncSession, year: int = 2026, month: int = 5) -> PayrollCycle:
    import calendar as _cal
    last = _cal.monthrange(year, month)[1]
    cyc = PayrollCycle(
        tenant_id=TENANT_ID,
        name=f"{year}-{month:02d}",
        period_start=date(year, month, 1),
        period_end=date(year, month, last),
        status="DRAFT",
    )
    session.add(cyc)
    await session.commit()
    await session.refresh(cyc)
    return cyc


@pytest.mark.asyncio
async def test_daily_wage_register_figures(session: AsyncSession, stubs):
    cyc = await _make_cycle(session)
    result = await orchestrator._compute_for_employee(None, "token", cyc, DAILY_EMP)

    earnings = result["breakdown"]["earnings"]
    assert earnings["basic"] == "5008.96"   # 313.06 × 16  (register 5,009)
    assert earnings["da"] == "1741.92"      # 108.87 × 16  (register 1,742)
    assert earnings["hra"] == "337.60"      # 21.10 × 16   (register 338)
    assert earnings["bonus"] == "562.35"    # 8.33% of 6750.88 (register 562)
    # Gross is Basic + DA + HRA + Bonus only. The rate card's leave accrual is
    # NOT a monthly earning — including it put every payslip ~5% over the
    # client's register.
    assert "leave_wages" not in earnings
    assert result["gross"] == Decimal("7650.83")          # register 7,651

    # PF 877.59 + ESI 53.16 + PT 0
    assert result["total_deductions"] == Decimal("930.75")  # register 931
    assert result["net_pay"] == Decimal("6720.08")          # register 6,721

    assert result["breakdown"]["wage_type"] == "DAILY"
    assert result["breakdown"]["daily_rates"]["card_name"] == "Chakan Helper 2026"
    assert result["breakdown"]["attendance"]["paid_days"] == "16"
    assert "warnings" not in result["breakdown"]


@pytest.mark.asyncio
async def test_daily_wage_compliance_payload(session: AsyncSession, stubs):
    """Register convention: PF wages = gross − HRA (Basic+DA+bonus), ESI wages
    = gross − bonus (Basic+DA+HRA). Period-lock inputs are set."""
    cyc = await _make_cycle(session)
    await orchestrator._compute_for_employee(None, "token", cyc, DAILY_EMP)

    payload = stubs.compliance_payloads[0]
    assert payload["basic"] == "7313.23"        # 5008.96 + 1741.92 + 562.35
    assert payload["monthly_gross"] == "7650.83"
    assert payload["esi_gross"] == "7088.48"    # 5008.96 + 1741.92 + 337.60
    assert payload["gender"] == "F"
    assert payload["state"] == "Maharashtra"
    assert payload["month"] == 5
    assert payload["year"] == 2026


@pytest.mark.asyncio
async def test_daily_wage_without_rate_card_fails_the_row(session: AsyncSession, stubs):
    """run_cycle isolates this per employee, so the row must raise, not
    silently pay zero from missing rates."""
    cyc = await _make_cycle(session)
    emp = {**DAILY_EMP, "daily_rate_card": None, "daily_rate_card_id": None}
    with pytest.raises(ValueError, match="no rate card"):
        await orchestrator._compute_for_employee(None, "token", cyc, emp)


@pytest.mark.asyncio
async def test_daily_wage_no_attendance_is_zero_and_flagged(session: AsyncSession, stubs):
    cyc = await _make_cycle(session)
    stubs.attendance = None
    result = await orchestrator._compute_for_employee(None, "token", cyc, DAILY_EMP)

    assert result["gross"] == Decimal("0.00")
    assert result["net_pay"] == Decimal("0.00")
    assert result["breakdown"]["warnings"] == ["NO_ATTENDANCE"]
    # No downstream statutory calls for a zero-day month
    assert stubs.compliance_payloads == []


@pytest.mark.asyncio
async def test_monthly_employee_unaffected(session: AsyncSession, stubs, monkeypatch):
    """A MONTHLY employee still goes through the salary-structure path."""
    cyc = await _make_cycle(session)
    called = SimpleNamespace(salary=False)

    async def _salary(http, token, employee_id, client_id=None):
        called.salary = True
        return {"breakdown": {"monthly_gross": "30000", "basic": "15000",
                              "hra": "7500", "special_allowance": "7500"}}

    monkeypatch.setattr(svc_client, "get_salary_breakdown", _salary)
    emp = {**DAILY_EMP, "wage_type": "MONTHLY"}
    result = await orchestrator._compute_for_employee(None, "token", cyc, emp)
    assert called.salary is True
    assert result["breakdown"].get("wage_type") != "DAILY"


@pytest.mark.asyncio
async def test_lwf_is_deducted_from_net_pay(session: AsyncSession, stubs, monkeypatch):
    """LWF must actually reach net pay — it was computed by compliance-service
    but never read by the orchestrator before, so it silently never applied."""
    cyc = await _make_cycle(session)

    async def _compliance_with_lwf(http, token, payload, client_id=None):
        stubs.compliance_payloads.append(payload)
        return {
            "employee_pf": "877.59",
            "employee_esi": "53.16",
            "pt_amount": "0",
            "employer_eps": "609.19",
            "employer_epf": "268.40",
            "employer_esi": "230.38",
            # June/December: flat MLWF per the client's register.
            "employee_lwf": "25.00",
            "employer_lwf": "0.00",
        }

    monkeypatch.setattr(svc_client, "compute_compliance", _compliance_with_lwf)
    result = await orchestrator._compute_for_employee(None, "token", cyc, DAILY_EMP)

    assert result["breakdown"]["deductions"]["lwf"] == "25.00"
    assert result["breakdown"]["employer_contrib"]["employer_lwf"] == "0.00"
    # 877.59 + 53.16 + 0 + 25.00
    assert result["total_deductions"] == Decimal("955.75")
    assert result["net_pay"] == Decimal("6695.08")   # 7650.83 - 955.75


@pytest.mark.asyncio
async def test_no_lwf_in_non_contribution_month(session: AsyncSession, stubs):
    """The default stub returns no LWF keys at all (compliance sends 0 outside
    June/December); the orchestrator must treat that as nil, not crash."""
    cyc = await _make_cycle(session)
    result = await orchestrator._compute_for_employee(None, "token", cyc, DAILY_EMP)
    assert result["breakdown"]["deductions"]["lwf"] == "0.00"
    assert result["total_deductions"] == Decimal("930.75")


@pytest.mark.asyncio
async def test_day_rate_is_derived_from_month_length(session: AsyncSession, stubs):
    """One rate card, two months: the same Rs 9,705 basic must pay 313.06/day
    in 31-day May and 323.50/day in 30-day June, exactly as the client's two
    registers do. A fixed per-day rate cannot express both."""
    may = await _make_cycle(session, 2026, 5)          # 31 days
    r_may = await orchestrator._compute_for_employee(None, "token", may, DAILY_EMP)
    assert r_may["breakdown"]["daily_rates"]["basic"] == "313.06"
    assert r_may["breakdown"]["daily_rates"]["days_in_month"] == "31"
    assert r_may["breakdown"]["earnings"]["basic"] == "5008.96"   # register 5,009

    june = await _make_cycle(session, 2026, 6)         # 30 days
    r_jun = await orchestrator._compute_for_employee(None, "token", june, DAILY_EMP)
    assert r_jun["breakdown"]["daily_rates"]["basic"] == "323.50"
    assert r_jun["breakdown"]["daily_rates"]["days_in_month"] == "30"
    assert r_jun["breakdown"]["earnings"]["basic"] == "5176.00"   # register 5,176
    assert r_jun["breakdown"]["earnings"]["da"] == "1800.00"      # register 1,800
    assert r_jun["breakdown"]["earnings"]["gross"] == "7905.90"   # register 7,906


@pytest.mark.asyncio
async def test_full_month_pays_exactly_the_monthly_wage(session: AsyncSession, stubs):
    """30 of 30 days in June must pay the monthly wage to the rupee — the
    register's Bayadabai row (9,705 / 3,375 / 654)."""
    june = await _make_cycle(session, 2026, 6)
    stubs.attendance = {"total_days": 30, "present_days": "26", "payable_days": "30", "lop_days": "0"}
    r = await orchestrator._compute_for_employee(None, "token", june, DAILY_EMP)
    e = r["breakdown"]["earnings"]
    assert (e["basic"], e["da"], e["hra"]) == ("9705.00", "3375.00", "654.00")
