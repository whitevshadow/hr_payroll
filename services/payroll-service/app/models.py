from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


# Separate base for notification_schema so it lands in the right schema.
class NotificationBase(DeclarativeBase):
    pass


class Notification(NotificationBase):
    __tablename__ = "notifications"
    __table_args__ = {"schema": "notification_schema"}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # None = tenant-wide
    type: Mapped[str] = mapped_column(String(80), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str | None] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

M = Numeric(12, 2)


class PayrollCycle(TenantAwareBase):
    __tablename__ = "payroll_cycles"

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    is_dry_run: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    trace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class PayrollResult(TenantAwareBase):
    __tablename__ = "payroll_results"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "cycle_id", "employee_id", name="uq_result_cycle_emp"
        ),
    )

    cycle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("payroll_cycles.id", ondelete="CASCADE"),
        nullable=False,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    gross_earnings: Mapped[Decimal] = mapped_column(M, default=0)
    total_deductions: Mapped[Decimal] = mapped_column(M, default=0)
    net_pay: Mapped[Decimal] = mapped_column(M, default=0)
    breakdown_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="COMPUTED")
    error: Mapped[str | None] = mapped_column(String(500))
