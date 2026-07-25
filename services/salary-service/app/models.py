from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class SalaryTemplate(TenantAwareBase):
    """Reusable salary templates per client."""
    __tablename__ = "salary_templates"

    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    template_name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    template_components: Mapped[dict] = mapped_column(JSONB, default=list)


class SalaryStructure(TenantAwareBase):
    __tablename__ = "salary_structures"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "employee_id", "effective_from", name="uq_struct_eff"
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    ctc: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    work_location: Mapped[str | None] = mapped_column(String(120))
    template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    components: Mapped[list["SalaryComponent"]] = relationship(
        back_populates="structure",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class SalaryComponent(TenantAwareBase):
    __tablename__ = "salary_components"

    structure_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("salary_structures.id", ondelete="CASCADE"),
        nullable=False,
    )
    component_name: Mapped[str] = mapped_column(String(100), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    component_type: Mapped[str] = mapped_column(String(20), default="EARNING")
    is_taxable: Mapped[bool] = mapped_column(Boolean, default=True)

    structure: Mapped[SalaryStructure] = relationship(back_populates="components")
