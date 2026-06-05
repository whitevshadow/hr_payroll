from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class AttendanceRecord(TenantAwareBase):
    """Per-employee monthly attendance summary."""
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "month", name="uq_att_month"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    month: Mapped[date] = mapped_column(Date, nullable=False)  # always 1st of month
    total_days: Mapped[int] = mapped_column(Integer, nullable=False)
    present_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    lop_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    payable_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional per-employee summary counters (populated from daily data or import)
    cl_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    sl_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    pl_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    wo_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    holiday_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    wfh_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=0)
    overtime_hours: Mapped[Decimal] = mapped_column(Numeric(6, 1), default=0)
    attendance_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    daily_status: Mapped[str | None] = mapped_column(Text, nullable=True)


class AttendanceMonth(TenantAwareBase):
    """Month-level control record — tracks DRAFT/VALIDATED/LOCKED state."""
    __tablename__ = "attendance_months"
    __table_args__ = (
        UniqueConstraint("tenant_id", "month", name="uq_att_control_month"),
    )

    month: Mapped[date] = mapped_column(Date, nullable=False)  # always 1st of month
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
        DateTime(timezone=True),
        nullable=False,
        server_default="NOW()",
    )
