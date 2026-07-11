from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import JSON, Boolean, Date, DateTime, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

# Postgres uses JSONB in production; SQLite (unit tests) falls back to plain
# JSON. with_variant leaves the Postgres DDL unchanged.
_JSONB = JSONB().with_variant(JSON(), "sqlite")


class AttendanceRecord(TenantAwareBase):
    """Per-employee monthly attendance summary.

    V2: adds leave_breakdown JSONB for structured leave data. Individual
    leave columns (cl_days, sl_days, etc.) are kept for backward
    compatibility and dual-written on every update.
    """
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "month", name="uq_att_month"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    month: Mapped[date] = mapped_column(Date, nullable=False)   # always 1st of month
    total_days: Mapped[int] = mapped_column(Integer, nullable=False)
    present_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    lop_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    payable_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False)

    # Individual leave columns (legacy — kept for dual-write period)
    cl_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    sl_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    pl_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    wo_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    holiday_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    wfh_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(6, 1), default=0)
    attendance_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    daily_status: Mapped[str | None] = mapped_column(Text, nullable=True)

    # V2: structured leave breakdown JSONB
    leave_breakdown: Mapped[dict | None] = mapped_column(_JSONB, nullable=True)

    # V2: client filter support
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    def build_leave_breakdown(self) -> dict:
        """Return structured leave breakdown dict from individual columns."""
        return {
            "cl_days": float(self.cl_days or 0),
            "sl_days": float(self.sl_days or 0),
            "pl_days": float(self.pl_days or 0),
            "wo_days": float(self.wo_days or 0),
            "holiday_days": float(self.holiday_days or 0),
            "wfh_days": float(self.wfh_days or 0),
            "overtime_hours": float(self.overtime_hours or 0),
        }


# The monthly control/lock record is per client company, not per tenant. Without
# client_id, locking a month for one client locked it for every client under the
# tenant, and the roll-up counts were computed across all clients' employees.
class AttendanceMonth(TenantAwareBase):
    """Month-level control record — tracks DRAFT/VALIDATED/LOCKED state."""
    __tablename__ = "attendance_months"
    __table_args__ = (
        UniqueConstraint("tenant_id", "client_id", "month", name="uq_att_control_month"),
    )

    client_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
    month: Mapped[date] = mapped_column(Date, nullable=False)   # always 1st of month
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    total_employees: Mapped[int] = mapped_column(Integer, default=0)
    employees_with_lop: Mapped[int] = mapped_column(Integer, default=0)
    completion_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)

    # Validation
    validated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Locking
    locked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Unlock
    unlocked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    unlocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    unlock_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class AttendanceAudit(TenantAwareBase):
    """Immutable audit log for all attendance changes."""
    __tablename__ = "attendance_audit"

    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    employee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    month: Mapped[date | None] = mapped_column(Date, nullable=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    previous_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


# ── Leave Management (V2) ─────────────────────────────────────────────────────

class LeavePolicy(TenantAwareBase):
    """Leave policy configuration per client/tenant."""
    __tablename__ = "leave_policies"

    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    leave_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # CL | SL | PL | LOP | COMP_OFF | WFH | OPTIONAL
    annual_quota: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    carry_forward: Mapped[bool] = mapped_column(Boolean, default=False)
    max_carry_forward: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    encashable: Mapped[bool] = mapped_column(Boolean, default=False)
    max_consecutive_days: Mapped[int] = mapped_column(Integer, default=0)
    accrual_type: Mapped[str] = mapped_column(String(20), default="ANNUAL")
    # ANNUAL | MONTHLY | QUARTERLY
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class LeaveBalance(TenantAwareBase):
    """Employee leave balance per financial year."""
    __tablename__ = "leave_balances"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "leave_type", "financial_year", name="uq_leave_balance"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    leave_type: Mapped[str] = mapped_column(String(30), nullable=False)
    financial_year: Mapped[str] = mapped_column(String(9), nullable=False)  # e.g. "2025-26"
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    accrued: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    used: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    carry_forward_used: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    closing_balance: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)


class LeaveRequest(TenantAwareBase):
    """Leave application with approval workflow."""
    __tablename__ = "leave_requests"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    leave_type: Mapped[str] = mapped_column(String(30), nullable=False)
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    # PENDING | APPROVED | REJECTED | CANCELLED
    applied_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_comment: Mapped[str | None] = mapped_column(Text)
    financial_year: Mapped[str | None] = mapped_column(String(9))


class LeaveTransaction(TenantAwareBase):
    """Leave ledger — immutable record of every balance change."""
    __tablename__ = "leave_transactions"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    leave_request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    leave_type: Mapped[str] = mapped_column(String(30), nullable=False)
    financial_year: Mapped[str] = mapped_column(String(9), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(30), nullable=False)
    # DEBIT | CREDIT | CARRY_FORWARD | LAPSE | ENCASHMENT
    days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    balance_after: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
