"""Pydantic settings base shared by every service."""

from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Known-insecure secrets that must never reach a running service. These are the
# public defaults that historically shipped in this repo's compose file and
# .env.example files; refusing them closes the "forgot to set JWT_SECRET" gap.
_WEAK_JWT_SECRETS = {
    "",
    "change-me-in-production",
    "super-secret-shared-key-change-me",
}


class BaseServiceSettings(BaseSettings):
    """Common environment-driven settings for all services.

    Each service subclasses this and adds its own fields (e.g. peer service
    URLs for the payroll orchestrator).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql+asyncpg://hr:hr@localhost:5432/hr_payroll"
    db_schema: str = "public"

    # Auth / JWT — one shared secret across auth + all services.
    # Required (no default): a service must refuse to start rather than fall
    # back to a publicly-known signing key that would let anyone forge admin
    # tokens for any tenant.
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 120

    @field_validator("jwt_secret")
    @classmethod
    def _reject_weak_jwt_secret(cls, v: str) -> str:
        if v.strip() in _WEAK_JWT_SECRETS:
            raise ValueError(
                "JWT_SECRET is unset or set to a known insecure default. Set a "
                "strong, unique value, e.g. "
                '`python -c "import secrets; print(secrets.token_urlsafe(32))"`.'
            )
        return v

    # PII field-level encryption (DPDP Act 2023, s.8(4))
    # Comma-separated Fernet keys; first key encrypts, all keys decrypt.
    # MUST be set in production — see shared/hr_shared/crypto.py for keygen.
    field_encryption_key: str = ""

    # Statutory / business defaults
    pf_ceiling_enabled: bool = True

    service_name: str = "service"
