"""Leave Management Routes for attendance-service.

Covers: policies, requests, balances, transactions, accruals.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from hr_shared import RequestContext, audit_log
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session, runtime
from .models import LeaveBalance, LeavePolicy, LeaveRequest, LeaveTransaction
from .schemas import (
    LeaveAccrualRequest,
    LeaveBalanceOut,
    LeavePolicyCreate,
    LeavePolicyOut,
    LeaveRequestCreate,
    LeaveRequestOut,
    LeaveRequestUpdate,
    LeaveTransactionOut,
)

router = APIRouter(prefix="/api/v1/leave", tags=["leave"])

_HR = runtime.require_roles("SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN")
_ANY = get_context   # any authenticated user


def _current_financial_year() -> str:
    today = date.today()
    year = today.year if today.month >= 4 else today.year - 1
    return f"{year}-{str(year + 1)[-2:]}"


# ── Leave Policies ────────────────────────────────────────────────────────────

@router.get("/policies", response_model=list[LeavePolicyOut])
async def list_leave_policies(
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
    client_id: uuid.UUID | None = None,
    leave_type: str | None = None,
):
    q = select(LeavePolicy).where(
        LeavePolicy.tenant_id == ctx.tenant_id,
        LeavePolicy.is_active.is_(True),
    )
    if client_id:
        q = q.where(LeavePolicy.client_id == client_id)
    if leave_type:
        q = q.where(LeavePolicy.leave_type == leave_type)
    rows = await session.scalars(q.order_by(LeavePolicy.name))
    return list(rows)


@router.post("/policies", response_model=LeavePolicyOut, status_code=201)
async def create_leave_policy(
    body: LeavePolicyCreate,
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
):
    policy = LeavePolicy(tenant_id=ctx.tenant_id, **body.model_dump())
    session.add(policy)
    await session.commit()
    await session.refresh(policy)
    return policy


@router.delete("/policies/{policy_id}", status_code=204)
async def deactivate_leave_policy(
    policy_id: uuid.UUID,
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
):
    policy = await session.get(LeavePolicy, policy_id)
    if not policy or policy.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Policy not found")
    policy.is_active = False
    await session.commit()


# ── Leave Requests ────────────────────────────────────────────────────────────

@router.post("/requests", response_model=LeaveRequestOut, status_code=201)
async def submit_leave_request(
    body: LeaveRequestCreate,
    ctx: RequestContext = Depends(_ANY),
    session: AsyncSession = Depends(get_session),
):
    """Submit a leave application. Balance validation is advisory (not hard-blocked)."""
    financial_year = body.financial_year or _current_financial_year()

    # Check balance availability
    balance = await session.scalar(
        select(LeaveBalance).where(
            LeaveBalance.tenant_id == ctx.tenant_id,
            LeaveBalance.employee_id == body.employee_id,
            LeaveBalance.leave_type == body.leave_type,
            LeaveBalance.financial_year == financial_year,
        )
    )
    if balance and balance.closing_balance < body.days:
        # Advisory warning — not blocking (LOP may apply)
        pass  # could raise 422 if policy.encashable is False

    req = LeaveRequest(
        tenant_id=ctx.tenant_id,
        employee_id=body.employee_id,
        leave_type=body.leave_type,
        from_date=body.from_date,
        to_date=body.to_date,
        days=body.days,
        reason=body.reason,
        financial_year=financial_year,
        status="PENDING",
        applied_by=ctx.user_id,
    )
    session.add(req)
    await session.flush()
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="LEAVE_REQUEST_SUBMITTED",
                    entity_type="leave_request", entity_id=str(req.id),
                    payload={"employee_id": str(body.employee_id), "leave_type": body.leave_type,
                             "from_date": str(body.from_date), "to_date": str(body.to_date),
                             "days": float(body.days)},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(req)
    return req


@router.get("/requests", response_model=list[LeaveRequestOut])
async def list_leave_requests(
    ctx: RequestContext = Depends(_ANY),
    session: AsyncSession = Depends(get_session),
    employee_id: uuid.UUID | None = None,
    status: str | None = None,
    leave_type: str | None = None,
    financial_year: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = select(LeaveRequest).where(LeaveRequest.tenant_id == ctx.tenant_id)
    if employee_id:
        q = q.where(LeaveRequest.employee_id == employee_id)
    if status:
        q = q.where(LeaveRequest.status == status)
    if leave_type:
        q = q.where(LeaveRequest.leave_type == leave_type)
    if financial_year:
        q = q.where(LeaveRequest.financial_year == financial_year)
    if from_date:
        q = q.where(LeaveRequest.from_date >= from_date)
    if to_date:
        q = q.where(LeaveRequest.to_date <= to_date)
    q = q.order_by(LeaveRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = await session.scalars(q)
    return list(rows)


@router.post("/requests/{request_id}/approve", response_model=LeaveRequestOut)
async def approve_leave_request(
    request_id: uuid.UUID,
    body: LeaveRequestUpdate = LeaveRequestUpdate(status="APPROVED"),
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
):
    req = await session.get(LeaveRequest, request_id)
    if not req or req.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status != "PENDING":
        raise HTTPException(status_code=409, detail=f"Cannot approve request in status {req.status!r}")

    req.status = "APPROVED"
    req.reviewed_by = ctx.user_id
    req.reviewed_at = datetime.now(tz=timezone.utc)
    req.review_comment = body.comment

    # Debit the leave balance
    fy = req.financial_year or _current_financial_year()
    balance = await session.scalar(
        select(LeaveBalance).where(
            LeaveBalance.tenant_id == ctx.tenant_id,
            LeaveBalance.employee_id == req.employee_id,
            LeaveBalance.leave_type == req.leave_type,
            LeaveBalance.financial_year == fy,
        )
    )
    if balance:
        balance.used += req.days
        balance.closing_balance = balance.opening_balance + balance.accrued - balance.used - balance.carry_forward_used
        balance_after = balance.closing_balance
    else:
        balance_after = None

    # Record ledger transaction
    txn = LeaveTransaction(
        tenant_id=ctx.tenant_id,
        employee_id=req.employee_id,
        leave_request_id=req.id,
        leave_type=req.leave_type,
        financial_year=fy,
        transaction_type="DEBIT",
        days=req.days,
        balance_after=balance_after,
        note=f"Leave approved: {req.from_date} to {req.to_date}",
    )
    session.add(txn)

    await audit_log(session, tenant_id=ctx.tenant_id, event_type="LEAVE_REQUEST_APPROVED",
                    entity_type="leave_request", entity_id=str(request_id),
                    payload={"employee_id": str(req.employee_id), "days": float(req.days)},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(req)
    return req


@router.post("/requests/{request_id}/reject", response_model=LeaveRequestOut)
async def reject_leave_request(
    request_id: uuid.UUID,
    body: LeaveRequestUpdate,
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
):
    req = await session.get(LeaveRequest, request_id)
    if not req or req.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status not in ("PENDING",):
        raise HTTPException(status_code=409, detail=f"Cannot reject request in status {req.status!r}")

    req.status = "REJECTED"
    req.reviewed_by = ctx.user_id
    req.reviewed_at = datetime.now(tz=timezone.utc)
    req.review_comment = body.comment

    await audit_log(session, tenant_id=ctx.tenant_id, event_type="LEAVE_REQUEST_REJECTED",
                    entity_type="leave_request", entity_id=str(request_id),
                    payload={"employee_id": str(req.employee_id), "comment": body.comment},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(req)
    return req


@router.post("/requests/{request_id}/cancel", response_model=LeaveRequestOut)
async def cancel_leave_request(
    request_id: uuid.UUID,
    ctx: RequestContext = Depends(_ANY),
    session: AsyncSession = Depends(get_session),
):
    req = await session.get(LeaveRequest, request_id)
    if not req or req.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if req.status not in ("PENDING", "APPROVED"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel request in status {req.status!r}")

    was_approved = req.status == "APPROVED"
    req.status = "CANCELLED"
    req.reviewed_at = datetime.now(tz=timezone.utc)

    # If it was approved, credit back the balance
    if was_approved:
        fy = req.financial_year or _current_financial_year()
        balance = await session.scalar(
            select(LeaveBalance).where(
                LeaveBalance.tenant_id == ctx.tenant_id,
                LeaveBalance.employee_id == req.employee_id,
                LeaveBalance.leave_type == req.leave_type,
                LeaveBalance.financial_year == fy,
            )
        )
        if balance:
            balance.used = max(Decimal("0"), balance.used - req.days)
            balance.closing_balance = balance.opening_balance + balance.accrued - balance.used - balance.carry_forward_used
            txn = LeaveTransaction(
                tenant_id=ctx.tenant_id,
                employee_id=req.employee_id,
                leave_request_id=req.id,
                leave_type=req.leave_type,
                financial_year=fy,
                transaction_type="CREDIT",
                days=req.days,
                balance_after=balance.closing_balance,
                note="Leave cancelled — balance restored",
            )
            session.add(txn)

    await session.commit()
    await session.refresh(req)
    return req


# ── Leave Balances ────────────────────────────────────────────────────────────

@router.get("/balances/{employee_id}", response_model=list[LeaveBalanceOut])
async def get_employee_leave_balances(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(_ANY),
    session: AsyncSession = Depends(get_session),
    financial_year: str | None = None,
):
    fy = financial_year or _current_financial_year()
    q = select(LeaveBalance).where(
        LeaveBalance.tenant_id == ctx.tenant_id,
        LeaveBalance.employee_id == employee_id,
        LeaveBalance.financial_year == fy,
    )
    rows = await session.scalars(q)
    return list(rows)


@router.get("/balances", response_model=list[LeaveBalanceOut])
async def list_all_leave_balances(
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
    financial_year: str | None = None,
    employee_id: uuid.UUID | None = None,
    leave_type: str | None = None,
):
    fy = financial_year or _current_financial_year()
    q = select(LeaveBalance).where(
        LeaveBalance.tenant_id == ctx.tenant_id,
        LeaveBalance.financial_year == fy,
    )
    if employee_id:
        q = q.where(LeaveBalance.employee_id == employee_id)
    if leave_type:
        q = q.where(LeaveBalance.leave_type == leave_type)
    rows = await session.scalars(q)
    return list(rows)


@router.post("/balances/initialize", status_code=201)
async def initialize_leave_balance(
    employee_id: uuid.UUID,
    leave_type: str,
    financial_year: str,
    opening_balance: Decimal = Decimal("0"),
    ctx: RequestContext = Depends(_HR),
    session: AsyncSession = Depends(get_session),
):
    """Initialize leave balance for an employee for a financial year."""
    existing = await session.scalar(
        select(LeaveBalance).where(
            LeaveBalance.tenant_id == ctx.tenant_id,
            LeaveBalance.employee_id == employee_id,
            LeaveBalance.leave_type == leave_type,
            LeaveBalance.financial_year == financial_year,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Leave balance already exists")

    bal = LeaveBalance(
        tenant_id=ctx.tenant_id,
        employee_id=employee_id,
        leave_type=leave_type,
        financial_year=financial_year,
        opening_balance=opening_balance,
        accrued=Decimal("0"),
        used=Decimal("0"),
        carry_forward_used=Decimal("0"),
        closing_balance=opening_balance,
    )
    session.add(bal)
    await session.commit()
    await session.refresh(bal)
    return bal


# ── Leave Transactions ────────────────────────────────────────────────────────

@router.get("/transactions/{employee_id}", response_model=list[LeaveTransactionOut])
async def get_leave_transactions(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(_ANY),
    session: AsyncSession = Depends(get_session),
    financial_year: str | None = None,
    leave_type: str | None = None,
):
    fy = financial_year or _current_financial_year()
    q = select(LeaveTransaction).where(
        LeaveTransaction.tenant_id == ctx.tenant_id,
        LeaveTransaction.employee_id == employee_id,
        LeaveTransaction.financial_year == fy,
    )
    if leave_type:
        q = q.where(LeaveTransaction.leave_type == leave_type)
    rows = await session.scalars(q.order_by(LeaveTransaction.created_at.desc()))
    return list(rows)
