from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


# ── Salary Templates ──────────────────────────────────────────────────────────

class TemplateComponent(BaseModel):
    name: str
    type: str = "EARNING"  # EARNING|DEDUCTION
    is_taxable: bool = True
    value_type: str = "FIXED"  # FIXED|PERCENTAGE
    value: Decimal
    percentage_of: str | None = None  # e.g., "BASIC", "CTC"


class SalaryTemplateCreate(BaseModel):
    client_id: uuid.UUID | None = None
    template_name: str
    description: str | None = None
    is_active: bool = True
    template_components: list[TemplateComponent] = []


class SalaryTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID | None
    template_name: str
    description: str | None
    is_active: bool
    template_components: list[dict]


# ── Salary Structures ─────────────────────────────────────────────────────────

class StructureCreate(BaseModel):
    employee_id: uuid.UUID
    ctc: Decimal
    effective_from: date
    work_location: str | None = None
    template_id: uuid.UUID | None = None


class StructureRevise(BaseModel):
    ctc: Decimal
    effective_from: date
    work_location: str | None = None
    template_id: uuid.UUID | None = None


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
    conveyance: Decimal = Decimal("0")
    medical: Decimal = Decimal("0")
    is_metro: bool


class StructureOut(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    ctc: Decimal
    effective_from: date
    effective_to: date | None
    is_active: bool
    work_location: str | None
    template_id: uuid.UUID | None = None
    components: list[ComponentOut]
    breakdown: Breakdown
