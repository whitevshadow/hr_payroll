"""Application-level append-only audit log.

A single ``audit_schema.audit_logs`` table. The model carries an explicit
schema so any service can write to it regardless of its own ``search_path``.
For V1 only the payroll-service writes audit rows (run/approve/payout/report).

# TODO(v2): move to DB append-only triggers + partitioning + cold storage;
# emit to an event bus instead of a direct insert.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

AUDIT_SCHEMA = "audit_schema"


class AuditBase(DeclarativeBase):
    """Standalone base so the audit table can be created independently."""


class AuditLog(AuditBase):
    __tablename__ = "audit_logs"
    __table_args__ = {"schema": AUDIT_SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    entity_type: Mapped[str | None] = mapped_column(String(100))
    entity_id: Mapped[str | None] = mapped_column(String(100))
    payload_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    trace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


def _hash_payload(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def audit_log(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    event_type: str,
    entity_type: str | None = None,
    entity_id: str | uuid.UUID | None = None,
    payload: dict | None = None,
    actor_id: uuid.UUID | None = None,
    trace_id: uuid.UUID | None = None,
    flush: bool = True,
) -> AuditLog:
    """Insert one append-only audit row.

    Does not commit — the caller controls the surrounding transaction.
    """
    payload = payload or {}
    row = AuditLog(
        tenant_id=tenant_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        payload_json=payload,
        payload_hash=_hash_payload(payload),
        actor_id=actor_id,
        trace_id=trace_id,
    )
    session.add(row)
    if flush:
        await session.flush()
    return row


async def ensure_audit_schema(session: AsyncSession) -> None:
    """Best-effort schema creation (used outside Alembic, e.g. tests)."""
    await session.execute(text(f"CREATE SCHEMA IF NOT EXISTS {AUDIT_SCHEMA}"))
