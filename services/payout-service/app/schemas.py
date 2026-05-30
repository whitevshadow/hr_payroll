from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class TxnIn(BaseModel):
    employee_id: uuid.UUID
    amount: Decimal
    bank_account: str = "UNKNOWN"


class BatchCreate(BaseModel):
    cycle_id: uuid.UUID
    transactions: list[TxnIn]


class TxnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    amount: Decimal
    status: str
    bank_reference: str | None
    idempotency_key: str


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    cycle_id: uuid.UUID
    batch_type: str
    total_amount: Decimal
    status: str


class BatchCreateResponse(BaseModel):
    batch_id: uuid.UUID
    cycle_id: uuid.UUID
    total_amount: Decimal
    count: int
    status: str
