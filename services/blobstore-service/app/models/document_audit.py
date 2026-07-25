"""
app/models/document_audit.py

Immutable audit trail for employee document lifecycle events.

Every state-changing operation on an EmployeeDocument writes one row here.
Rows are NEVER updated or deleted — this table is an append-only ledger.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class AuditEventType:
    DOCUMENT_UPLOADED  = "DOCUMENT_UPLOADED"
    DOCUMENT_VIEWED    = "DOCUMENT_VIEWED"
    DOCUMENT_VERIFIED  = "DOCUMENT_VERIFIED"
    DOCUMENT_REJECTED  = "DOCUMENT_REJECTED"
    DOCUMENT_DELETED   = "DOCUMENT_DELETED"
    DOCUMENT_SUPERSEDED = "DOCUMENT_SUPERSEDED"

    ALL: frozenset[str] = frozenset({
        DOCUMENT_UPLOADED, DOCUMENT_VIEWED, DOCUMENT_VERIFIED,
        DOCUMENT_REJECTED, DOCUMENT_DELETED, DOCUMENT_SUPERSEDED,
    })


class DocumentAudit(Base):
    """Append-only audit row. Never mutated after insertion."""

    __tablename__ = "document_audit"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False,
    )

    # ── Event classification ──────────────────────────────────────────────────
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # ── Scope ─────────────────────────────────────────────────────────────────
    tenant_id:   Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    blob_id:     Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    # ── Actor ─────────────────────────────────────────────────────────────────
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # ── Tracing ───────────────────────────────────────────────────────────────
    trace_id: Mapped[str] = mapped_column(
        String(64), nullable=False, default=lambda: str(uuid.uuid4()),
    )

    # ── Event payload (arbitrary key/value context) ───────────────────────────
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # ── Timestamp ─────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        # Support "all events for a document" queries (most common audit access pattern).
        Index("idx_doc_audit_blob", "blob_id", "created_at"),
        # Support "all events for an employee" and time-range queries.
        Index("idx_doc_audit_employee", "tenant_id", "employee_id", "created_at"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<DocumentAudit id={self.id!r} "
            f"event={self.event_type!r} "
            f"blob={self.blob_id!r}>"
        )
