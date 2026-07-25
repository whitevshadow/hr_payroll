from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ── Compute ───────────────────────────────────────────────────────────────────

class ComputeRequest(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    basic: Decimal
    monthly_gross: Decimal
    state: str
    month: int = 1  # calendar month number (1-12), for PT February rule
    ceiling_on: bool = True
    client_id: Optional[uuid.UUID] = None


class ComputeResponse(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    pf_wages: Decimal
    employee_pf: Decimal
    employer_eps: Decimal
    employer_epf: Decimal
    is_ceiling_applied: bool
    gross_wages: Decimal
    is_esi_eligible: bool
    employee_esi: Decimal
    employer_esi: Decimal
    state: str
    pt_amount: Decimal
    employee_lwf: Decimal = Decimal("0")
    employer_lwf: Decimal = Decimal("0")


# ── Compliance Settings ───────────────────────────────────────────────────────

class ComplianceSettingCreate(BaseModel):
    client_id: Optional[uuid.UUID] = None
    state: str = "ALL"
    
    pf_enabled: bool = True
    pf_employer_rate: Decimal = Decimal("12.0")
    pf_employee_rate: Decimal = Decimal("12.0")
    pf_wage_limit: Decimal = Decimal("15000.0")
    
    esi_enabled: bool = True
    esi_employer_rate: Decimal = Decimal("3.25")
    esi_employee_rate: Decimal = Decimal("0.75")
    esi_wage_limit: Decimal = Decimal("21000.0")
    
    pt_enabled: bool = True
    lwf_enabled: bool = False
    
    bonus_enabled: bool = False
    gratuity_enabled: bool = False


class ComplianceSettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: Optional[uuid.UUID]
    state: str
    pf_enabled: bool
    pf_employer_rate: Decimal
    pf_employee_rate: Decimal
    pf_wage_limit: Decimal
    esi_enabled: bool
    esi_employer_rate: Decimal
    esi_employee_rate: Decimal
    esi_wage_limit: Decimal
    pt_enabled: bool
    lwf_enabled: bool
    bonus_enabled: bool
    gratuity_enabled: bool


# ── Others ────────────────────────────────────────────────────────────────────

class BonusRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    financial_year: str
    bonus_type: str
    amount: Decimal
    is_paid: bool


class GratuityRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    amount: Decimal
    years_of_service: Decimal
    is_paid: bool
