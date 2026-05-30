from __future__ import annotations

import uuid
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

M = Numeric(12, 2)


class PFContribution(TenantAwareBase):
    __tablename__ = "pf_contributions"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    pf_wages: Mapped[Decimal] = mapped_column(M, default=0)
    employee_pf: Mapped[Decimal] = mapped_column(M, default=0)
    employer_eps: Mapped[Decimal] = mapped_column(M, default=0)
    employer_epf: Mapped[Decimal] = mapped_column(M, default=0)
    is_ceiling_applied: Mapped[bool] = mapped_column(Boolean, default=True)


class ESIContribution(TenantAwareBase):
    __tablename__ = "esi_contributions"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    gross_wages: Mapped[Decimal] = mapped_column(M, default=0)
    is_esi_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    employee_esi: Mapped[Decimal] = mapped_column(M, default=0)
    employer_esi: Mapped[Decimal] = mapped_column(M, default=0)


class PTDeduction(TenantAwareBase):
    __tablename__ = "pt_deductions"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    state: Mapped[str] = mapped_column(String(60))
    pt_amount: Mapped[Decimal] = mapped_column(M, default=0)
