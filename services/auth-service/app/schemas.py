from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    tenant_name: str = Field(min_length=2)
    email: EmailStr
    # 8 is the practical floor. A longer minimum is preferable for a payroll
    # system but would invalidate the documented demo credentials.
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Optional tenant scope. The same email may legitimately exist in several
    # tenants (uniqueness is per (tenant_id, email)). When supplied, login is
    # bound to exactly that tenant; when omitted, an email that resolves to more
    # than one tenant is rejected rather than silently matched to an arbitrary
    # row.
    tenant_id: uuid.UUID | None = None


class ChangePasswordRequest(BaseModel):
    """Rotate your own password. Proving the current one stops a borrowed
    session (an unlocked laptop, a stolen token) from locking the owner out."""

    current_password: str
    new_password: str = Field(min_length=8)


class SetPasswordRequest(BaseModel):
    """Admin reset of another user's password — no current password needed,
    since the point is that nobody knows it."""

    new_password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    roles: list[str]
