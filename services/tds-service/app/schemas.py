from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel


class TDSComputeRequest(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    monthly_gross: Decimal


class TDSComputeResponse(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    taxable_income: Decimal
    annual_tax: Decimal
    monthly_tds: Decimal
    regime_applied: str
    tax_trace: dict
