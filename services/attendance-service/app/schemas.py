from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ── Attendance Schemas ────────────────────────────────────────────────────────

class LeaveBreakdown(BaseModel):
    cl_days: Decimal = Decimal("0")
    sl_days: Decimal = Decimal("0")
    pl_days: Decimal = Decimal("0")
    wo_days: Decimal = Decimal("0")
    holiday_days: Decimal = Decimal("0")
    wfh_days: Decimal = Decimal("0")
    overtime_hours: Decimal = Decimal("0")


class AttendanceUpsert(BaseModel):
    employee_id: uuid.UUID
    month: date   # any day in the month; routes normalise to the 1st
    total_days: int
    present_days: Decimal
    cl_days: Decimal = Decimal("0")
    sl_days: Decimal = Decimal("0")
    pl_days: Decimal = Decimal("0")
    wo_days: Decimal = Decimal("0")
    holiday_days: Decimal = Decimal("0")
    wfh_days: Decimal = Decimal("0")
    overtime_hours: Decimal = Decimal("0")
    daily_status: Optional[str] = None
    client_id: uuid.UUID | None = None


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
    daily_status: Optional[str] = None


class AttendanceBulkUpsert(BaseModel):
    month: date
    records: list[AttendanceBulkItem]
    source: str = "MANUAL"    # "MANUAL" | "EXCEL_IMPORT"
    client_id: uuid.UUID | None = None


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
    daily_status: Optional[str]
    leave_breakdown: Optional[dict] = None     # V2: structured breakdown
    client_id: Optional[uuid.UUID] = None


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


# ── Leave Management Schemas (V2) ─────────────────────────────────────────────

class LeavePolicyCreate(BaseModel):
    client_id: uuid.UUID | None = None
    name: str
    description: str | None = None
    leave_type: str                   # CASUAL|SICK|EARNED|MATERNITY|PATERNITY|UNPAID|CL|SL|PL etc.
    annual_allowance: Decimal = Decimal("0")   # frontend name (was annual_quota)
    carry_forward: bool = False
    max_carry_forward: Decimal = Decimal("0")
    encashable: bool = False
    max_consecutive_days: int = 0
    requires_document_after_days: int | None = None
    accrual_type: str = "ANNUAL"      # ANNUAL|MONTHLY|QUARTERLY

    # Keep annual_quota as a read alias so old integrations still work
    @property
    def annual_quota(self) -> Decimal:
        return self.annual_allowance


class LeavePolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID | None
    name: str
    description: str | None = None
    leave_type: str
    annual_allowance: Decimal          # frontend-facing name
    annual_quota: Decimal              # backward-compat alias (same value)
    carry_forward: bool
    max_carry_forward: Decimal
    encashable: bool
    max_consecutive_days: int
    requires_document_after_days: int | None = None
    accrual_type: str
    is_active: bool


class LeaveRequestCreate(BaseModel):
    employee_id: uuid.UUID
    leave_type: str
    from_date: date
    to_date: date
    days: Decimal
    reason: str | None = None
    financial_year: str | None = None


class LeaveRequestUpdate(BaseModel):
    status: str            # APPROVED | REJECTED | CANCELLED
    comment: str | None = None


class LeaveRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    leave_type: str
    from_date: date
    to_date: date
    days: Decimal
    reason: str | None
    status: str
    applied_by: uuid.UUID
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    review_comment: str | None
    financial_year: str | None
    created_at: datetime
    updated_at: datetime


class LeaveBalanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    leave_type: str
    financial_year: str
    opening_balance: Decimal
    accrued: Decimal
    used: Decimal
    carry_forward_used: Decimal
    closing_balance: Decimal


class LeaveTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    employee_id: uuid.UUID
    leave_type: str
    financial_year: str
    transaction_type: str
    days: Decimal
    balance_after: Decimal | None
    note: str | None
    created_at: datetime


class LeaveAccrualRequest(BaseModel):
    """Manual or cron-triggered monthly accrual."""
    financial_year: str
    client_id: uuid.UUID | None = None
