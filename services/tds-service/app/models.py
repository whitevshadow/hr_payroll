from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from hr_shared import EncryptedString, TenantAwareBase
from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

M = Numeric(12, 2)


class TDSCalculation(TenantAwareBase):
    __tablename__ = "tds_calculations"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    taxable_income: Mapped[Decimal] = mapped_column(M, default=0)
    annual_tax: Mapped[Decimal] = mapped_column(M, default=0)
    remaining_tax: Mapped[Decimal] = mapped_column(M, default=0)
    monthly_tds: Mapped[Decimal] = mapped_column(M, default=0)
    regime_applied: Mapped[str] = mapped_column(String(10), default="NEW")
    law_version: Mapped[str] = mapped_column(String(32), default="2025_v2026")
    salary_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    trace_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tax_trace_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class TDSDeclaration(TenantAwareBase):
    """Investment declarations submitted by employees.

    # TODO(v2): Old-regime tax computation using these declarations.
    """
    __tablename__ = "tds_declarations"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    financial_year: Mapped[str] = mapped_column(String(9), nullable=False)  # e.g. "2025-26"
    regime_preference: Mapped[str] = mapped_column(String(10), default="NEW")
    sec_80c: Mapped[Decimal] = mapped_column(M, default=0)
    sec_80d: Mapped[Decimal] = mapped_column(M, default=0)
    hra_claimed: Mapped[Decimal] = mapped_column(M, default=0)
    other_deductions: Mapped[Decimal] = mapped_column(M, default=0)
    is_finalized: Mapped[bool] = mapped_column(Boolean, default=False)
    payload_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class EmployeeTaxProfile(TenantAwareBase):
    __tablename__ = "employee_tax_profiles"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # DPDP Act 2023 s.8(4): PAN and Aadhaar are explicitly named sensitive data.
    pan: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    aadhaar: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    residential_status: Mapped[str] = mapped_column(String(32), default="RESIDENT")
    tax_regime: Mapped[str] = mapped_column(String(10), default="DEFAULT")
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    tax_law_version: Mapped[str] = mapped_column(String(32), default="2025_v2026")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")


class TaxRegimeHistory(TenantAwareBase):
    __tablename__ = "tax_regime_history"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    previous_regime: Mapped[str | None] = mapped_column(String(10), nullable=True)
    new_regime: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    audit_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class EmployeeDeclaration(TenantAwareBase):
    __tablename__ = "employee_declarations"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="SUBMITTED")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    declaration_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class DeclarationVersion(TenantAwareBase):
    __tablename__ = "declaration_versions"

    declaration_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="SUBMITTED")
    payload_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProofDocument(TenantAwareBase):
    __tablename__ = "proof_documents"

    declaration_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    proof_type: Mapped[str] = mapped_column(String(40), nullable=False)
    document_ref: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class TaxProjection(TenantAwareBase):
    __tablename__ = "tax_projections"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    cycle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    law_version: Mapped[str] = mapped_column(String(32), nullable=False)
    regime: Mapped[str] = mapped_column(String(10), nullable=False)
    projected_income: Mapped[Decimal] = mapped_column(M, default=0)
    taxable_income: Mapped[Decimal] = mapped_column(M, default=0)
    projection_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class TaxComputation(TenantAwareBase):
    __tablename__ = "tax_computations"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    cycle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    law_version: Mapped[str] = mapped_column(String(32), nullable=False)
    regime: Mapped[str] = mapped_column(String(10), nullable=False)
    annual_tax: Mapped[Decimal] = mapped_column(M, default=0)
    trace_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    trace_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class TaxTrace(TenantAwareBase):
    __tablename__ = "tax_traces"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    cycle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    law_version: Mapped[str] = mapped_column(String(32), nullable=False)
    trace_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    trace_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class TDSSnapshot(TenantAwareBase):
    __tablename__ = "tds_snapshots"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    annual_tax: Mapped[Decimal] = mapped_column(M, default=0)
    remaining_tax: Mapped[Decimal] = mapped_column(M, default=0)
    monthly_tds: Mapped[Decimal] = mapped_column(M, default=0)
    tax_trace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    law_version: Mapped[str] = mapped_column(String(32), nullable=False)
    regime: Mapped[str] = mapped_column(String(10), nullable=False)
    snapshot_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class TDSLedger(TenantAwareBase):
    __tablename__ = "tds_ledger"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    cycle_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(30), nullable=False)
    amount: Mapped[Decimal] = mapped_column(M, default=0)
    reconciliation_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    reference_json: Mapped[dict] = mapped_column(JSONB, default=dict)


class Form122(TenantAwareBase):
    __tablename__ = "form122"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    salary_details: Mapped[dict] = mapped_column(JSONB, default=dict)
    declaration_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    submission_mode: Mapped[str] = mapped_column(String(20), default="HRMS")
    copy_ref: Mapped[str | None] = mapped_column(String(256), nullable=True)


class Form16(TenantAwareBase):
    __tablename__ = "form16"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    tax_year: Mapped[str] = mapped_column(String(9), nullable=False)
    part_a_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    part_b_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    generation_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    issue_history: Mapped[dict] = mapped_column(JSONB, default=dict)
    correction_history: Mapped[dict] = mapped_column(JSONB, default=dict)
    digital_signature_status: Mapped[str] = mapped_column(String(20), default="PENDING")


class TaxAuditLog(TenantAwareBase):
    __tablename__ = "tax_audit_log"

    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    employee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    previous_values: Mapped[dict] = mapped_column(JSONB, default=dict)
    new_values: Mapped[dict] = mapped_column(JSONB, default=dict)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_json: Mapped[dict] = mapped_column(JSONB, default=dict)
