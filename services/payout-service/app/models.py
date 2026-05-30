from __future__ import annotations

import uuid
from decimal import Decimal

from hr_shared import TenantAwareBase
from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class PayoutBatch(TenantAwareBase):
    __tablename__ = "payout_batches"

    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    batch_type: Mapped[str] = mapped_column(String(20), default="SALARY")
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")

    transactions: Mapped[list["PayoutTransaction"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan", lazy="selectin"
    )


class PayoutTransaction(TenantAwareBase):
    __tablename__ = "payout_transactions"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_payout_idem"),
    )

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("payout_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="QUEUED")
    bank_reference: Mapped[str | None] = mapped_column(String(60))

    batch: Mapped[PayoutBatch] = relationship(back_populates="transactions")
