"""
app/events/event_producer.py

Async Kafka producer for emitting standard EventEnvelopes for Blobstore events.
Events include `blob.created.v1`, `blob.updated.v1`, `blob.deleted.v1`, etc.
"""

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone

from app.config import get_settings

logger = logging.getLogger(__name__)

_producer = None


async def init_producer() -> None:
    settings = get_settings()
    if not settings.ENABLE_KAFKA_CONSUMER:  # Use the same toggle for simplicity
        logger.info("Kafka producer disabled via ENABLE_KAFKA_CONSUMER.")
        return

    try:
        from aiokafka import AIOKafkaProducer
    except ImportError:
        logger.warning("aiokafka not installed; producer disabled.")
        return

    global _producer
    bootstrap_servers = settings.KAFKA_BOOTSTRAP_SERVERS or settings.KAFKA_BROKER
    _producer = AIOKafkaProducer(
        bootstrap_servers=bootstrap_servers,
        value_serializer=lambda v: json.dumps(v).encode("utf-8")
    )
    try:
        await _producer.start()
        logger.info("Kafka producer connected to %s", bootstrap_servers)
    except Exception as exc:
        logger.error("Failed to start Kafka producer: %s", exc)
        _producer = None


async def close_producer() -> None:
    global _producer
    if _producer:
        try:
            await _producer.stop()
            logger.info("Kafka producer stopped.")
        except Exception as exc:
            logger.error("Error stopping Kafka producer: %s", exc)
        finally:
            _producer = None


def _hash_payload(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


class ProducerUnavailable(RuntimeError):
    """Raised when the Kafka producer is not connected, so the relay retries."""


async def send_envelope(envelope: dict, tenant_id: str) -> None:
    """
    Publish a pre-built EventEnvelope (used by the transactional-outbox relay).

    Raises ``ProducerUnavailable`` if the producer is not connected and
    re-raises send errors, so the relay can keep the row PENDING and retry
    rather than silently dropping the event.
    """
    if not _producer:
        raise ProducerUnavailable("Kafka producer is not connected")

    settings = get_settings()
    await _producer.send_and_wait(
        settings.KAFKA_TOPIC_BLOB_EVENTS,
        envelope,
        key=tenant_id.encode("utf-8"),
    )
    logger.debug(
        "Published event %s for tenant %s", envelope.get("event_type"), tenant_id
    )


async def publish_event(
    event_type: str,
    tenant_id: str,
    payload: dict,
    trace_id: str | None = None
) -> None:
    """
    Best-effort direct publish (legacy helper).

    Prefer the transactional outbox (``app.events.outbox.enqueue``) for durable
    delivery — this helper drops the event if the producer is unavailable.
    """
    if not _producer:
        return

    settings = get_settings()
    envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": event_type,
        "tenant_id": tenant_id,
        "trace_id": trace_id or str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "payload": payload,
        "payload_hash": _hash_payload(payload)
    }

    try:
        await _producer.send_and_wait(
            settings.KAFKA_TOPIC_BLOB_EVENTS,
            envelope,
            key=tenant_id.encode("utf-8")
        )
        logger.debug("Published event %s for tenant %s", event_type, tenant_id)
    except Exception as exc:
        logger.error("Failed to publish event %s: %s", event_type, exc)
