from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from hr_shared import RequestContext
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_client_context, get_session, runtime
from .models import AttendanceAudit, AttendanceMonth, AttendanceRecord
from .schemas import (
    AttendanceBulkUpsert,
    AttendanceMonthOut,
    AttendanceOut,
    AttendanceUpsert,
    LockRequest,
    MonthlyListOut,
    UnlockRequest,
)
from . import leave_routes as _leave  # noqa: F401 - imported for side-effects on startup

router = APIRouter(prefix="/api/v1/attendance", tags=["attendance"])

_HR_ROLES = ("SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN")
_ADMIN_ROLES = ("SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN")

# Route-level guards — replacing bare Depends(get_client_context) on all write endpoints.
# EMPLOYEE role must never reach any attendance write path.
_require_hr = runtime.require_roles(*_HR_ROLES)      # manual, bulk, validate, lock
_require_admin = runtime.require_roles(*_ADMIN_ROLES, get_ctx=get_client_context)  # unlock (higher privilege)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _first_of_month(d: date) -> date:
    return d.replace(day=1)


def _parse_month(value: str) -> date:
    try:
        parts = value.split("-")
        return date(int(parts[0]), int(parts[1]), 1)
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail="Invalid month format") from exc


def _calc(total: int, present: Decimal, cl: Decimal, sl: Decimal, pl: Decimal,
          wo: Decimal, holiday: Decimal, wfh: Decimal):
    # WFH is a working day, not loss-of-pay — it must be subtracted like present.
    lop = Decimal(total) - present - cl - sl - pl - wo - holiday - wfh
    lop = max(Decimal("0"), lop)
    payable = Decimal(total) - lop
    pct = (present / Decimal(total) * 100).quantize(Decimal("0.01")) if total else Decimal("0")
    return lop, payable, pct


async def _get_or_create_control(
    session: AsyncSession, tenant_id: uuid.UUID, month: date
) -> AttendanceMonth:
    ctrl = await session.scalar(
        select(AttendanceMonth).where(
            AttendanceMonth.tenant_id == tenant_id,
            AttendanceMonth.month == month,
        )
    )
    if not ctrl:
        ctrl = AttendanceMonth(tenant_id=tenant_id, month=month, status="DRAFT")
        session.add(ctrl)
        await session.flush()
    return ctrl


async def _recompute_control(
    session: AsyncSession, tenant_id: uuid.UUID, month: date
) -> AttendanceMonth:
    ctrl = await _get_or_create_control(session, tenant_id, month)
    rows = (await session.scalars(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == tenant_id,
            AttendanceRecord.month == month,
        )
    )).all()
    ctrl.total_employees = len(rows)
    ctrl.employees_with_lop = sum(1 for r in rows if r.lop_days > 0)
    ctrl.completion_pct = Decimal(len(rows)).quantize(Decimal("0.01"))  # simple count
    return ctrl


async def _write_audit(
    session: AsyncSession,
    *,
    ctx: RequestContext,
    event_type: str,
    employee_id: uuid.UUID | None = None,
    month: date | None = None,
    previous_value: str | None = None,
    new_value: str | None = None,
    reason: str | None = None,
):
    session.add(AttendanceAudit(
        tenant_id=ctx.tenant_id,
        actor_id=ctx.user_id,
        employee_id=employee_id,
        month=month,
        event_type=event_type,
        previous_value=previous_value,
        new_value=new_value,
        reason=reason,
    ))




