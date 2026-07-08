from __future__ import annotations

import uuid
from datetime import date

from hr_shared import EncryptedString, TenantAwareBase
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class Client(TenantAwareBase):
    """Master record for a client company.

    V2: flat address/contact/statutory columns consolidated into JSONB.
    Old columns kept as nullable for dual-read during migration; see
    scripts/migrate_01_clients_jsonb.py to populate JSONB fields.
    """

    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("tenant_id", "client_code", name="uq_client_code"),
    )

    # ── Basic ─────────────────────────────────────────────────────────────────
    client_code: Mapped[str] = mapped_column(String(50), nullable=False)
    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(200))
    industry: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")

    # ── V2 JSONB columns (preferred) ──────────────────────────────────────────
    # address: {line1, line2, area, city, state, country, pincode}
    address: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # contact: {person, email, mobile, telephone, website}
    contact: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # statutory_ids: {gst, pan, tan, cin, pf_code, esic_code, pt_number, labour_license, shop_act, msme}
    statutory_ids: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # ── Legacy flat columns (kept for dual-read during migration) ─────────────
    address_line1: Mapped[str | None] = mapped_column(String(255))
    address_line2: Mapped[str | None] = mapped_column(String(255))
    area: Mapped[str | None] = mapped_column(String(150))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100), default="India")
    pincode: Mapped[str | None] = mapped_column(String(20))
    gst_number: Mapped[str | None] = mapped_column(String(20))
    pan_number: Mapped[str | None] = mapped_column(String(20))
    tan_number: Mapped[str | None] = mapped_column(String(20))
    cin_number: Mapped[str | None] = mapped_column(String(30))
    contact_person: Mapped[str | None] = mapped_column(String(150))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    contact_mobile: Mapped[str | None] = mapped_column(String(20))
    contact_telephone: Mapped[str | None] = mapped_column(String(20))
    website: Mapped[str | None] = mapped_column(String(255))
    pf_establishment_code: Mapped[str | None] = mapped_column(String(50))
    esic_employer_code: Mapped[str | None] = mapped_column(String(50))
    professional_tax_number: Mapped[str | None] = mapped_column(String(50))
    labour_license_number: Mapped[str | None] = mapped_column(String(100))
    shop_act_number: Mapped[str | None] = mapped_column(String(100))
    msme_number: Mapped[str | None] = mapped_column(String(50))

    # ── Payroll information ───────────────────────────────────────────────────
    payroll_start_date: Mapped[date | None] = mapped_column(Date)
    payroll_frequency: Mapped[str] = mapped_column(String(20), default="MONTHLY")
    payroll_calendar: Mapped[str | None] = mapped_column(String(30))
    financial_year: Mapped[str | None] = mapped_column(String(9))
    salary_template_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    # ── Relations ─────────────────────────────────────────────────────────────
    credentials: Mapped[list["ClientPortalCredential"]] = relationship(
        back_populates="client", cascade="all, delete-orphan", lazy="selectin"
    )
    documents: Mapped[list["ClientDocument"]] = relationship(
        back_populates="client", cascade="all, delete-orphan", lazy="selectin"
    )

    def effective_address(self) -> dict:
        """Return JSONB address if populated, else pack from flat columns."""
        if self.address:
            return self.address
        return {
            "line1": self.address_line1, "line2": self.address_line2,
            "area": self.area, "city": self.city, "state": self.state,
            "country": self.country, "pincode": self.pincode,
        }

    def effective_contact(self) -> dict:
        if self.contact:
            return self.contact
        return {
            "person": self.contact_person, "email": self.contact_email,
            "mobile": self.contact_mobile, "telephone": self.contact_telephone,
            "website": self.website,
        }

    def effective_statutory_ids(self) -> dict:
        if self.statutory_ids:
            return self.statutory_ids
        return {
            "gst": self.gst_number, "pan": self.pan_number, "tan": self.tan_number,
            "cin": self.cin_number, "pf_code": self.pf_establishment_code,
            "esic_code": self.esic_employer_code, "pt_number": self.professional_tax_number,
            "labour_license": self.labour_license_number, "shop_act": self.shop_act_number,
            "msme": self.msme_number,
        }


class ClientPortalCredential(TenantAwareBase):
    """
    Secure storage for compliance portal credentials.

    Passwords are encrypted at rest using the shared Fernet AES key
    (FIELD_ENCRYPTION_KEY). They are NEVER returned in list/detail responses;
    a dedicated /reveal endpoint decrypts and returns them once, with audit.

    V2: portal_type expanded from 20 to 50 chars to support more portal types.
        Supported: PF | ESIC | GST | PT | LWF | SHOPS | BONUS | CUSTOM
    """

    __tablename__ = "client_portal_credentials"
    __table_args__ = (
        UniqueConstraint("client_id", "portal_type", name="uq_client_portal_type"),
    )

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    portal_type: Mapped[str] = mapped_column(String(50), nullable=False)
    portal_name: Mapped[str | None] = mapped_column(String(200))
    portal_url: Mapped[str | None] = mapped_column(String(500))
    username: Mapped[str | None] = mapped_column(String(255))
    # AES-encrypted via hr_shared EncryptedString (Fernet)
    password_encrypted: Mapped[str | None] = mapped_column(EncryptedString)
    # Portal-specific metadata (establishment_code, employer_code, etc.)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    last_rotated_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), default=None)

    client: Mapped[Client] = relationship(back_populates="credentials")


class ClientDocument(TenantAwareBase):
    """
    Document management for client files.

    Supports: GST cert, PAN, TAN, ESIC, PF, Labour License, Shop Act, MSME,
              Incorporation Cert, Contracts, Agreements, Other.
    Features: versioning, expiry tracking, verification workflow.
    """

    __tablename__ = "client_documents"

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    blob_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    doc_category: Mapped[str | None] = mapped_column(String(50))
    doc_label: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer, default=1)
    verification_status: Mapped[str] = mapped_column(String(20), default="PENDING")
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    verified_at: Mapped[str | None] = mapped_column(DateTime(timezone=True))
    verification_comment: Mapped[str | None] = mapped_column(Text)
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    client: Mapped[Client] = relationship(back_populates="documents")
