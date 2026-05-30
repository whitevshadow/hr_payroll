from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class StructureCreate(BaseModel):
    employee_id: uuid.UUID
    ctc: Decimal
    effective_from: date
    work_location: str | None = None


class StructureRevise(BaseModel):
    ctc: Decimal
    effective_from: date
    work_location: str | None = None


class ComponentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    component_name: str
    amount: Decimal
    component_type: str
    is_taxable: bool


class Breakdown(BaseModel):
    monthly_gross: Decimal
    basic: Decimal
    hra: Decimal
    special_allowance: Decimal
    is_metro: bool


class StructureOut(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    ctc: Decimal
    effective_from: date
    effective_to: date | None
    is_active: bool
    work_location: str | None
    components: list[ComponentOut]
    breakdown: Breakdown
