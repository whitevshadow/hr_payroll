from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from hr_shared import RequestContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .models import AttendanceRecord
from .schemas import AttendanceOut, AttendanceUpsert

router = APIRouter(prefix="/api/v1/attendance", tags=["attendance"])


def _first_of_month(d: date) -> date:
    return d.replace(day=1)


def _parse_month(value: str) -> date:
    """Accept YYYY-MM or YYYY-MM-DD; return the 1st of that month."""
    try:
        parts = value.split("-")
        year, month = int(parts[0]), int(parts[1])
        return date(year, month, 1)
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=422, detail="Invalid month format") from exc


@router.post("/manual", response_model=AttendanceOut, status_code=200)
async def upsert_manual(
    body: AttendanceUpsert,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    month = _first_of_month(body.month)
    present = Decimal(body.present_days)
    if present > body.total_days:
        raise HTTPException(
            status_code=422, detail="present_days cannot exceed total_days"
        )
    lop = Decimal(body.total_days) - present
    payable = Decimal(body.total_days) - lop

    record = await session.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id,
            AttendanceRecord.employee_id == body.employee_id,
            AttendanceRecord.month == month,
        )
    )
    if record:
        record.total_days = body.total_days
        record.present_days = present
        record.lop_days = lop
        record.payable_days = payable
    else:
        record = AttendanceRecord(
            tenant_id=ctx.tenant_id,
            employee_id=body.employee_id,
            month=month,
            total_days=body.total_days,
            present_days=present,
            lop_days=lop,
            payable_days=payable,
            is_finalized=False,
        )
        session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


@router.get("/{employee_id}/{month}", response_model=AttendanceOut)
async def get_attendance(
    employee_id: uuid.UUID,
    month: str,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    m = _parse_month(month)
    record = await session.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.tenant_id == ctx.tenant_id,
            AttendanceRecord.employee_id == employee_id,
            AttendanceRecord.month == m,
        )
    )
    if not record:
        raise HTTPException(status_code=404, detail="No attendance record")
    return record
