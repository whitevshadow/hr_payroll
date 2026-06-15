from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


# ---- Client ----------------------------------------------------------------

class ClientBase(BaseModel):
    client_code: str
    client_name: str
    legal_name: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    area: str | None = None
    city: str | None = None
    state: str | None = None
    country: str = "India"
    pincode: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    tan_number: str | None = None
    cin_number: str | None = None
    contact_person: str | None = None
    contact_email: str | None = None
    contact_mobile: str | None = None
    contact_telephone: str | None = None
    pf_establishment_code: str | None = None
    esic_employer_code: str | None = None
    professional_tax_number: str | None = None
    labour_license_number: str | None = None
    shop_act_number: str | None = None

    @field_validator("client_code", mode="before")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("pan_number", mode="before")
    @classmethod
    def normalize_pan(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v

    @field_validator("gst_number", mode="before")
    @classmethod
    def normalize_gst(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    client_name: str | None = None
    legal_name: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    area: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pincode: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    tan_number: str | None = None
    cin_number: str | None = None
    contact_person: str | None = None
    contact_email: str | None = None
    contact_mobile: str | None = None
    contact_telephone: str | None = None
    pf_establishment_code: str | None = None
    esic_employer_code: str | None = None
    professional_tax_number: str | None = None
    labour_license_number: str | None = None
    shop_act_number: str | None = None


class ClientOut(ClientBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    created_at: datetime
    updated_at: datetime


class ClientPage(BaseModel):
    items: list[ClientOut]
    total: int
    page: int
    page_size: int


# ---- Credentials -----------------------------------------------------------

class CredentialCreate(BaseModel):
    portal_type: str  # PF | ESIC | GST
    portal_name: str | None = None
    username: str | None = None
    password: str | None = None  # plaintext input — encrypted on save


class CredentialOut(BaseModel):
    """Password is NEVER returned here."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    client_id: uuid.UUID
    portal_type: str
    portal_name: str | None = None
    username: str | None = None
    has_password: bool = False
    last_rotated_at: datetime | None = None

    @classmethod
    def from_orm_safe(cls, obj) -> "CredentialOut":
        return cls(
            id=obj.id,
            client_id=obj.client_id,
            portal_type=obj.portal_type,
            portal_name=obj.portal_name,
            username=obj.username,
            has_password=bool(obj.password_encrypted),
            last_rotated_at=obj.last_rotated_at,
        )


class CredentialReveal(BaseModel):
    """Returned only from the authenticated /reveal endpoint."""
    id: uuid.UUID
    portal_type: str
    username: str | None = None
    password: str | None = None
