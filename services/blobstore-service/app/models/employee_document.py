"""
app/models/employee_document.py

Production-grade SQLAlchemy model for employee HR documents.

Design contract
---------------
* Database is the ONLY source of truth for category, label, ownership, and status.
* MinIO object keys are immutable and contain NO category/label semantics:
      employees/{employee_id}/documents/{blob_id}.{ext}
* doc_category is always stored lowercase; doc_label is always stored uppercase.
* Deduplication is enforced at DB level: a partial unique index prevents two
  *active* rows (deleted_at IS NULL) with the same (tenant_id, employee_id,
  doc_category, doc_label). Uploading a replacement soft-deletes the previous.
* Soft-delete only: deleted_at timestamp. No rows are ever physically removed.
* superseded_by_id creates an immutable version chain for audit purposes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Index, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


# ── Domain constants ───────────────────────────────────────────────────────────

class DocCategory:
    IDENTITY   = "identity"
    BANKING    = "banking"
    EMPLOYMENT = "employment"
    COMPLIANCE = "compliance"
    PAYROLL    = "payroll"
    CUSTOM     = "custom"

    ALL: frozenset[str] = frozenset({
        IDENTITY, BANKING, EMPLOYMENT, COMPLIANCE, PAYROLL, CUSTOM,
    })


class DocLabel:
    AADHAAR_CARD       = "AADHAAR_CARD"
    PAN_CARD           = "PAN_CARD"
    PHOTO              = "PHOTO"
    CANCELLED_CHEQUE   = "CANCELLED_CHEQUE"
    OFFER_LETTER       = "OFFER_LETTER"
    APPOINTMENT_LETTER = "APPOINTMENT_LETTER"
    SALARY_REVISION    = "SALARY_REVISION"
    FORM16             = "FORM16"
    OTHER              = "OTHER"

    ALL: frozenset[str] = frozenset({
        AADHAAR_CARD, PAN_CARD, PHOTO, CANCELLED_CHEQUE,
        OFFER_LETTER, APPOINTMENT_LETTER, SALARY_REVISION,
        FORM16, OTHER,
    })


class VerificationStatus:
    PENDING  = "PENDING"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"

    ALL: frozenset[str] = frozenset({PENDING, VERIFIED, REJECTED})


# Required documents for the KYC completion engine (DB-only — no path checks).
MANDATORY_DOCS: list[tuple[str, str]] = [
    (DocCategory.IDENTITY, DocLabel.AADHAAR_CARD),
    (DocCategory.IDENTITY, DocLabel.PAN_CARD),
    (DocCategory.IDENTITY, DocLabel.PHOTO),
    (DocCategory.BANKING,  DocLabel.CANCELLED_CHEQUE),
]

# Roles that may verify or reject documents.
HR_ROLES: frozenset[str] = frozenset({
    "SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN",
})

# MIME types considered "previewable" inline by browsers.
PREVIEWABLE_MIME: frozenset[str] = frozenset({
    "application/pdf",
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
})

# MIME → file extension for object key generation.
MIME_TO_EXT: dict[str, str] = {
    "application/pdf":  ".pdf",
    "image/jpeg":       ".jpg",
    "image/png":        ".png",
    "image/gif":        ".gif",
    "image/webp":       ".webp",
    "image/svg+xml":    ".svg",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain":       ".txt",
}


def ext_from_mime(mime_type: str) -> str:
    """Return a file extension (with dot) for a given MIME type."""
    return MIME_TO_EXT.get(mime_type.lower().split(";")[0].strip(), ".bin")


# ── ORM model ─────────────────────────────────────────────────────────────────

class EmployeeDocument(Base):
    """
    One row per employee document version.

    Active document: deleted_at IS NULL.
    Superseded version: deleted_at IS NOT NULL, superseded_by_id references the
    row that replaced it.
    """

    __tablename__ = "employee_documents"

    # ── Identity ──────────────────────────────────────────────────────────────
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True,
    )

    # ── Storage (immutable after creation) ────────────────────────────────────
    # MinIO bucket:  tenant-{tenant_id}
    # object_key:    employees/{employee_id}/documents/{id}.{ext}
    # The key carries NO category or label — DB is the authoritative source.
    bucket_name: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key:  Mapped[str] = mapped_column(Text,        nullable=False, unique=True)

    # ── File metadata ─────────────────────────────────────────────────────────
    filename:  Mapped[str] = mapped_column(Text,        nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger,  nullable=False)

    # ── Document classification ───────────────────────────────────────────────
    # Invariant: doc_category == doc_category.lower()
    #            doc_label    == doc_label.upper()
    doc_category: Mapped[str]      = mapped_column(String(50),  nullable=False, index=True)
    doc_label:    Mapped[str]      = mapped_column(String(100), nullable=False)
    description:  Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Verification workflow ─────────────────────────────────────────────────
    verification_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=VerificationStatus.PENDING, index=True,
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by:      Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    verified_at:      Mapped[datetime | None]  = mapped_column(DateTime(timezone=True), nullable=True)

    # ── Provenance ────────────────────────────────────────────────────────────
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    uploaded_at: Mapped[datetime]  = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # ── Soft delete ───────────────────────────────────────────────────────────
    # deleted_at IS NULL     → active (visible to callers)
    # deleted_at IS NOT NULL → soft-deleted (retained for audit/retention window)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None,
    )
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # ── Version chain ─────────────────────────────────────────────────────────
    # When this row is superseded by a new upload, superseded_by_id is set to
    # the new document's id before soft-deleting this row.
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # ── Compound indexes ──────────────────────────────────────────────────────
    __table_args__ = (
        # Partial unique: only ONE active document per (tenant, employee, cat, label).
        # Superseded versions are excluded via the WHERE clause.
        Index(
            "uq_emp_active_document",
            "tenant_id", "employee_id", "doc_category", "doc_label",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Fast category + employee listing (active only).
        Index(
            "idx_emp_doc_category_active",
            "tenant_id", "employee_id", "doc_category",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Fast verification-status queries (HR review queues).
        Index(
            "idx_emp_doc_verification",
            "tenant_id", "verification_status",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<EmployeeDocument id={self.id!r} "
            f"employee={self.employee_id!r} "
            f"label={self.doc_label!r} "
            f"status={self.verification_status!r}>"
        )
