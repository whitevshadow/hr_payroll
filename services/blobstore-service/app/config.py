"""
app/config.py

Centralised application settings using Pydantic V2 BaseSettings.
All values are loaded from environment variables or .env file.
"""

from functools import lru_cache
from typing import Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────
    APP_NAME: str = "Blobstore Microservice"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False

    # ── Rate limiting ─────────────────────────────────────────────
    RATE_LIMIT_ENABLED: bool = True
    # Default per-key limit applied to all routes (slowapi syntax).
    RATE_LIMIT_DEFAULT: str = "120/minute"

    # ── Virus scanning ────────────────────────────────────────────
    # When enabled, uploads are streamed to ClamAV (clamd) before the object is
    # stored. fail_closed=True rejects uploads if the scanner is unreachable.
    VIRUS_SCAN_ENABLED: bool = False
    VIRUS_SCAN_FAIL_CLOSED: bool = False
    CLAMAV_HOST: str = "clamav"
    CLAMAV_PORT: int = 3310

    # ── CORS ──────────────────────────────────────────────────────
    # Explicit allowed origins. A wildcard "*" combined with credentials is
    # invalid per the CORS spec, so credentials are only enabled when the
    # origin list is not the wildcard.
    CORS_ALLOW_ORIGINS: list[str] = ["http://localhost:4050"]

    # ── Database ──────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/blobstore"

    # ── Auth / JWT (shared platform secret) ───────────────────────
    # One shared secret across auth-service and every consuming service.
    # The compose stack injects JWT_SECRET / JWT_ALGORITHM via x-common-env.
    # Required (no default) so the service refuses to boot with a publicly
    # known signing key — see the platform-wide fix in hr_shared/config.py.
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    # Roles permitted to delete / restore / run audit operations on blobs.
    BLOB_ADMIN_ROLES: list[str] = [
        "ORG_ADMIN",
        "HR_MANAGER",
        "PAYROLL_ADMIN",
        "SUPER_ADMIN",
    ]

    # ── MinIO ─────────────────────────────────────────────────────────────
    MINIO_ENDPOINT: str = "minio:9000"
    # Public-facing endpoint used in presigned URLs returned to browsers.
    # Format: host:port  (NO scheme prefix — _build_boto_client adds http/https itself).
    # Local dev:    localhost:9000
    # Production:   s3.example.com  or  s3.example.com:443
    # Falls back to MINIO_ENDPOINT when unset (generates internal Docker URLs — unusable by browsers).
    MINIO_PUBLIC_ENDPOINT: Optional[str] = None

    @field_validator("JWT_SECRET")
    @classmethod
    def reject_weak_jwt_secret(cls, v: str) -> str:
        """Refuse to boot with an unset or publicly-known signing key."""
        if v.strip() in {"", "change-me-in-production", "super-secret-shared-key-change-me"}:
            raise ValueError(
                "JWT_SECRET is unset or set to a known insecure default. Set a "
                "strong, unique value shared with the auth service."
            )
        return v

    @field_validator("MINIO_PUBLIC_ENDPOINT", mode="before")
    @classmethod
    def strip_minio_public_scheme(cls, v: object) -> object:
        """Strip http:// / https:// if someone sets the full URL in an env file.

        _build_boto_client constructs its own endpoint_url from the scheme +
        this value, so passing a full URL would produce 'http://http://…'.
        """
        if not isinstance(v, str) or not v:
            return v
        for prefix in ("https://", "http://"):
            if v.startswith(prefix):
                return v[len(prefix):]
        return v
    # No defaults — empty string triggers the startup guard in init_minio().
    # Set via MINIO_ACCESS_KEY / MINIO_SECRET_KEY env vars (service account only).
    # Root credentials must never appear in application configuration.
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MINIO_BUCKET: str = "blobs"
    MINIO_BUCKET_EMPLOYEE_DOCS: str = "default-employee-docs"
    MINIO_BUCKET_PAYROLL_OUTPUTS: str = "default-payroll-outputs"
    MINIO_BUCKET_STATUTORY_FILINGS: str = "default-statutory-filings"
    MINIO_BUCKET_REPORTING: str = "default-reporting"
    MINIO_BUCKET_AUDIT_TRAIL: str = "default-audit-trail"
    MINIO_BUCKET_RAW_UPLOADS: str = "default-raw-uploads"
    MINIO_SECURE: bool = False                   # True → HTTPS

    # ── File Constraints ──────────────────────────────────────────
    # 100 MB default maximum upload size
    MAX_FILE_SIZE_BYTES: int = 100 * 1024 * 1024

    ALLOWED_CONTENT_TYPES: list[str] = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/svg+xml",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv",
        "text/html",
        "application/zip",
        "application/x-zip-compressed",
        "application/json",
        "application/xml",
        "video/mp4",
        "video/mpeg",
        "audio/mpeg",
        "audio/wav",
    ]

    # Pre-signed URL expiry in seconds (default: 1 hour)
    PRESIGNED_URL_EXPIRY_SECONDS: int = 3600
    # Maximum expiry a caller may request (default: 24 hours)
    PRESIGNED_URL_MAX_EXPIRY_SECONDS: int = 86400

    # Batch upload limits
    MAX_BATCH_FILES: int = 10

    # Soft-delete retention before scheduled purge (days)
    SOFT_DELETE_RETENTION_DAYS: int = 90
    # Years to retain an archived (deleted) organization's bucket for compliance.
    ORG_ARCHIVE_RETENTION_YEARS: int = 7

    # ── Kafka (blob event streaming) ──────────────────────────────
    ENABLE_KAFKA_CONSUMER: bool = False
    KAFKA_BOOTSTRAP_SERVERS: Optional[str] = None
    KAFKA_BROKER: str = "kafka:9092"
    KAFKA_GROUP_ID: str = "blobstore-consumer"
    KAFKA_TOPIC_BLOB_EVENTS: str = "blob.events.v1"
    # Organization lifecycle events (ORG_CREATED.v1 / ORG_DELETED.v1) that drive
    # automatic per-tenant bucket provisioning and archival.
    KAFKA_TOPIC_ORG_EVENTS: str = "org.events.v1"
    CONSUMER_LAG_THRESHOLD_SECONDS: int = 300

    # ── Transactional Outbox ──────────────────────────────────────
    # Relay sweep interval and retry budget before a row is parked in DLQ.
    OUTBOX_RELAY_INTERVAL_SECONDS: int = 10
    OUTBOX_MAX_ATTEMPTS: int = 10
    OUTBOX_BATCH_SIZE: int = 100

    # ── Blobstore Service ────────────────────────────────────────
    BLOB_STORE_URL: str = "http://blobstore-service:4010"

    # ── Runtime ──────────────────────────────────────────────────
    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    STARTUP_MAX_RETRIES: int = 5
    STARTUP_RETRY_DELAY_SECONDS: float = 2.0

    # ── Registry Reconciliation ───────────────────────────────────
    REGISTRY_STALE_MINUTES: int = 30
    REGISTRY_RECONCILE_INTERVAL_MINUTES: int = 15
    REGISTRY_MAX_EXTRACTION_ATTEMPTS: int = 3

    # ── MinIO Retry Settings ──────────────────────────────────────
    MINIO_MAX_RETRIES: int = 5
    MINIO_RETRY_DELAY_SECONDS: float = 2.0


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton Settings instance."""
    return Settings()
