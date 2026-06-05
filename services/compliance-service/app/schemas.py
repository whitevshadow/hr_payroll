from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel


class ComputeRequest(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    basic: Decimal
    monthly_gross: Decimal
    state: str
    month: int = 1  # calendar month number (1-12), for PT February rule
    ceiling_on: bool = True


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
