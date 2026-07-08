from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from hr_shared import AuditLog, RequestContext
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import orchestrator
from .client import ServiceCallError
from .deps import get_context, get_client_context, get_session, runtime
from .models import Notification, NotificationBase, PayrollCycle, PayrollResult
from .schemas import (
    CycleCreate,
    CycleOut,
    CycleSummary,
    ResultOut,
    RunSummary,
)

router = APIRouter(prefix="/api/v1", tags=["payroll"])

# Approve & audit are admin-only — HR_MANAGER is excluded per the role spec.
_admin_only = runtime.require_roles("ORG_ADMIN", "PAYROLL_ADMIN", "SUPER_ADMIN")


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return auth.split(" ", 1)[1]


async def _load_cycle(session, tenant_id, cycle_id) -> PayrollCycle:
    cycle = await session.get(PayrollCycle, cycle_id)
    if not cycle or cycle.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return cycle


@router.post("/payroll/cycles", response_model=CycleOut, status_code=201)
async def create_cycle(
    body: CycleCreate,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    cycle = PayrollCycle(
        tenant_id=ctx.tenant_id,
        name=body.name,
        client_id=body.client_id or ctx.client_id,
        financial_year=body.financial_year,
        period_start=body.period_start,
        period_end=body.period_end,
        is_dry_run=body.is_dry_run,
        status="DRAFT",
        created_by=ctx.user_id,
    )
    session.add(cycle)
    await session.commit()
    await session.refresh(cycle)
    return cycle


@router.get("/payroll/cycles", response_model=list[CycleOut])
async def list_cycles(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
    client_id: uuid.UUID | None = None,
    financial_year: str | None = None,
):
    q = select(PayrollCycle).where(PayrollCycle.tenant_id == ctx.tenant_id)
    if client_id:
        q = q.where(PayrollCycle.client_id == client_id)
    if financial_year:
        q = q.where(PayrollCycle.financial_year == financial_year)
    
    rows = await session.scalars(q.order_by(PayrollCycle.created_at.desc()))
    return list(rows)


@router.get("/payroll/cycles/{cycle_id}", response_model=CycleOut)
async def get_cycle(
    cycle_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    return await _load_cycle(session, ctx.tenant_id, cycle_id)


@router.post("/payroll/cycles/{cycle_id}/run", response_model=RunSummary)
async def run_cycle(
    cycle_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    cycle = await _load_cycle(session, ctx.tenant_id, cycle_id)
    token = _bearer(request)
    summary = await orchestrator.run_cycle(session, ctx, token, cycle)
    return RunSummary(**summary)


@router.post("/payroll/cycles/{cycle_id}/approve")
async def approve_cycle(
    cycle_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(_admin_only),
    session: AsyncSession = Depends(get_session),
):
    cycle = await _load_cycle(session, ctx.tenant_id, cycle_id)
    token = _bearer(request)
    try:
        return await orchestrator.approve_cycle(session, ctx, token, cycle)
    except ServiceCallError as exc:
        # Leave the cycle at APPROVED so disbursement can be retried.
        raise HTTPException(status_code=502, detail=f"Disbursement failed: {exc}")


_PRIVILEGED = ("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


async def _result_for(session, tenant_id, cycle_id, employee_id):
    row = await session.scalar(
        select(PayrollResult).where(
            PayrollResult.tenant_id == tenant_id,
            PayrollResult.cycle_id == cycle_id,
            PayrollResult.employee_id == employee_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Result not found")
    return row


@router.get("/payroll/results/me/{cycle_id}", response_model=ResultOut)
async def get_my_result(
    cycle_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Self-service: return the caller's own result for a cycle."""
    token = _bearer(request)
    from . import client as svc_client
    async with svc_client.make_client() as http:
        emp = await svc_client.get_my_employee(http, token)
    return await _result_for(session, ctx.tenant_id, cycle_id, uuid.UUID(emp["id"]))


@router.get("/payroll/results/{cycle_id}/{employee_id}", response_model=ResultOut)
async def get_result(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    # EMPLOYEE-only role may read only their own result.
    if not any(r in ctx.roles for r in _PRIVILEGED):
        token = _bearer(request)
        from . import client as svc_client
        async with svc_client.make_client() as http:
            try:
                emp = await svc_client.get_my_employee(http, token)
            except ServiceCallError:
                raise HTTPException(status_code=403, detail="Access denied")
        if str(employee_id) != emp["id"]:
            raise HTTPException(status_code=403, detail="Access denied")
    return await _result_for(session, ctx.tenant_id, cycle_id, employee_id)


@router.get("/payroll/cycles/{cycle_id}/summary", response_model=CycleSummary)
async def cycle_summary(
    cycle_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    cycle = await _load_cycle(session, ctx.tenant_id, cycle_id)
    rows = list(
        await session.scalars(
            select(PayrollResult).where(
                PayrollResult.tenant_id == ctx.tenant_id,
                PayrollResult.cycle_id == cycle_id,
            )
        )
    )
    totals = {
        "gross": str(sum((r.gross_earnings for r in rows), start=Decimal("0"))),
        "deductions": str(sum((r.total_deductions for r in rows), start=Decimal("0"))),
        "net": str(sum((r.net_pay for r in rows), start=Decimal("0"))),
        "count": len(rows),
    }
    return CycleSummary(cycle=cycle, results=rows, totals=totals)


# ---- Audit log (read-only, filterable) --------------------------------
# Audit is admin-only — HR_MANAGER excluded per the role spec (§2).

@router.get("/audit")
async def list_audit(
    ctx: RequestContext = Depends(_admin_only),
    session: AsyncSession = Depends(get_session),
    event_type: str | None = None,
    entity_type: str | None = None,
    actor_id: uuid.UUID | None = None,
    trace_id: uuid.UUID | None = None,
    from_dt: datetime | None = Query(None, alias="from"),
    to_dt: datetime | None = Query(None, alias="to"),
    limit: int = Query(100, le=500),
):
    stmt = select(AuditLog).where(AuditLog.tenant_id == ctx.tenant_id)
    if event_type:
        stmt = stmt.where(AuditLog.event_type == event_type)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if trace_id:
        stmt = stmt.where(AuditLog.trace_id == trace_id)
    if from_dt:
        stmt = stmt.where(AuditLog.created_at >= from_dt)
    if to_dt:
        stmt = stmt.where(AuditLog.created_at <= to_dt)
    stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit)
    rows = await session.scalars(stmt)
    return [
        {
            "id": str(r.id),
            "event_type": r.event_type,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "actor_id": str(r.actor_id) if r.actor_id else None,
            "trace_id": str(r.trace_id) if r.trace_id else None,
            "payload": r.payload_json,
            "payload_hash": r.payload_hash,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ---- Notifications -------------------------------------------------------

@router.get("/notifications")
async def get_notifications(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
    limit: int = Query(20, le=100),
):
    """Return the latest notifications for this user/tenant."""
    from sqlalchemy import or_
    stmt = (
        select(Notification)
        .where(
            Notification.tenant_id == ctx.tenant_id,
            or_(Notification.user_id == ctx.user_id, Notification.user_id.is_(None)),
        )
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    rows = await session.scalars(stmt)
    items = list(rows)
    return {
        "unread_count": sum(1 for n in items if not n.is_read),
        "notifications": [
            {
                "id": str(n.id),
                "type": n.type,
                "body": n.body,
                "link": n.link,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat(),
            }
            for n in items
        ],
    }


@router.post("/notifications/{notification_id}/read", status_code=204)
async def mark_read(
    notification_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    from sqlalchemy import or_
    n = await session.get(Notification, notification_id)
    if not n or n.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Notification not found")
    if n.user_id and n.user_id != ctx.user_id:
        raise HTTPException(status_code=403, detail="Not your notification")
    n.is_read = True
    await session.commit()
