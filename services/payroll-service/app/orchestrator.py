"""The synchronous payroll orchestration (section 6)."""

from __future__ import annotations

import calendar
import logging
import uuid
from decimal import Decimal

from hr_shared import audit_log, mask_bank_account as _mask_bank_account, mask_pan as _mask_pan, money
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import client, state
from .client import ServiceCallError
from .models import PayrollCycle, PayrollResult
from .settings import settings


def _month_str(d) -> str:
    return f"{d.year:04d}-{d.month:02d}"


async def _upsert_result(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    *,
    gross,
    total_deductions,
    net_pay,
    breakdown,
    status,
    error=None,
) -> PayrollResult:
    existing = await session.scalar(
        select(PayrollResult).where(
            PayrollResult.tenant_id == tenant_id,
            PayrollResult.cycle_id == cycle_id,
            PayrollResult.employee_id == employee_id,
        )
    )
    if existing:
        existing.gross_earnings = gross
        existing.total_deductions = total_deductions
        existing.net_pay = net_pay
        existing.breakdown_json = breakdown
        existing.status = status
        existing.error = error
        return existing
    row = PayrollResult(
        tenant_id=tenant_id,
        cycle_id=cycle_id,
        employee_id=employee_id,
        gross_earnings=gross,
        total_deductions=total_deductions,
        net_pay=net_pay,
        breakdown_json=breakdown,
        status=status,
        error=error,
    )
    session.add(row)
    return row


async def _compute_for_employee(
    http, token: str, cycle: PayrollCycle, emp: dict, client_id: str | None = None
) -> dict:
    """Pull from every service and aggregate. Returns the result dict."""
    if (emp.get("wage_type") or "MONTHLY").upper() == "DAILY":
        return await _compute_for_daily_employee(http, token, cycle, emp, client_id)

    employee_id = emp["id"]

    salary = await client.get_salary_breakdown(http, token, employee_id, client_id)
    bd = salary["breakdown"]
    monthly_gross = money(bd["monthly_gross"])
    basic = money(bd["basic"])
    hra = money(bd["hra"])
    special = money(bd["special_allowance"])

    # Attendance (fall back to full period, no LOP, if not entered).
    period_days = (cycle.period_end - cycle.period_start).days + 1
    att = await client.get_attendance(http, token, employee_id, _month_str(cycle.period_start), client_id)
    if att:
        total_days = int(att["total_days"])
        lop_days = Decimal(str(att["lop_days"]))
        payable_days = Decimal(str(att["payable_days"]))
    else:
        total_days = period_days
        lop_days = Decimal("0")
        payable_days = Decimal(total_days)

    per_day = monthly_gross / Decimal(total_days) if total_days else Decimal("0")
    lop_deduction = money(per_day * lop_days)

    # Compliance (PF/ESI/PT)
    comp = await client.compute_compliance(
        http,
        token,
        {
            "employee_id": employee_id,
            "cycle_id": str(cycle.id),
            "client_id": str(cycle.client_id) if cycle.client_id else None,
            "basic": str(basic),
            "monthly_gross": str(monthly_gross),
            "state": emp.get("state") or "ALL",  # Uses state-specific or ALL settings
            "gender": emp.get("gender"),
            "month": cycle.period_start.month,
            "ceiling_on": settings.pf_ceiling_enabled,
        },
        client_id,
    )
    employee_pf = money(comp["employee_pf"])
    employee_esi = money(comp["employee_esi"])
    pt_amount = money(comp["pt_amount"])
    # LWF is half-yearly: compliance-service returns 0 outside the state's
    # contribution months, so this line is simply nil for ten months a year.
    employee_lwf = money(comp.get("employee_lwf", 0))

    # Income tax (TDS) is not deducted: tds-service is disconnected from the
    # platform. The head is kept at zero so payslips and downstream consumers
    # keep their shape.
    monthly_tds = money(0)

    other = money(0)
    total_deductions = money(
        employee_pf + employee_esi + pt_amount + employee_lwf + lop_deduction + other
    )
    net_pay = money(monthly_gross - total_deductions)

    breakdown = {
        "employee": {
            "emp_code": emp.get("emp_code"),
            "name": f"{emp.get('first_name', '')} {emp.get('last_name', '')}".strip(),
            # Masked: breakdown_json is accessible to HR admins and stored in JSONB.
            # Full PAN appears only on the employee's own Form 16 (ITA 1961 s.203).
            "pan": _mask_pan(emp.get("pan_number")),
            "bank_account": _mask_bank_account(emp.get("bank_account")),
            "designation": emp.get("designation"),
            "work_location": emp.get("work_location"),
        },
        "earnings": {
            "basic": str(basic),
            "hra": str(hra),
            "special_allowance": str(special),
            "gross": str(monthly_gross),
        },
        "deductions": {
            "employee_pf": str(employee_pf),
            "employee_esi": str(employee_esi),
            "pt": str(pt_amount),
            "lwf": str(employee_lwf),
            "tds": str(monthly_tds),
            "lop": str(lop_deduction),
            "other": str(other),
        },
        "employer_contrib": {
            "employer_eps": str(money(comp["employer_eps"])),
            "employer_epf": str(money(comp["employer_epf"])),
            "employer_esi": str(money(comp["employer_esi"])),
            "employer_lwf": str(money(comp.get("employer_lwf", 0))),
        },
        "attendance": {
            "total_days": total_days,
            "payable_days": str(payable_days),
            "lop_days": str(lop_days),
        },
        "tds_trace": {},
        "net_pay": str(net_pay),
    }
    return {
        "gross": monthly_gross,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
        "breakdown": breakdown,
    }


