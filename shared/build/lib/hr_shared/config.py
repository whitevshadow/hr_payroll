"""Pydantic settings base shared by every service."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 120

    # PII field-level encryption (DPDP Act 2023, s.8(4))
    # Comma-separated Fernet keys; first key encrypts, all keys decrypt.
    # MUST be set in production — see shared/hr_shared/crypto.py for keygen.
    field_encryption_key: str = ""

    # Statutory / business defaults
    pf_ceiling_enabled: bool = True

    service_name: str = "service"
