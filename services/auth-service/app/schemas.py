from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    tenant_name: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Optional tenant scope. The same email may legitimately exist in several
    # tenants (uniqueness is per (tenant_id, email)). When supplied, login is
    # bound to exactly that tenant; when omitted, an email that resolves to more
    # than one tenant is rejected rather than silently matched to an arbitrary
    # row.
    tenant_id: uuid.UUID | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    roles: list[str]