async def _compute_for_daily_employee(
    http, token: str, cycle: PayrollCycle, emp: dict, client_id: str | None = None
) -> dict:
    """Daily-rated employees: pay = per-day component rates × paid days.

    Register conventions (client wage sheets): the rate card holds monthly
    wages and the day rate is derived as monthly / days in the cycle's month;
    bonus accrues as a percentage of earned Basic+DA; PF wages are gross minus
    HRA and ESI wages are gross minus bonus. Paid days are the attendance
    summary's payable days (present + weekly offs + paid holidays). No
    SalaryStructure and no LOP concept —
    days not worked are simply not paid, so missing attendance means zero
    pay (flagged NO_ATTENDANCE), never a full-month fallback.
    """
    employee_id = emp["id"]
    period_days = (cycle.period_end - cycle.period_start).days + 1

    card = emp.get("daily_rate_card")
    if not card:
        # Fails this employee's row only; run_cycle isolates per-employee errors.
        raise ValueError("DAILY wage employee has no rate card assigned")

    # The rate card holds MONTHLY wages; the day rate is re-derived for every
    # cycle as monthly / calendar days in that month. This is the client's own
    # convention — the same Rs 9,705 basic yields 9705/31 = 313.06 in May and
    # 9705/30 = 323.50 in June — and it makes a full month's attendance pay
    # exactly the monthly wage regardless of month length.
    #
    # The divisor is the calendar length of the month the period starts in, not
    # the attendance record's total_days (which is user-entered and may hold
    # working days) and not the period length (a cycle may span months).
    days_in_month = Decimal(calendar.monthrange(cycle.period_start.year, cycle.period_start.month)[1])
    rate_basic = money(Decimal(str(card.get("monthly_basic") or 0)) / days_in_month)
    rate_da = money(Decimal(str(card.get("monthly_da") or 0)) / days_in_month)
    rate_hra = money(Decimal(str(card.get("monthly_hra") or 0)) / days_in_month)
    bonus_pct = Decimal(str(card.get("bonus_pct") or "0"))

    att = await client.get_attendance(
        http, token, employee_id, _month_str(cycle.period_start), client_id
    )
    warnings: list[str] = []
    if att:
        total_days = int(att["total_days"])
        paid_days = Decimal(str(att["payable_days"]))
    else:
        total_days = period_days
        paid_days = Decimal("0")
        warnings.append("NO_ATTENDANCE")

    basic = money(rate_basic * paid_days)
    da = money(rate_da * paid_days)
    hra = money(rate_hra * paid_days)
    bonus = money((basic + da) * bonus_pct / Decimal("100"))
    gross = money(basic + da + hra + bonus)
    # Client wage-register convention, verified row by row against the source
    # register: PF wages are Basic + DA + bonus (gross minus HRA), and ESI
    # wages are Basic + DA — HRA and bonus both excluded.
    #
    # The ESI base is the client's choice, made explicitly and against advice.
    # The ESI Act levies contribution on gross wages, which include HRA, so
    # excluding it under-contributes: on the July register that is Rs 4.59 per
    # worker per month (SANUBAI 12,847.87 -> 12,235.97, ESI 96.36 -> 91.77).
    # Kept because the client's filed register uses this base and the paysheet
    # has to reconcile with it. Revisit if their ESI consultant disagrees.
    pf_wage_base = money(basic + da + bonus)
    esi_wage_base = money(basic + da)

    if paid_days > 0:
        comp = await client.compute_compliance(
            http,
            token,
            {
                "employee_id": employee_id,
                "cycle_id": str(cycle.id),
                "client_id": str(cycle.client_id) if cycle.client_id else None,
                "basic": str(pf_wage_base),
                "monthly_gross": str(gross),
                "esi_gross": str(esi_wage_base),
                "state": emp.get("state") or "ALL",
                "gender": emp.get("gender"),
                "month": cycle.period_start.month,
                # Enables the ESI contribution-period rule — essential for
                # daily wagers whose gross fluctuates around the ceiling.
                "year": cycle.period_start.year,
                "ceiling_on": settings.pf_ceiling_enabled,
            },
            client_id,
        )
        employee_pf = money(comp["employee_pf"])
        employee_esi = money(comp["employee_esi"])
        pt_amount = money(comp["pt_amount"])
        employee_lwf = money(comp.get("employee_lwf", 0))
        employer_contrib = {
            "employer_eps": str(money(comp["employer_eps"])),
            "employer_epf": str(money(comp["employer_epf"])),
            "employer_esi": str(money(comp["employer_esi"])),
            "employer_lwf": str(money(comp.get("employer_lwf", 0))),
        }
    else:
        # No paid days: nothing is earned, so no statutory deduction applies —
        # including LWF, which is only charged against a month with wages.
        employee_pf = employee_esi = pt_amount = employee_lwf = money(0)
        employer_contrib = {
            "employer_eps": "0.00", "employer_epf": "0.00", "employer_esi": "0.00",
            "employer_lwf": "0.00",
        }

    # No income tax: tds-service is disconnected from the platform.
    monthly_tds = money(0)
    tds_trace: dict = {}

    total_deductions = money(employee_pf + employee_esi + pt_amount + employee_lwf)
    net_pay = money(gross - total_deductions)

    attendance = {
        "total_days": total_days,
        "paid_days": str(paid_days),
        "lop_days": "0",
    }
    if att:
        attendance["present_days"] = str(att.get("present_days") or "0")
        attendance["payable_days"] = str(att["payable_days"])

    breakdown = {
        "employee": _employee_block(emp),
        "wage_type": "DAILY",
        "daily_rates": {
            "card_name": card.get("name"),
            # Derived: monthly wage / days_in_month (see above).
            "basic": str(rate_basic),
            "da": str(rate_da),
            "hra": str(rate_hra),
            "bonus_pct": str(bonus_pct),
            "days_in_month": str(days_in_month),
            "monthly_basic": str(money(card.get("monthly_basic") or 0)),
            "monthly_da": str(money(card.get("monthly_da") or 0)),
            "monthly_hra": str(money(card.get("monthly_hra") or 0)),
        },
        "earnings": {
            "basic": str(basic),
            "da": str(da),
            "hra": str(hra),
            "bonus": str(bonus),
            "gross": str(gross),
        },
        "deductions": {
            "employee_pf": str(employee_pf),
            "employee_esi": str(employee_esi),
            "pt": str(pt_amount),
            "lwf": str(employee_lwf),
            "tds": str(monthly_tds),
            "lop": "0.00",
            "other": "0.00",
        },
        "employer_contrib": employer_contrib,
        "attendance": attendance,
        "tds_trace": tds_trace,
        "net_pay": str(net_pay),
    }
    if warnings:
        breakdown["warnings"] = warnings
    return {
        "gross": gross,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
        "breakdown": breakdown,
    }


