"""
app/scheduler.py

APScheduler background job that runs daily to permanently purge blobs that
have been soft-deleted for longer than SOFT_DELETE_RETENTION_DAYS.

The scheduler is started/stopped inside the FastAPI lifespan context in main.py.
"""

import asyncio
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_scheduler: BackgroundScheduler | None = None


def _run_purge_job() -> None:
    """Synchronous wrapper that executes the async purge coroutine in a new event loop."""
    async def _purge() -> None:
        from app.database.db import AsyncSessionLocal
        from app.services.blob_service import BlobService

        async with AsyncSessionLocal() as session:
            service = BlobService(session)
            count = await service.purge_expired_blobs()
            logger.info("Scheduled purge completed: %d blobs purged.", count)

    try:
        asyncio.run(_purge())
    except Exception as exc:  # noqa: BLE001
        logger.error("Scheduled purge job failed: %s", exc)


def _run_registry_reconcile_job() -> None:
    """Synchronous wrapper that executes registry stale reconciliation."""

    async def _reconcile() -> None:
        from app.database.db import AsyncSessionLocal
        from app.services.registry_service import RegistryService

        async with AsyncSessionLocal() as session:
            service = RegistryService(session)
            result = await service.reconcile_stale()
            logger.info("Registry stale reconciliation completed: %s", result)

    try:
        asyncio.run(_reconcile())
    except Exception as exc:  # noqa: BLE001
        logger.error("Scheduled registry reconcile job failed: %s", exc)


def _run_outbox_relay_job() -> None:
    """Publish pending transactional-outbox events to Kafka.

    Runs frequently from an APScheduler worker thread, so it uses a short-lived
    ``NullPool`` engine bound to this invocation's event loop instead of the
    shared pooled engine (whose connections belong to the main loop).
    """

    async def _relay() -> None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
        from sqlalchemy.pool import NullPool

        from app.events.outbox import relay

        engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
        try:
            factory = async_sessionmaker(bind=engine, expire_on_commit=False)
            async with factory() as session:
                await relay(session, batch_size=settings.OUTBOX_BATCH_SIZE)
        finally:
            await engine.dispose()

    try:
        asyncio.run(_relay())
    except Exception as exc:  # noqa: BLE001
        logger.error("Outbox relay job failed: %s", exc)


def start_purge_scheduler() -> None:
    """Initialise and start the APScheduler with the daily purge job."""
    global _scheduler
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _run_purge_job,
        trigger="interval",
        days=1,
        id="blob_purge_job",
        name="Soft-delete retention purge",
        replace_existing=True,
    )
    _scheduler.add_job(
        _run_registry_reconcile_job,
        trigger="interval",
        minutes=settings.REGISTRY_RECONCILE_INTERVAL_MINUTES,
        id="registry_reconcile_job",
        name="Registry stale extraction reconciler",
        replace_existing=True,
    )
    _scheduler.add_job(
        _run_outbox_relay_job,
        trigger="interval",
        seconds=settings.OUTBOX_RELAY_INTERVAL_SECONDS,
        id="outbox_relay_job",
        name="Transactional outbox relay",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info(
        "Purge scheduler running — will purge blobs soft-deleted > %d days ago daily.",
        settings.SOFT_DELETE_RETENTION_DAYS,
    )


def stop_purge_scheduler() -> None:
    """Gracefully shut down the scheduler."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Purge scheduler stopped.")
