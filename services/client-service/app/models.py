from __future__ import annotations

import uuid

from hr_shared import EncryptedString, TenantAwareBase
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column


class Client(TenantAwareBase):
    """Master record for a client company."""

    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("tenant_id", "client_code", name="uq_client_code"),
    )

    # Basic
    client_code: Mapped[str] = mapped_column(String(50), nullable=False)
    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(200))

    # Address
    address_line1: Mapped[str | None] = mapped_column(String(255))
    address_line2: Mapped[str | None] = mapped_column(String(255))
    area: Mapped[str | None] = mapped_column(String(150))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100), default="India")
    pincode: Mapped[str | None] = mapped_column(String(20))

    # Tax
    gst_number: Mapped[str | None] = mapped_column(String(20))
    pan_number: Mapped[str | None] = mapped_column(String(20))
    tan_number: Mapped[str | None] = mapped_column(String(20))
    cin_number: Mapped[str | None] = mapped_column(String(30))

    # Contact
    contact_person: Mapped[str | None] = mapped_column(String(150))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    contact_mobile: Mapped[str | None] = mapped_column(String(20))
    contact_telephone: Mapped[str | None] = mapped_column(String(20))

    # Statutory registrations
    pf_establishment_code: Mapped[str | None] = mapped_column(String(50))
    esic_employer_code: Mapped[str | None] = mapped_column(String(50))
    professional_tax_number: Mapped[str | None] = mapped_column(String(50))
    labour_license_number: Mapped[str | None] = mapped_column(String(100))
    shop_act_number: Mapped[str | None] = mapped_column(String(100))

    # Lifecycle
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")


class ClientPortalCredential(TenantAwareBase):
    """
    Secure storage for compliance portal credentials (PF / ESIC / GST).

    Passwords are encrypted at rest using the shared Fernet AES key
    (FIELD_ENCRYPTION_KEY). They are NEVER returned in list/detail responses;
    a dedicated /reveal endpoint decrypts and returns them once, with audit.
    """

    __tablename__ = "client_portal_credentials"
    __table_args__ = (
        UniqueConstraint(
            "client_id", "portal_type", name="uq_client_portal_type"
        ),
    )

    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    portal_type: Mapped[str] = mapped_column(String(20), nullable=False)  # PF | ESIC | GST
    portal_name: Mapped[str | None] = mapped_column(String(200))
    username: Mapped[str | None] = mapped_column(String(255))
    # AES-encrypted via hr_shared EncryptedString (Fernet)
    password_encrypted: Mapped[str | None] = mapped_column(EncryptedString)
    last_rotated_at: Mapped[str | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
