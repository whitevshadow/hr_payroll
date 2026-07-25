"""
app/models/outbox.py

Transactional outbox for blob domain events.

An outbox row is written **in the same database transaction** as the metadata
change that produced it (upload/delete/restore/etc.). A background relay then
publishes ``PENDING`` rows to Kafka and marks them ``SENT``. If publishing fails
repeatedly the row is moved to ``DLQ`` for inspection. This guarantees that an
event is never lost just because Kafka was briefly unavailable — the durable
source of truth is Postgres, not an in-memory background task.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class OutboxStatus:
    PENDING = "PENDING"  # written, not yet published
    SENT = "SENT"        # acknowledged by Kafka
    DLQ = "DLQ"          # exhausted retries — needs manual attention


class BlobOutbox(Base):
    """A durable, replayable record of a domain event awaiting publication."""

    __tablename__ = "blob_outbox"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    trace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, default=uuid.uuid4
    )

    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=OutboxStatus.PENDING
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )

    # Relay scans for the oldest pending rows; partial index keeps it cheap.
    __table_args__ = (
        Index(
            "idx_outbox_pending",
            "created_at",
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<BlobOutbox id={self.id!r} type={self.event_type!r} "
            f"status={self.status!r} attempts={self.attempts}>"
        )
