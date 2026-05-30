from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Date, Integer, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class AttendanceRecord(TenantAwareBase):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "month", name="uq_att_month"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    month: Mapped[date] = mapped_column(Date, nullable=False)  # 1st of month
    total_days: Mapped[int] = mapped_column(Integer, nullable=False)
    present_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    lop_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    payable_days: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False)
