from __future__ import annotations

import uuid
from datetime import date

from hr_shared import EncryptedString, TenantAwareBase
from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class Department(TenantAwareBase):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    cost_center: Mapped[str | None] = mapped_column(String(100))


class Employee(TenantAwareBase):
    __tablename__ = "employees"
    __table_args__ = (
        UniqueConstraint("tenant_id", "emp_code", name="uq_emp_code"),
    )

    emp_code: Mapped[str] = mapped_column(String(50), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    # DPDP Act 2023 s.8(4): PII fields encrypted at rest via Fernet.
    pan_number: Mapped[str | None] = mapped_column(EncryptedString)
    bank_account: Mapped[str | None] = mapped_column(EncryptedString)
    bank_ifsc: Mapped[str | None] = mapped_column(EncryptedString)
    uan_number: Mapped[str | None] = mapped_column(EncryptedString)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    joining_date: Mapped[date | None] = mapped_column(Date)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id")
    )
    designation: Mapped[str | None] = mapped_column(String(120))
    work_location: Mapped[str | None] = mapped_column(String(120))
