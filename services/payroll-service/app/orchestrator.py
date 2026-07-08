"""The synchronous payroll orchestration (section 6)."""

from __future__ import annotations

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
    http, token: str, cycle: PayrollCycle, emp: dict
) -> dict:
    """Pull from every service and aggregate. Returns the result dict."""
    employee_id = emp["id"]

    salary = await client.get_salary_breakdown(http, token, employee_id)
    bd = salary["breakdown"]
    monthly_gross = money(bd["monthly_gross"])
    basic = money(bd["basic"])
    hra = money(bd["hra"])
    special = money(bd["special_allowance"])

    # Attendance (fall back to full period, no LOP, if not entered).
    period_days = (cycle.period_end - cycle.period_start).days + 1
    att = await client.get_attendance(http, token, employee_id, _month_str(cycle.period_start))
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
            "month": cycle.period_start.month,
            "ceiling_on": settings.pf_ceiling_enabled,
        },
    )
    employee_pf = money(comp["employee_pf"])
    employee_esi = money(comp["employee_esi"])
    pt_amount = money(comp["pt_amount"])

    # TDS
    tds = await client.compute_tds(
        http,
        token,
        {
            "employee_id": employee_id,
            "cycle_id": str(cycle.id),
            "monthly_gross": str(monthly_gross),
        },
    )
    monthly_tds = money(tds["monthly_tds"])

    other = money(0)
    total_deductions = money(
        employee_pf + employee_esi + pt_amount + monthly_tds + lop_deduction + other
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
            "tds": str(monthly_tds),
            "lop": str(lop_deduction),
            "other": str(other),
        },
        "employer_contrib": {
            "employer_eps": str(money(comp["employer_eps"])),
            "employer_epf": str(money(comp["employer_epf"])),
            "employer_esi": str(money(comp["employer_esi"])),
        },
        "attendance": {
            "total_days": total_days,
            "payable_days": str(payable_days),
            "lop_days": str(lop_days),
        },
        "tds_trace": tds.get("tax_trace", {}),
        "net_pay": str(net_pay),
    }
    return {
        "gross": monthly_gross,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
        "breakdown": breakdown,
    }


async def run_cycle(
    session: AsyncSession, ctx, token: str, cycle: PayrollCycle
) -> dict:
    trace_id = uuid.uuid4()
    cycle.trace_id = trace_id
    # DRAFT/COMPUTED/FAILED -> LOCKED -> COMPUTING
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
            employees = await client.list_active_employees(http, token)
        except ServiceCallError as exc:
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
                result = await _compute_for_employee(http, token, cycle, emp)
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

        # 2. Payslips
        report = await client.generate_payslips(
            http,
            token,
            {
                "cycle_id": str(cycle.id),
                "employee_ids": [str(r.employee_id) for r in results],
            },
        )
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
