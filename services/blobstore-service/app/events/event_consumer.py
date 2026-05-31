"""
app/events/event_consumer.py

Async Kafka consumer that populates an in-memory deque with MinIO bucket events.

Flow:
  MinIO bucket notifications → Kafka topic "blob-store-events"
                             → AIOKafkaConsumer
                             → event_queue deque (maxlen=50)
                             → SSE endpoint /notifications/stream

The deque acts as a ring buffer of the last 50 events — the same pattern
used by the MS Blob Store service but without Redis as a middle layer.

Started as an asyncio.Task from the FastAPI lifespan (see main.py).
"""

import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Ring buffer — last 50 events, thread-safe for appends from a single async task
event_queue: deque = deque(maxlen=50)

_consumer_task: asyncio.Task | None = None
_last_consumed_at: datetime | None = None


async def start_consumer() -> None:
    """Spawn the Kafka consumer as a background asyncio task."""
    global _consumer_task
    _consumer_task = asyncio.create_task(_consume(), name="blob-event-consumer")
    logger.info("Blob event consumer task created.")


async def _handle_org_event(event: dict) -> None:
    """
    React to organization lifecycle events.

    ORG_CREATED.v1 → provision the tenant bucket (versioning + encryption +
    lifecycle). ORG_DELETED.v1 → archive the bucket (retain, never delete here).
    """
    event_type = event.get("event_type")
    tenant_id = event.get("tenant_id") or (event.get("payload") or {}).get("tenant_id")
    if not event_type or not tenant_id:
        return

    from app.storage.minio_client import get_bucket_resolver

    resolver = get_bucket_resolver()
    try:
        if event_type == "ORG_CREATED.v1":
            await asyncio.to_thread(resolver.provision_tenant, str(tenant_id))
            logger.info("Provisioned bucket for new org %s", tenant_id)
        elif event_type == "ORG_DELETED.v1":
            await asyncio.to_thread(resolver.archive_tenant, str(tenant_id))
            logger.info("Archived bucket for deleted org %s", tenant_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed handling %s for tenant %s: %s", event_type, tenant_id, exc)


async def _consume() -> None:
    """
    Main consumer loop.

    Connects with retry logic so a temporarily unavailable Kafka broker
    does not crash the app — events will simply be missed until Kafka
    comes back online and the retry succeeds.
    """
    from app.config import get_settings
    settings = get_settings()

    # Lazy import so aiokafka is not required if Kafka is disabled
    try:
        from aiokafka import AIOKafkaConsumer
    except ImportError:
        logger.warning(
            "aiokafka not installed — blob event streaming disabled. "
            "Install with: pip install aiokafka"
        )
        return

    global _last_consumed_at

    while True:  # outer loop: reconnect on broker failure
        bootstrap_servers = settings.KAFKA_BOOTSTRAP_SERVERS or settings.KAFKA_BROKER
        consumer = AIOKafkaConsumer(
            settings.KAFKA_TOPIC_BLOB_EVENTS,
            settings.KAFKA_TOPIC_ORG_EVENTS,
            bootstrap_servers=bootstrap_servers,
            group_id=settings.KAFKA_GROUP_ID,
            auto_offset_reset="latest",
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        )
        try:
            await consumer.start()
            logger.info(
                "Connected to Kafka broker=%s topics=[%s, %s]",
                bootstrap_servers,
                settings.KAFKA_TOPIC_BLOB_EVENTS,
                settings.KAFKA_TOPIC_ORG_EVENTS,
            )
            async for msg in consumer:
                _last_consumed_at = datetime.now(timezone.utc)
                # Drive automatic provisioning/archival off org lifecycle events.
                if msg.topic == settings.KAFKA_TOPIC_ORG_EVENTS and isinstance(msg.value, dict):
                    await _handle_org_event(msg.value)
                event_queue.appendleft(
                    {
                        "timestamp": msg.timestamp,
                        "topic": msg.topic,
                        "offset": msg.offset,
                        "partition": msg.partition,
                        "data": msg.value,
                    }
                )
        except asyncio.CancelledError:
            logger.info("Blob event consumer cancelled — shutting down.")
            break
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Kafka consumer error: %s — reconnecting in 5s.", exc
            )
            await asyncio.sleep(5)
        finally:
            try:
                await consumer.stop()
            except Exception:  # noqa: BLE001
                pass


async def stop_consumer() -> None:
    """Gracefully cancel the consumer task."""
    global _consumer_task
    if _consumer_task and not _consumer_task.done():
        _consumer_task.cancel()
        await asyncio.gather(_consumer_task, return_exceptions=True)
        logger.info("Blob event consumer stopped.")


def get_consumer_health() -> dict:
    now = datetime.now(timezone.utc)
    lag_seconds: int | None = None
    if _last_consumed_at is not None:
        lag_seconds = int((now - _last_consumed_at).total_seconds())

    return {
        "task_running": _consumer_task is not None and not _consumer_task.done(),
        "last_consumed_at": _last_consumed_at,
        "consumer_lag_seconds": lag_seconds,
        "has_messages_in_buffer": len(event_queue) > 0,
    }