@router.post("/manual", response_model=AttendanceOut, status_code=200)
async def upsert_manual(
    body: AttendanceUpsert,
    ctx: RequestContext = Depends(_require_hr),
    session: AsyncSession = Depends(get_session),
):
    month = _first_of_month(body.month)

    # Block writes on locked month
    ctrl = await session.scalar(
        select(AttendanceMonth).where(
            AttendanceMonth.tenant_id == ctx.tenant_id,
            AttendanceMonth.month == month,
        )
    )
    if ctrl and ctrl.status == "LOCKED":
        raise HTTPException(status_code=409, detail="Attendance is LOCKED for this month")

    present = Decimal(str(body.present_days))
    lop, payable, pct = _calc(
        body.total_days, present,
        Decimal(str(body.cl_days)), Decimal(str(body.sl_days)),
        Decimal(str(body.pl_days)), Decimal(str(body.wo_days)),
        Decimal(str(body.holiday_days)), Decimal(str(body.wfh_days)),
    )

    record = await session.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id, AttendanceRecord.client_id == ctx.client_id,
            AttendanceRecord.employee_id == body.employee_id,
            AttendanceRecord.month == month,
        )
    )
    prev = f"present={record.present_days}" if record else None
    if record:
        record.total_days = body.total_days
        record.present_days = present
        record.lop_days = lop
        record.payable_days = payable
        record.cl_days = Decimal(str(body.cl_days))
        record.sl_days = Decimal(str(body.sl_days))
        record.pl_days = Decimal(str(body.pl_days))
        record.wo_days = Decimal(str(body.wo_days))
        record.holiday_days = Decimal(str(body.holiday_days))
        record.wfh_days = Decimal(str(body.wfh_days))
        record.overtime_hours = Decimal(str(body.overtime_hours))
        record.attendance_pct = pct
        record.daily_status = body.daily_status
        # V2: dual-write structured leave_breakdown JSONB
        record.leave_breakdown = record.build_leave_breakdown()
        if body.client_id:
            record.client_id = body.client_id
        if ctrl and ctrl.status == "VALIDATED":
            ctrl.status = "DRAFT"  # edit resets validation
    else:
        record = AttendanceRecord(
            tenant_id=ctx.tenant_id,
            client_id=ctx.client_id,
            employee_id=body.employee_id,
            month=month,
            total_days=body.total_days,
            present_days=present,
            lop_days=lop,
            payable_days=payable,
            cl_days=Decimal(str(body.cl_days)),
            sl_days=Decimal(str(body.sl_days)),
            pl_days=Decimal(str(body.pl_days)),
            wo_days=Decimal(str(body.wo_days)),
            holiday_days=Decimal(str(body.holiday_days)),
            wfh_days=Decimal(str(body.wfh_days)),
            overtime_hours=Decimal(str(body.overtime_hours)),
            attendance_pct=pct,
            daily_status=body.daily_status,
            is_finalized=False,
        )
        session.add(record)

    await _write_audit(
        session, ctx=ctx, event_type="ATTENDANCE_UPDATED",
        employee_id=body.employee_id, month=month,
        previous_value=prev,
        new_value=f"present={present},lop={lop}",
    )
    await _recompute_control(session, ctx.tenant_id, month)
    await session.commit()
    await session.refresh(record)
    return record


# ─── Bulk upsert ───────────────────────────────────────────────────────────────

@router.post("/bulk", status_code=200)
async def bulk_upsert(
    body: AttendanceBulkUpsert,
    ctx: RequestContext = Depends(_require_hr),
    session: AsyncSession = Depends(get_session),
):
    month = _first_of_month(body.month)

    ctrl = await session.scalar(
        select(AttendanceMonth).where(
            AttendanceMonth.tenant_id == ctx.tenant_id,
            AttendanceMonth.month == month,
        )
    )
    if ctrl and ctrl.status == "LOCKED":
        raise HTTPException(status_code=409, detail="Attendance is LOCKED for this month")

    updated = 0
    created = 0
    for item in body.records:
        present = Decimal(str(item.present_days))
        lop, payable, pct = _calc(
            item.total_days, present,
            Decimal(str(item.cl_days)), Decimal(str(item.sl_days)),
            Decimal(str(item.pl_days)), Decimal(str(item.wo_days)),
            Decimal(str(item.holiday_days)), Decimal(str(item.wfh_days)),
        )
        record = await session.scalar(
            select(AttendanceRecord).where(
                AttendanceRecord.tenant_id == ctx.tenant_id, AttendanceRecord.client_id == ctx.client_id,
                AttendanceRecord.employee_id == item.employee_id,
                AttendanceRecord.month == month,
            )
        )
        if record:
            record.total_days = item.total_days
            record.present_days = present
            record.lop_days = lop
            record.payable_days = payable
            record.cl_days = Decimal(str(item.cl_days))
            record.sl_days = Decimal(str(item.sl_days))
            record.pl_days = Decimal(str(item.pl_days))
            record.wo_days = Decimal(str(item.wo_days))
            record.holiday_days = Decimal(str(item.holiday_days))
            record.wfh_days = Decimal(str(item.wfh_days))
            record.overtime_hours = Decimal(str(item.overtime_hours))
            record.attendance_pct = pct
            record.daily_status = item.daily_status
            updated += 1
        else:
            session.add(AttendanceRecord(
                tenant_id=ctx.tenant_id,
                client_id=ctx.client_id,
                employee_id=item.employee_id,
                month=month,
                total_days=item.total_days,
                present_days=present,
                lop_days=lop,
                payable_days=payable,
                cl_days=Decimal(str(item.cl_days)),
                sl_days=Decimal(str(item.sl_days)),
                pl_days=Decimal(str(item.pl_days)),
                wo_days=Decimal(str(item.wo_days)),
                holiday_days=Decimal(str(item.holiday_days)),
                wfh_days=Decimal(str(item.wfh_days)),
                overtime_hours=Decimal(str(item.overtime_hours)),
                attendance_pct=pct,
                daily_status=item.daily_status,
                is_finalized=False,
            ))
            created += 1

    if ctrl and ctrl.status == "VALIDATED":
        ctrl.status = "DRAFT"

    await _write_audit(
        session, ctx=ctx, event_type="ATTENDANCE_IMPORTED",
        month=month,
        new_value=f"source={body.source},created={created},updated={updated}",
    )
    await _recompute_control(session, ctx.tenant_id, month)
    await session.commit()
    return {"created": created, "updated": updated, "month": str(month), "source": body.source}


