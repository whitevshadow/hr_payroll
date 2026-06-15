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


class Location(TenantAwareBase):
    __tablename__ = "locations"

    location_name: Mapped[str] = mapped_column(String(150), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(100), nullable=False)
    country: Mapped[str] = mapped_column(String(100), default="India")


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
    
    # Location tracking
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id")
    )
    work_location: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    branch: Mapped[str | None] = mapped_column(String(100))

    # Client mapping — FK enforced at DB level by client-service schema init;
    # omitted from SQLAlchemy metadata to avoid cross-service table resolution.
    client_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
