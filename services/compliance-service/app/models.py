from __future__ import annotations

import uuid
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Index, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

M = Numeric(12, 2)


class ComplianceSetting(TenantAwareBase):
    __tablename__ = "compliance_settings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "client_id", "state", name="uq_comp_setting_state"),
    )

    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    state: Mapped[str] = mapped_column(String(60), nullable=False)  # "ALL" for default/central
    
    pf_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    pf_employer_rate: Mapped[Decimal] = mapped_column(Numeric(5,2), default=12.0)
    pf_employee_rate: Mapped[Decimal] = mapped_column(Numeric(5,2), default=12.0)
    pf_wage_limit: Mapped[Decimal] = mapped_column(Numeric(12,2), default=15000)
    
    esi_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    esi_employer_rate: Mapped[Decimal] = mapped_column(Numeric(5,2), default=3.25)
    esi_employee_rate: Mapped[Decimal] = mapped_column(Numeric(5,2), default=0.75)
    esi_wage_limit: Mapped[Decimal] = mapped_column(Numeric(12,2), default=21000)
    
    pt_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    lwf_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    
    bonus_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    gratuity_enabled: Mapped[bool] = mapped_column(Boolean, default=False)


# Contribution rows are keyed by (tenant, employee, cycle): /compute deletes on
# exactly that triple before re-inserting, and /summary aggregates by cycle.
# The unique constraint stops a re-run or a race leaving duplicate rows (which
# would double-count statutory totals) and indexes the delete; the extra
# (tenant, cycle) index serves the summary, which the unique index cannot
# because cycle_id is not a leading column there.
class PFContribution(TenantAwareBase):
    __tablename__ = "pf_contributions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "cycle_id", name="uq_pf_emp_cycle"),
        Index("ix_pf_tenant_cycle", "tenant_id", "cycle_id"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    pf_wages: Mapped[Decimal] = mapped_column(M, default=0)
    employee_pf: Mapped[Decimal] = mapped_column(M, default=0)
    employer_eps: Mapped[Decimal] = mapped_column(M, default=0)
    employer_epf: Mapped[Decimal] = mapped_column(M, default=0)
    is_ceiling_applied: Mapped[bool] = mapped_column(Boolean, default=True)


class ESIContribution(TenantAwareBase):
    __tablename__ = "esi_contributions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "cycle_id", name="uq_esi_emp_cycle"),
        Index("ix_esi_tenant_cycle", "tenant_id", "cycle_id"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    gross_wages: Mapped[Decimal] = mapped_column(M, default=0)
    is_esi_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    employee_esi: Mapped[Decimal] = mapped_column(M, default=0)
    employer_esi: Mapped[Decimal] = mapped_column(M, default=0)


class PTDeduction(TenantAwareBase):
    __tablename__ = "pt_deductions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "cycle_id", name="uq_pt_emp_cycle"),
        Index("ix_pt_tenant_cycle", "tenant_id", "cycle_id"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    state: Mapped[str] = mapped_column(String(60))
    pt_amount: Mapped[Decimal] = mapped_column(M, default=0)


class LWFContribution(TenantAwareBase):
    __tablename__ = "lwf_contributions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "cycle_id", name="uq_lwf_emp_cycle"),
        Index("ix_lwf_tenant_cycle", "tenant_id", "cycle_id"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    state: Mapped[str] = mapped_column(String(60))
    employee_lwf: Mapped[Decimal] = mapped_column(M, default=0)
    employer_lwf: Mapped[Decimal] = mapped_column(M, default=0)


class BonusRecord(TenantAwareBase):
    __tablename__ = "bonus_records"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    financial_year: Mapped[str] = mapped_column(String(9), nullable=False)
    bonus_type: Mapped[str] = mapped_column(String(50))  # STATUTORY, PERFORMANCE
    amount: Mapped[Decimal] = mapped_column(M, default=0)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)


class GratuityRecord(TenantAwareBase):
    __tablename__ = "gratuity_records"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    amount: Mapped[Decimal] = mapped_column(M, default=0)
    years_of_service: Mapped[Decimal] = mapped_column(Numeric(5,2), default=0)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
