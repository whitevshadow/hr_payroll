from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class AttendanceUpsert(BaseModel):
    employee_id: uuid.UUID
    month: date  # any day in the month; normalized to the 1st
    total_days: int
    present_days: Decimal


class AttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    month: date
    total_days: int
    present_days: Decimal
    lop_days: Decimal
    payable_days: Decimal
    is_finalized: bool