def _employee_block(emp: dict) -> dict:
    return {
        "emp_code": emp.get("emp_code"),
        "name": f"{emp.get('first_name', '')} {emp.get('last_name', '')}".strip(),
        # Masked: breakdown_json is accessible to HR admins and stored in JSONB.
        # Full PAN appears only on the employee's own Form 16 (ITA 1961 s.203).
        "pan": _mask_pan(emp.get("pan_number")),
        "bank_account": _mask_bank_account(emp.get("bank_account")),
        "designation": emp.get("designation"),
        "work_location": emp.get("work_location"),
    }


async def _result_from_register_row(
    http, token: str, cycle: PayrollCycle, emp: dict, row, mode: str
) -> dict:
    """Build a PayrollResult-shaped dict from one imported register row.

    "prefilled": the sheet's deduction/net figures are authoritative.
    "compute": PF/ESI/PT and net pay are derived from the sheet's earnings
    via compliance-service — the same calls run_cycle makes, minus the
    salary-service CTC lookup. Income tax is not deducted (tds-service is
    disconnected from the platform).
    """
    client_id = str(cycle.client_id) if cycle.client_id else None
    basic = money(row.basic)
    da = money(row.da)
    hra = money(row.hra)
    bonus = money(row.bonus)
    gross = money(row.gross)
    # Residual so the itemised earning rows add up to the sheet's gross.
    special = money(gross - (basic + da + hra + bonus))
    if special < 0:
        special = money(0)

    employer_contrib = None
    tds_trace: dict = {}

    if mode == "compute":
        comp = await client.compute_compliance(
            http,
            token,
            {
                "employee_id": emp["id"],
                "cycle_id": str(cycle.id),
                "client_id": client_id,
                # Same register convention as the daily-wage path: PF wages are
                # Basic + DA + bonus, ESI wages are Basic + DA. See the note
                # there on why HRA is outside the ESI base.
                "basic": str(money(basic + da + bonus)),
                "monthly_gross": str(gross),
                "esi_gross": str(money(basic + da)),
                "state": emp.get("state") or "ALL",
                "gender": emp.get("gender"),
                "month": cycle.period_start.month,
                "ceiling_on": settings.pf_ceiling_enabled,
            },
            client_id,
        )
        employee_pf = money(comp["employee_pf"])
        employee_esi = money(comp["employee_esi"])
        pt_amount = money(comp["pt_amount"])
        employee_lwf = money(comp.get("employee_lwf", 0))
        # No income tax: tds-service is disconnected from the platform.
        monthly_tds = money(0)
        other = money(0)
        total_deductions = money(employee_pf + employee_esi + pt_amount + employee_lwf)
        net_pay = money(gross - total_deductions)
        employer_contrib = {
            "employer_eps": str(money(comp["employer_eps"])),
            "employer_epf": str(money(comp["employer_epf"])),
            "employer_esi": str(money(comp["employer_esi"])),
            "employer_lwf": str(money(comp.get("employer_lwf", 0))),
        }
    else:
        employee_pf = money(row.employee_pf)
        employee_esi = money(row.employee_esi)
        pt_amount = money(row.pt)
        # Prefilled: the sheet's Total Ded is authoritative, so any LWF it
        # includes falls into the "other" residual below rather than being
        # computed separately.
        employee_lwf = money(0)
        monthly_tds = money(0)
        total_deductions = money(row.total_deductions)
        net_pay = money(row.net_pay)
        # Residual so the itemised deduction rows add up to the sheet's total.
        other = money(total_deductions - (employee_pf + employee_esi + pt_amount))
        if other < 0:
            other = money(0)

    attendance = {
        "total_days": row.total_days,
        "payable_days": str(row.total_days),
        "lop_days": "0",
    }
    if row.present_days is not None:
        attendance["present_days"] = str(row.present_days)
    if row.holiday_days is not None:
        attendance["holiday_days"] = str(row.holiday_days)
    if row.wo_days is not None:
        attendance["wo_days"] = str(row.wo_days)

    breakdown = {
        "employee": _employee_block(emp),
        "earnings": {
            "basic": str(basic),
            "da": str(da),
            "hra": str(hra),
            "bonus": str(bonus),
            "special_allowance": str(special),
            "gross": str(gross),
        },
        "deductions": {
            "employee_pf": str(employee_pf),
            "employee_esi": str(employee_esi),
            "pt": str(pt_amount),
            "lwf": str(employee_lwf),
            "tds": str(monthly_tds),
            "lop": "0",
            "other": str(other),
        },
        "attendance": attendance,
        "tds_trace": tds_trace,
        "net_pay": str(net_pay),
        "source": "excel_import",
        "import_mode": mode,
    }
    if employer_contrib is not None:
        breakdown["employer_contrib"] = employer_contrib
    return {
        "gross": gross,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
        "breakdown": breakdown,
    }


