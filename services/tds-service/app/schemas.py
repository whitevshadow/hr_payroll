from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class TDSComputeRequest(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    monthly_gross: Decimal
    salary_payment_date: date | None = None
    tax_regime: str = "DEFAULT"
    fixed_pay: Decimal | None = None
    variable_pay: Decimal = Decimal("0")
    bonus: Decimal = Decimal("0")
    incentives: Decimal = Decimal("0")
    arrears: Decimal = Decimal("0")
    perquisites: Decimal = Decimal("0")
    employer_contributions: Decimal = Decimal("0")
    other_taxable_income: Decimal = Decimal("0")
    previous_employer_income: Decimal = Decimal("0")
    previous_employer_tds: Decimal = Decimal("0")
    current_employer_tds: Decimal = Decimal("0")
    remaining_payroll_months: int = 12
    declaration_version_id: str | None = None
    declarations: dict[str, Decimal] = Field(default_factory=dict)
    approved_proofs: dict[str, bool] = Field(default_factory=dict)
    relief_89: Decimal = Decimal("0")


class TDSComputeResponse(BaseModel):
    employee_id: uuid.UUID
    cycle_id: uuid.UUID
    taxable_income: Decimal
    annual_tax: Decimal
    remaining_tax: Decimal = Decimal("0")
    monthly_tds: Decimal
    regime_applied: str
    law_version: str = ""
    salary_payment_date: date | None = None
    trace_hash: str | None = None
    tax_trace: dict


class TaxProfileIn(BaseModel):
    employee_id: uuid.UUID
    pan: str | None = None
    aadhaar: str | None = None
    dob: date | None = None
    residential_status: str = "RESIDENT"
    tax_regime: str = "DEFAULT"
    effective_from: date
    effective_to: date | None = None
    tax_law_version: str = "2025_v2026"
    status: str = "ACTIVE"


class DeclarationSubmitIn(BaseModel):
    employee_id: uuid.UUID
    tax_year: str
    payload: dict
    change_reason: str | None = None


class ProofDocumentIn(BaseModel):
    employee_id: uuid.UUID
    tax_year: str
    proof_type: str
    document_ref: str
    declaration_version_id: uuid.UUID | None = None


class ProofDecisionIn(BaseModel):
    status: str
    reason: str | None = None
    verification: dict = Field(default_factory=dict)


class Form122In(BaseModel):
    employee_id: uuid.UUID
    tax_year: str
    salary_details: dict = Field(default_factory=dict)
    declaration_summary: dict = Field(default_factory=dict)
    submission_mode: str = "HRMS"
