"""
app/models/blob_model.py

SQLAlchemy ORM model for the `blobs` table.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column


class VerificationStatus:
    PENDING  = "PENDING"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    EXPIRED  = "EXPIRED"


class DocCategory:
    IDENTITY   = "identity"
    BANKING    = "banking"
    EMPLOYMENT = "employment"
    COMPLIANCE = "compliance"
    PAYROLL    = "payroll"
    CUSTOM     = "custom"

from app.database.base import Base


class Blob(Base):
    """Represents a stored file blob and its associated metadata."""

    __tablename__ = "blobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )

    bucket_name: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    folder: Mapped[str] = mapped_column(String(255), nullable=False)

    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)

    etag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(255), nullable=True)

    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )

    tags: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # ── HR document metadata ────────────────────────────────────────────────
    # Category: identity / banking / employment / compliance / payroll / custom
    doc_category: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    # Human-readable document type label (e.g. AADHAAR_CARD, PAN_CARD)
    doc_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Optional description entered by HR during upload
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Verification workflow ───────────────────────────────────────────────
    verification_status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default=VerificationStatus.PENDING, index=True
    )
    verified_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    is_deleted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    retention_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        default=None,
    )

    # Partial index: fast filtered listing of active blobs per tenant
    __table_args__ = (
        Index(
            "idx_blobs_active",
            "tenant_id",
            "uploaded_at",
            postgresql_where=(is_deleted.is_(False)),  # type: ignore[attr-defined]
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<Blob id={self.id!r} file_name={self.file_name!r} "
            f"tenant={self.tenant_id!r} bucket={self.bucket_name!r}>"
        )