async def import_register(
    session: AsyncSession, ctx, token: str, cycle: PayrollCycle, rows, mode: str = "prefilled"
) -> dict:
    """Bring a cycle to COMPUTED from an imported Excel register.

    Same row-lock and state transitions as run_cycle; the numbers come from
    the uploaded rows instead of the salary/attendance services.
    """
    trace_id = uuid.uuid4()
    locked = await session.scalar(
        select(PayrollCycle)
        .where(PayrollCycle.id == cycle.id)
        .with_for_update()
    )
    if locked is not None:
        cycle = locked
    cycle.trace_id = trace_id
    state.assert_transition(cycle.status, state.LOCKED)
    cycle.status = state.LOCKED
    state.assert_transition(cycle.status, state.COMPUTING)
    cycle.status = state.COMPUTING
    await session.commit()

    imported = 0
    failed = 0
    errors: list[str] = []

    async with client.make_client() as http:
        try:
            employees = await client.list_active_employees(
                http, token, str(cycle.client_id) if cycle.client_id else None
            )
        except ServiceCallError as exc:
            logging.error("[payroll] Failed to fetch employees: %s", exc)
            cycle.status = state.FAILED
            await session.commit()
            return {
                "cycle_id": cycle.id,
                "status": cycle.status,
                "total_employees": len(rows),
                "computed": 0,
                "failed": 0,
                "errors": [str(exc)],
            }
        emp_by_id = {e["id"]: e for e in employees}

        for row in rows:
            emp = emp_by_id.get(str(row.employee_id))
            if emp is None:
                failed += 1
                errors.append(
                    f"employee {row.employee_id}: not an active employee of this cycle's client"
                )
                continue
            try:
                result = await _result_from_register_row(http, token, cycle, emp, row, mode)
                await _upsert_result(
                    session,
                    ctx.tenant_id,
                    cycle.id,
                    row.employee_id,
                    gross=result["gross"],
                    total_deductions=result["total_deductions"],
                    net_pay=result["net_pay"],
                    breakdown=result["breakdown"],
                    status="COMPUTED",
                )
                await audit_log(
                    session,
                    tenant_id=ctx.tenant_id,
                    event_type="PAYROLL_RESULT_COMPUTED",
                    entity_type="payroll_result",
                    entity_id=emp["id"],
                    payload={
                        "cycle_id": str(cycle.id),
                        "net_pay": str(result["net_pay"]),
                        "source": "excel_import",
                    },
                    actor_id=ctx.user_id,
                    trace_id=trace_id,
                )
                imported += 1
            except Exception as exc:  # per-row failure isolates
                failed += 1
                msg = f"employee {emp.get('emp_code', emp['id'])}: {exc}"
                logging.error("[payroll] Register import row failure: %s", msg)
                errors.append(msg)
                await _upsert_result(
                    session,
                    ctx.tenant_id,
                    cycle.id,
                    row.employee_id,
                    gross=money(0),
                    total_deductions=money(0),
                    net_pay=money(0),
                    breakdown={},
                    status="FAILED",
                    error=str(exc)[:500],
                )
            await session.commit()

    cycle.status = state.COMPUTED if imported > 0 or failed == 0 else state.FAILED
    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="PAYROLL_REGISTER_IMPORTED",
        entity_type="payroll_cycle",
        entity_id=str(cycle.id),
        payload={
            "cycle_id": str(cycle.id),
            "mode": mode,
            "row_count": len(rows),
            "imported": imported,
            "failed": failed,
            "source": "excel_import",
        },
        actor_id=ctx.user_id,
        trace_id=trace_id,
    )
    await session.commit()

    return {
        "cycle_id": cycle.id,
        "status": cycle.status,
        "total_employees": len(rows),
        "computed": imported,
        "failed": failed,
        "errors": errors,
    }


