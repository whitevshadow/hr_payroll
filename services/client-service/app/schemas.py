from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator


# ── Nested sub-schemas (V2) ──────────────────────────────────────────────────

class AddressSchema(BaseModel):
    line1: str | None = None
    line2: str | None = None
    area: str | None = None
    city: str | None = None
    state: str | None = None
    country: str = "India"
    pincode: str | None = None


class ContactSchema(BaseModel):
    person: str | None = None
    email: str | None = None
    mobile: str | None = None
    telephone: str | None = None
    website: str | None = None


class StatutoryIdsSchema(BaseModel):
    gst: str | None = None
    pan: str | None = None
    tan: str | None = None
    cin: str | None = None
    pf_code: str | None = None       # EPFO establishment code
    esic_code: str | None = None     # ESIC employer code
    pt_number: str | None = None     # Professional Tax
    labour_license: str | None = None
    shop_act: str | None = None
    msme: str | None = None


class PayrollInfoSchema(BaseModel):
    payroll_start_date: date | None = None
    payroll_frequency: str = "MONTHLY"   # MONTHLY|WEEKLY|FORTNIGHTLY
    payroll_calendar: str | None = None
    financial_year: str | None = None    # e.g. "2025-26"
    salary_template_id: uuid.UUID | None = None


# ── Client Schemas ────────────────────────────────────────────────────────────

class ClientBase(BaseModel):
    client_code: str
    client_name: str
    legal_name: str | None = None
    industry: str | None = None
    status: str = "ACTIVE"

    # V2 nested objects
    address: AddressSchema | None = None
    contact: ContactSchema | None = None
    statutory_ids: StatutoryIdsSchema | None = None
    payroll_info: PayrollInfoSchema | None = None

    @field_validator("client_code", mode="before")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    client_name: str | None = None
    legal_name: str | None = None
    industry: str | None = None
    status: str | None = None
    address: AddressSchema | None = None
    contact: ContactSchema | None = None
    statutory_ids: StatutoryIdsSchema | None = None
    payroll_info: PayrollInfoSchema | None = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_code: str
    client_name: str
    legal_name: str | None = None
    industry: str | None = None
    status: str
    address: dict | None = None
    contact: dict | None = None
    statutory_ids: dict | None = None
    payroll_start_date: date | None = None
    payroll_frequency: str = "MONTHLY"
    payroll_calendar: str | None = None
    financial_year: str | None = None
    salary_template_id: uuid.UUID | None = None
    # legacy flat fields (returned for backward compatibility)
    city: str | None = None
    state: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    contact_person: str | None = None
    contact_email: str | None = None
    contact_mobile: str | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_v2(cls, obj: Any) -> "ClientOut":
        """Build ClientOut with effective JSONB or flat fallback."""
        return cls(
            id=obj.id,
            client_code=obj.client_code,
            client_name=obj.client_name,
            legal_name=obj.legal_name,
            industry=obj.industry,
            status=obj.status,
            address=obj.effective_address(),
            contact=obj.effective_contact(),
            statutory_ids=obj.effective_statutory_ids(),
            payroll_start_date=obj.payroll_start_date,
            payroll_frequency=obj.payroll_frequency,
            payroll_calendar=obj.payroll_calendar,
            financial_year=obj.financial_year,
            salary_template_id=obj.salary_template_id,
            # flat backward-compat fields
            city=obj.city or (obj.address or {}).get("city"),
            state=obj.state or (obj.address or {}).get("state"),
            gst_number=obj.gst_number or (obj.statutory_ids or {}).get("gst"),
            pan_number=obj.pan_number or (obj.statutory_ids or {}).get("pan"),
            contact_person=obj.contact_person or (obj.contact or {}).get("person"),
            contact_email=obj.contact_email or (obj.contact or {}).get("email"),
            contact_mobile=obj.contact_mobile or (obj.contact or {}).get("mobile"),
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


class ClientPage(BaseModel):
    items: list[ClientOut]
    total: int
    page: int
    page_size: int


# ── Credentials ───────────────────────────────────────────────────────────────

class CredentialCreate(BaseModel):
    portal_type: str   # PF | ESIC | GST | PT | LWF | SHOPS | BONUS | CUSTOM
    portal_name: str | None = None
    portal_url: str | None = None
    username: str | None = None
    password: str | None = None   # plaintext input — encrypted on save
    metadata_json: dict | None = None


class CredentialOut(BaseModel):
    """Password is NEVER returned here."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID
    portal_type: str
    portal_name: str | None = None
    portal_url: str | None = None
    username: str | None = None
    has_password: bool = False
    metadata_json: dict | None = None
    last_rotated_at: datetime | None = None

    @classmethod
    def from_orm_safe(cls, obj) -> "CredentialOut":
        return cls(
            id=obj.id,
            client_id=obj.client_id,
            portal_type=obj.portal_type,
            portal_name=obj.portal_name,
            portal_url=obj.portal_url,
            username=obj.username,
            has_password=bool(obj.password_encrypted),
            metadata_json=obj.metadata_json,
            last_rotated_at=obj.last_rotated_at,
        )


class CredentialReveal(BaseModel):
    """Returned only from the authenticated /reveal endpoint."""
    id: uuid.UUID
    portal_type: str
    username: str | None = None
    password: str | None = None


# ── Client Documents ──────────────────────────────────────────────────────────

class ClientDocumentCreate(BaseModel):
    doc_category: str | None = None   # GST|PAN|TAN|INCORPORATION|PF|ESIC|LABOUR|SHOP_ACT|MSME|CONTRACT|OTHER
    doc_label: str | None = None
    description: str | None = None
    expiry_date: date | None = None
    blob_id: uuid.UUID | None = None  # set after file upload to blobstore


class ClientDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID
    blob_id: uuid.UUID | None = None
    doc_category: str | None = None
    doc_label: str | None = None
    description: str | None = None
    expiry_date: date | None = None
    version: int = 1
    verification_status: str
    verified_by: uuid.UUID | None = None
    verified_at: datetime | None = None
    verification_comment: str | None = None
    created_at: datetime
    updated_at: datetime


class ClientDocumentVerify(BaseModel):
    status: str          # APPROVED | REJECTED
    comment: str | None = None


# ── Client Dashboard ──────────────────────────────────────────────────────────

class ClientDashboardOut(BaseModel):
    client_id: uuid.UUID
    client_name: str
    employee_count: int
    active_employees: int
    payroll_status: str | None = None
    last_payroll_cycle: str | None = None
    compliance_alerts: list[str] = []
    documents_expiring_soon: int = 0
    pending_credentials: list[str] = []
