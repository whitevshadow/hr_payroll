from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AttendanceUpsert(BaseModel):
    employee_id: uuid.UUID
    month: date  # any day in the month; routes normalise to the 1st
    total_days: int
    present_days: Decimal
    cl_days: Decimal = Decimal("0")
    sl_days: Decimal = Decimal("0")
    pl_days: Decimal = Decimal("0")
    wo_days: Decimal = Decimal("0")
    holiday_days: Decimal = Decimal("0")
    wfh_days: Decimal = Decimal("0")
    overtime_hours: Decimal = Decimal("0")


class AttendanceBulkItem(BaseModel):
    employee_id: uuid.UUID
    total_days: int
    present_days: Decimal
    cl_days: Decimal = Decimal("0")
    sl_days: Decimal = Decimal("0")
    pl_days: Decimal = Decimal("0")
    wo_days: Decimal = Decimal("0")
    holiday_days: Decimal = Decimal("0")
    wfh_days: Decimal = Decimal("0")
    overtime_hours: Decimal = Decimal("0")


class AttendanceBulkUpsert(BaseModel):
    month: date
    records: list[AttendanceBulkItem]
    source: str = "MANUAL"  # "MANUAL" | "EXCEL_IMPORT"


class LockRequest(BaseModel):
    reason: Optional[str] = None


class UnlockRequest(BaseModel):
    reason: str


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
    cl_days: Decimal
    sl_days: Decimal
    pl_days: Decimal
    wo_days: Decimal
    holiday_days: Decimal
    wfh_days: Decimal
    overtime_hours: Decimal
    attendance_pct: Decimal


class AttendanceMonthOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    month: date
    status: str
    total_employees: int
    employees_with_lop: int
    completion_pct: Decimal
    validated_by: Optional[uuid.UUID]
    validated_at: Optional[datetime]
    locked_by: Optional[uuid.UUID]
    locked_at: Optional[datetime]
    locked_reason: Optional[str]
    unlocked_by: Optional[uuid.UUID]
    unlocked_at: Optional[datetime]
    unlock_reason: Optional[str]


class MonthlyListOut(BaseModel):
    month_control: Optional[AttendanceMonthOut]
    records: list[AttendanceOut]