async def run_cycle(
    session: AsyncSession, ctx, token: str, cycle: PayrollCycle
) -> dict:
    trace_id = uuid.uuid4()
    # Row-lock the cycle and re-read its status so the guard below is atomic
    # across concurrent run requests. Without this, two callers could both read
    # a DRAFT cycle, both pass the transition check, and double-process. On
    # Postgres this is SELECT ... FOR UPDATE; on SQLite (tests) it is a no-op.
    locked = await session.scalar(
        select(PayrollCycle)
        .where(PayrollCycle.id == cycle.id)
        .with_for_update()
    )
    if locked is not None:
        cycle = locked
    cycle.trace_id = trace_id
    # DRAFT/COMPUTED/FAILED -> LOCKED -> COMPUTING. The second concurrent run
    # observes COMPUTING here and assert_transition raises 409 instead of
    # re-processing.
    state.assert_transition(cycle.status, state.LOCKED)
    cycle.status = state.LOCKED
    state.assert_transition(cycle.status, state.COMPUTING)
    cycle.status = state.COMPUTING
    await session.commit()

    computed = 0
    failed = 0
    errors: list[str] = []

    async with client.make_client() as http:
        try:
            employees = await client.list_active_employees(http, token, str(cycle.client_id) if cycle.client_id else None)
        except ServiceCallError as exc:
            logging.error("[payroll] Failed to fetch employees: %s", exc)
            cycle.status = state.FAILED
            await session.commit()
            return {
                "cycle_id": cycle.id,
                "status": cycle.status,
                "total_employees": 0,
                "computed": 0,
                "failed": 0,
                "errors": [str(exc)],
            }

        for emp in employees:
            try:
                result = await _compute_for_employee(http, token, cycle, emp, str(cycle.client_id) if cycle.client_id else None)
                await _upsert_result(
                    session,
                    ctx.tenant_id,
                    cycle.id,
                    uuid.UUID(emp["id"]),
                    gross=result["gross"],
                    total_deductions=result["total_deductions"],
                    net_pay=result["net_pay"],
                    breakdown=result["breakdown"],
                    status="COMPUTED",
                )
                await audit_log(
                    session,
                    tenant_id=ctx.tenant_id,
                    event_type="PAYROLL_RESULT_COMPUTED",
                    entity_type="payroll_result",
                    entity_id=emp["id"],
                    payload={"cycle_id": str(cycle.id), "net_pay": str(result["net_pay"])},
                    actor_id=ctx.user_id,
                    trace_id=trace_id,
                )
                computed += 1
            except Exception as exc:  # per-employee failure isolates
                failed += 1
                msg = f"employee {emp.get('emp_code', emp['id'])}: {exc}"
                logging.error("[payroll] Per-employee failure: %s", msg)
                errors.append(msg)
                await _upsert_result(
                    session,
                    ctx.tenant_id,
                    cycle.id,
                    uuid.UUID(emp["id"]),
                    gross=money(0),
                    total_deductions=money(0),
                    net_pay=money(0),
                    breakdown={},
                    status="FAILED",
                    error=str(exc)[:500],
                )
            await session.commit()

        # A re-run recomputes everyone currently eligible, but _upsert_result
        # only ever writes — results from an earlier run survive for anyone who
        # has since separated or moved to another client. The stale row keeps
        # its old figures, still counts toward the cycle totals, and prints on
        # the wage register as if that person had been paid. Drop the rows this
        # run did not touch so the cycle holds exactly who it just paid.
        live_ids = {uuid.UUID(e["id"]) for e in employees}
        existing = await session.execute(
            select(PayrollResult).where(
                PayrollResult.tenant_id == ctx.tenant_id,
                PayrollResult.cycle_id == cycle.id,
            )
        )
        for stale in existing.scalars().all():
            if stale.employee_id not in live_ids:
                await audit_log(
                    session,
                    tenant_id=ctx.tenant_id,
                    event_type="PAYROLL_RESULT_DROPPED",
                    entity_type="payroll_result",
                    entity_id=str(stale.employee_id),
                    payload={
                        "cycle_id": str(cycle.id),
                        "reason": "employee no longer eligible for this cycle",
                        "net_pay": str(stale.net_pay),
                    },
                    actor_id=ctx.user_id,
                    trace_id=trace_id,
                )
                await session.delete(stale)
        await session.commit()

    cycle.status = state.COMPUTED if computed > 0 or failed == 0 else state.FAILED
    await session.commit()

    return {
        "cycle_id": cycle.id,
        "status": cycle.status,
        "total_employees": len(employees),
        "computed": computed,
        "failed": failed,
        "errors": errors,
    }