# ─── Monthly list ──────────────────────────────────────────────────────────────

@router.get("/monthly/{month}", response_model=MonthlyListOut)
async def get_monthly(
    month: str,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    ctrl = await session.scalar(
        select(AttendanceMonth).where(
            AttendanceMonth.tenant_id == ctx.tenant_id,
            AttendanceMonth.month == m,
        )
    )
    records = (await session.scalars(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id, AttendanceRecord.client_id == ctx.client_id,
            AttendanceRecord.month == m,
        )
    )).all()
    return {"month_control": ctrl, "records": list(records)}


# ─── Month status ─────────────────────────────────────────────────────────────

@router.get("/monthly/{month}/status", response_model=AttendanceMonthOut)
async def get_month_status(
    month: str,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    ctrl = await _get_or_create_control(session, ctx.tenant_id, m)
    await session.commit()
    await session.refresh(ctrl)
    return ctrl


# ─── Validate month ───────────────────────────────────────────────────────────

@router.post("/monthly/{month}/validate", response_model=AttendanceMonthOut)
async def validate_month(
    month: str,
    ctx: RequestContext = Depends(_require_hr),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    ctrl = await _get_or_create_control(session, ctx.tenant_id, m)
    if ctrl.status == "LOCKED":
        raise HTTPException(status_code=409, detail="Cannot validate a LOCKED month")
    ctrl.status = "VALIDATED"
    ctrl.validated_by = ctx.user_id
    ctrl.validated_at = datetime.now(timezone.utc)
    await _write_audit(session, ctx=ctx, event_type="ATTENDANCE_VALIDATED", month=m)
    await session.commit()
    await session.refresh(ctrl)
    return ctrl


# ─── Lock month ───────────────────────────────────────────────────────────────

@router.post("/monthly/{month}/lock", response_model=AttendanceMonthOut)
async def lock_month(
    month: str,
    body: LockRequest,
    ctx: RequestContext = Depends(_require_hr),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    ctrl = await _get_or_create_control(session, ctx.tenant_id, m)
    if ctrl.status == "LOCKED":
        raise HTTPException(status_code=409, detail="Month is already LOCKED")

    # Mark all records as finalized
    records = (await session.scalars(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id, AttendanceRecord.client_id == ctx.client_id,
            AttendanceRecord.month == m,
        )
    )).all()
    for r in records:
        r.is_finalized = True

    ctrl.status = "LOCKED"
    ctrl.locked_by = ctx.user_id
    ctrl.locked_at = datetime.now(timezone.utc)
    ctrl.locked_reason = body.reason
    await _write_audit(
        session, ctx=ctx, event_type="ATTENDANCE_LOCKED",
        month=m, reason=body.reason,
        new_value=f"employees={len(records)}",
    )
    await session.commit()
    await session.refresh(ctrl)
    return ctrl


# ─── Unlock month (admin only) ────────────────────────────────────────────────

@router.post("/monthly/{month}/unlock", response_model=AttendanceMonthOut)
async def unlock_month(
    month: str,
    body: UnlockRequest,
    ctx: RequestContext = Depends(_require_admin),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    ctrl = await session.scalar(
        select(AttendanceMonth).where(
            AttendanceMonth.tenant_id == ctx.tenant_id,
            AttendanceMonth.month == m,
        )
    )
    if not ctrl or ctrl.status != "LOCKED":
        raise HTTPException(status_code=409, detail="Month is not LOCKED")

    # Revert finalized flag on records
    records = (await session.scalars(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id, AttendanceRecord.client_id == ctx.client_id,
            AttendanceRecord.month == m,
        )
    )).all()
    for r in records:
        r.is_finalized = False

    ctrl.status = "DRAFT"
    ctrl.unlocked_by = ctx.user_id
    ctrl.unlocked_at = datetime.now(timezone.utc)
    ctrl.unlock_reason = body.reason
    await _write_audit(
        session, ctx=ctx, event_type="ATTENDANCE_UNLOCKED",
        month=m, reason=body.reason,
    )
    await session.commit()
    await session.refresh(ctrl)
    return ctrl


# ─── Single record — MUST be last: wildcard {employee_id} would otherwise ───────
# ─── shadow the more-specific /monthly/… routes registered above it.       ───────

@router.get("/{employee_id}/{month}", response_model=AttendanceOut)
async def get_attendance(
    employee_id: uuid.UUID,
    month: str,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    record = await session.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id, AttendanceRecord.client_id == ctx.client_id,
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.month == m,
        )
    )
    if not record:
        raise HTTPException(status_code=404, detail="No attendance record")
    return record
