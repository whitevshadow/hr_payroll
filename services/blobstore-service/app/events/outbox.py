"""
app/events/outbox.py

Transactional-outbox helpers.

``enqueue`` writes a durable ``blob_outbox`` row for a domain event. ``relay``
publishes pending rows to Kafka and advances their status. The relay is driven
by the APScheduler job in ``app/scheduler.py`` and is also safe to call from
multiple workers because it claims rows with ``FOR UPDATE SKIP LOCKED``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.outbox import BlobOutbox, OutboxStatus

logger = logging.getLogger(__name__)


def _hash_payload(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


async def enqueue(
    session: AsyncSession,
    *,
    event_type: str,
    tenant_id: uuid.UUID,
    payload: dict,
    trace_id: uuid.UUID | None = None,
) -> None:
    """
    Persist a domain event to the outbox.

    Call this with the same session that performed the metadata change so the
    event becomes durable as soon as that work is committed — Kafka can be down
    and the event will still be delivered once it recovers.
    """
    row = BlobOutbox(
        event_type=event_type,
        tenant_id=tenant_id,
        trace_id=trace_id or uuid.uuid4(),
        payload=payload,
        payload_hash=_hash_payload(payload),
        status=OutboxStatus.PENDING,
    )
    session.add(row)
    await session.commit()
    logger.debug("Outbox enqueued %s for tenant %s", event_type, tenant_id)


def _build_envelope(row: BlobOutbox) -> dict:
    """Construct the standard EventEnvelope from a stored outbox row."""
    return {
        "event_id": str(row.id),
        "event_type": row.event_type,
        "tenant_id": str(row.tenant_id),
        "trace_id": str(row.trace_id),
        "timestamp": (row.created_at or datetime.now(timezone.utc)).isoformat(),
        "payload": row.payload,
        "payload_hash": row.payload_hash,
    }


async def relay(session: AsyncSession, batch_size: int = 100) -> dict:
    """
    Publish pending outbox rows to Kafka.

    Returns a small summary dict ``{published, dlq, remaining_failures}``.
    Rows that fail are retried on the next pass; once ``attempts`` reaches
    ``OUTBOX_MAX_ATTEMPTS`` they are parked in ``DLQ``.
    """
    from app.events.event_producer import send_envelope

    settings = get_settings()
    max_attempts = settings.OUTBOX_MAX_ATTEMPTS

    # Claim a batch of pending rows; SKIP LOCKED lets multiple relays cooperate.
    result = await session.execute(
        select(BlobOutbox)
        .where(BlobOutbox.status == OutboxStatus.PENDING)
        .order_by(BlobOutbox.created_at)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )
    rows = list(result.scalars().all())
    if not rows:
        return {"published": 0, "dlq": 0, "remaining_failures": 0}

    published = 0
    dlq = 0
    failures = 0

    for row in rows:
        try:
            await send_envelope(_build_envelope(row), str(row.tenant_id))
            row.status = OutboxStatus.SENT
            row.sent_at = datetime.now(timezone.utc)
            published += 1
        except Exception as exc:  # noqa: BLE001
            row.attempts += 1
            row.last_error = str(exc)[:500]
            if row.attempts >= max_attempts:
                row.status = OutboxStatus.DLQ
                dlq += 1
                logger.error(
                    "Outbox row %s moved to DLQ after %d attempts: %s",
                    row.id, row.attempts, exc,
                )
            else:
                failures += 1

    await session.commit()
    if published or dlq:
        logger.info(
            "Outbox relay: published=%d dlq=%d transient_failures=%d",
            published, dlq, failures,
        )
    return {"published": published, "dlq": dlq, "remaining_failures": failures}