async def approve_cycle(
    session: AsyncSession, ctx, token: str, cycle: PayrollCycle
) -> dict:
    # COMPUTED -> APPROVED on first call; re-entrant if a prior disbursement
    # attempt failed and left the cycle at APPROVED.
    if cycle.status == state.COMPUTED:
        state.assert_transition(cycle.status, state.APPROVED)
        cycle.status = state.APPROVED
        cycle.approved_by = ctx.user_id
        await session.commit()
    elif cycle.status != state.APPROVED:
        state.assert_transition(cycle.status, state.APPROVED)

    # Gather COMPUTED results to disburse.
    results = list(
        await session.scalars(
            select(PayrollResult).where(
                PayrollResult.tenant_id == ctx.tenant_id,
                PayrollResult.cycle_id == cycle.id,
                PayrollResult.status == "COMPUTED",
            )
        )
    )

    transactions = [
        {
            "employee_id": str(r.employee_id),
            "amount": str(r.net_pay),
            "bank_account": (r.breakdown_json.get("employee", {}) or {}).get(
                "bank_account"
            )
            or "UNKNOWN",
        }
        for r in results
    ]

    async with client.make_client() as http:
        # 1. Payout (simulated)
        payout = await client.create_payout_batch(
            http,
            token,
            {"cycle_id": str(cycle.id), "transactions": transactions},
            str(cycle.client_id) if cycle.client_id else None,
        )
        await audit_log(
            session,
            tenant_id=ctx.tenant_id,
            event_type="PAYOUT_BATCH_CREATED",
            entity_type="payout_batch",
            entity_id=payout.get("batch_id"),
            payload={"cycle_id": str(cycle.id), "count": len(transactions)},
            actor_id=ctx.user_id,
            trace_id=cycle.trace_id,
        )

        # 2. Payslips. The payout above has already moved the money, so a
        # reporting failure must not abort the disbursement — retrying would
        # submit the payout batch a second time. Payslips are rendered on
        # demand when they are first viewed, so pre-generation is an
        # optimisation, not a prerequisite; a failure here is recorded and the
        # cycle still completes.
        report = None
        try:
            report = await client.generate_payslips(
                http,
                token,
                {
                    "cycle_id": str(cycle.id),
                    "employee_ids": [str(r.employee_id) for r in results],
                },
                str(cycle.client_id) if cycle.client_id else None,
            )
        except ServiceCallError as exc:
            logging.error("Payslip generation failed for cycle %s: %s", cycle.id, exc)
            await audit_log(
                session,
                tenant_id=ctx.tenant_id,
                event_type="PAYSLIPS_GENERATION_FAILED",
                entity_type="report",
                entity_id=str(cycle.id),
                payload={"cycle_id": str(cycle.id), "error": str(exc)},
                actor_id=ctx.user_id,
                trace_id=cycle.trace_id,
            )
        else:
            await audit_log(
                session,
                tenant_id=ctx.tenant_id,
                event_type="PAYSLIPS_GENERATED",
                entity_type="report",
                entity_id=str(cycle.id),
                payload={"cycle_id": str(cycle.id), "generated": report.get("generated", 0)},
                actor_id=ctx.user_id,
                trace_id=cycle.trace_id,
            )

    # Mark results PAID, then cycle DISBURSED.
    for r in results:
        r.status = "PAID"
    state.assert_transition(cycle.status, state.DISBURSED)
    cycle.status = state.DISBURSED
    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="PAYROLL_CYCLE_DISBURSED",
        entity_type="payroll_cycle",
        entity_id=str(cycle.id),
        payload={"cycle_id": str(cycle.id)},
        actor_id=ctx.user_id,
        trace_id=cycle.trace_id,
    )

    # Dispatch tenant-wide notification.
    from .models import Notification
    session.add(Notification(
        tenant_id=ctx.tenant_id,
        user_id=None,  # tenant-wide; all admin users see it
        type="PAYROLL_DISBURSED",
        body=f"Payroll cycle '{cycle.name}' has been disbursed. {len(results)} employees paid.",
        link=f"/cycles/{cycle.id}",
        is_read=False,
    ))

    await session.commit()

    return {
        "cycle_id": str(cycle.id),
        "status": cycle.status,
        "payout": payout,
        "report": report,
    }
