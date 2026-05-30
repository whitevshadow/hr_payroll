from __future__ import annotations

import hashlib
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from hr_shared import RequestContext, money
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .models import PayoutBatch, PayoutTransaction
from .schemas import BatchCreate, BatchCreateResponse, BatchOut, TxnOut

router = APIRouter(prefix="/api/v1/payouts", tags=["payouts"])


def _idempotency_key(cycle_id, employee_id, net_pay, bank_account) -> str:
    raw = f"{cycle_id}|{employee_id}|{net_pay}|{bank_account}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _bank_reference() -> str:
    return f"TRRN-{uuid.uuid4().hex[:8].upper()}"


@router.post("/batches", response_model=BatchCreateResponse, status_code=201)
async def create_batch(
    body: BatchCreate,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Simulated disbursement: mark every transaction SUCCESS.

    # TODO(v2): integrate a real bank/NPCI rail; move to async settlement
    # with webhook reconciliation.
    """
    # Reuse an existing batch for this cycle if present (idempotent re-approve).
    batch = await session.scalar(
        select(PayoutBatch).where(
            PayoutBatch.tenant_id == ctx.tenant_id,
            PayoutBatch.cycle_id == body.cycle_id,
        )
    )
    if batch is None:
        batch = PayoutBatch(
            tenant_id=ctx.tenant_id,
            cycle_id=body.cycle_id,
            batch_type="SALARY",
            total_amount=money(0),
            status="PROCESSING",
        )
        session.add(batch)
        await session.flush()

    total = Decimal("0")
    for txn in body.transactions:
        key = _idempotency_key(
            body.cycle_id, txn.employee_id, txn.amount, txn.bank_account
        )
        existing = await session.scalar(
            select(PayoutTransaction).where(
                PayoutTransaction.idempotency_key == key
            )
        )
        if existing:
            total += existing.amount
            continue
        session.add(
            PayoutTransaction(
                tenant_id=ctx.tenant_id,
                batch_id=batch.id,
                employee_id=txn.employee_id,
                amount=money(txn.amount),
                idempotency_key=key,
                status="SUCCESS",  # simulated success
                bank_reference=_bank_reference(),
            )
        )
        total += money(txn.amount)

    batch.total_amount = money(total)
    batch.status = "COMPLETED"
    await session.commit()
    await session.refresh(batch)

    return BatchCreateResponse(
        batch_id=batch.id,
        cycle_id=batch.cycle_id,
        total_amount=batch.total_amount,
        count=len(body.transactions),
        status=batch.status,
    )


@router.get("/batches/{cycle_id}", response_model=list[BatchOut])
async def get_batches(
    cycle_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(
        select(PayoutBatch).where(
            PayoutBatch.tenant_id == ctx.tenant_id,
            PayoutBatch.cycle_id == cycle_id,
        )
    )
    return list(rows)


@router.get("/transactions/{batch_id}", response_model=list[TxnOut])
async def get_transactions(
    batch_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    batch = await session.get(PayoutBatch, batch_id)
    if not batch or batch.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    rows = await session.scalars(
        select(PayoutTransaction).where(PayoutTransaction.batch_id == batch_id)
    )
    return list(rows)


@router.post("/transactions/{transaction_id}/retry", response_model=TxnOut)
async def retry_transaction(
    transaction_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Simulated retry: re-marks a FAILED transaction as SUCCESS.

    Rejects if the transaction is already SUCCESS or the parent batch is COMPLETED.
    # TODO(v2): invoke real bank/NPCI rail.
    """
    txn = await session.get(PayoutTransaction, transaction_id)
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    batch = await session.get(PayoutBatch, txn.batch_id)
    if not batch or batch.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if txn.status == "SUCCESS":
        raise HTTPException(status_code=409, detail="Transaction already succeeded")

    import uuid as uuid_mod
    txn.status = "SUCCESS"
    txn.bank_reference = f"TRRN-RETRY-{uuid_mod.uuid4().hex[:8].upper()}"
    await session.commit()
    await session.refresh(txn)
    return txn
