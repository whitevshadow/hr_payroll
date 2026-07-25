"""Declarative base shared by all tenant-scoped tables."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class TenantAwareBase(DeclarativeBase):
    """Base class adding the standard columns every V1 table carries.

    Every table inherits ``id`` (UUID PK), ``tenant_id`` (NOT NULL, used for
    multi-tenant isolation), and ``created_at`` / ``updated_at`` timestamps.

    Tables that are append-only (e.g. audit_logs) override / drop
    ``updated_at`` themselves.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
