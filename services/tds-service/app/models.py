from __future__ import annotations

import uuid
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import Boolean, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

M = Numeric(12, 2)


class TDSCalculation(TenantAwareBase):
    __tablename__ = "tds_calculations"

    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    taxable_income: Mapped[Decimal] = mapped_column(M, default=0)
    annual_tax: Mapped[Decimal] = mapped_column(M, default=0)
    monthly_tds: Mapped[Decimal] = mapped_column(M, default=0)
    regime_applied: Mapped[str] = mapped_column(String(10), default="NEW")
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
