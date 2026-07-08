from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CycleCreate(BaseModel):
    name: str
    client_id: uuid.UUID | None = None
    financial_year: str | None = None
    period_start: date
    period_end: date
    is_dry_run: bool = False


class CycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    client_id: uuid.UUID | None = None
    financial_year: str | None = None
    period_start: date
    period_end: date
    status: str
    is_dry_run: bool
    created_by: uuid.UUID | None
    approved_by: uuid.UUID | None
    trace_id: uuid.UUID | None


class ResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    cycle_id: uuid.UUID
    employee_id: uuid.UUID
    gross_earnings: Decimal
    total_deductions: Decimal
    net_pay: Decimal
    breakdown_json: dict
    status: str
    error: str | None = None


class RunSummary(BaseModel):
    cycle_id: uuid.UUID
    status: str
    total_employees: int
    computed: int
    failed: int
    errors: list[str]


class CycleSummary(BaseModel):
    cycle: CycleOut
    results: list[ResultOut]
    totals: dict
