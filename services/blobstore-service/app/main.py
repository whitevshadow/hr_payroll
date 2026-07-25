"""
app/main.py

Application entry point.
- Configures structured logging.
- Defines FastAPI lifespan (startup/shutdown + APScheduler).
- Wires up CORS and the Blob router.
- Provides split Kubernetes health probes: /health/live and /health/ready.

Consuming services: reporting-service, payout-service, employee-service
MinIO bucket convention: <tenant_id>-blobs (falls back to MINIO_BUCKET env)
"""

import asyncio
import logging
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.blob_router import router as blob_router
from app.api.bucket_router import router as bucket_router
from app.api.employee_doc_router import router as employee_doc_router
from app.api.registry_router import router as registry_router
from app.config import get_settings
from app.database.db import engine, init_db
from app.events.event_consumer import get_consumer_health, start_consumer, stop_consumer
from app.schemas.blob_schema import LivenessResponse, ReadinessResponse
from app.storage.minio_client import get_minio_client, init_minio

settings = get_settings()

# ── Logging Setup ──────────────────────────────────────────────────────────────

def setup_logging() -> None:
    """Configure standard library structured logging."""
    log_level_name = "DEBUG" if settings.DEBUG else settings.LOG_LEVEL.upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.INFO)


# ── Scheduled Purge ────────────────────────────────────────────────────────────

def _start_scheduler() -> None:
    """Start the APScheduler background job for expired blob purges."""
    try:
        from app.scheduler import start_purge_scheduler
        start_purge_scheduler()
        logging.getLogger("app.startup").info("Blob purge scheduler started.")
    except ImportError:
        logging.getLogger("app.startup").warning(
            "APScheduler not installed; scheduled blob purge disabled."
        )


def _stop_scheduler() -> None:
    """Gracefully shut down the APScheduler instance."""
    try:
        from app.scheduler import stop_purge_scheduler
        stop_purge_scheduler()
    except Exception:  # noqa: BLE001
        pass


async def _preflight_check() -> None:
    """
    Probe required dependencies before running migrations/startup tasks.

    Fails fast with explicit startup errors after bounded retries.
    """
    logger = logging.getLogger("app.startup")
    max_retries = settings.STARTUP_MAX_RETRIES
    base_delay = settings.STARTUP_RETRY_DELAY_SECONDS

    for attempt in range(1, max_retries + 1):
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            logger.info("[STARTUP] PostgreSQL reachable (attempt %d/%d)", attempt, max_retries)
            break
        except Exception as exc:  # noqa: BLE001
            if attempt == max_retries:
                logger.warning(
                    "[STARTUP] PostgreSQL not reachable (%s) — retries exhausted (%d/%d)",
                    exc,
                    attempt,
                    max_retries,
                )
                raise RuntimeError(
                    "[STARTUP] PostgreSQL preflight failed after retries"
                ) from None
            logger.info(
                "[STARTUP] PostgreSQL not reachable yet (%s) — retrying (%d/%d)",
                exc,
                attempt,
                max_retries,
            )
            await asyncio.sleep(base_delay * attempt)

    for attempt in range(1, max_retries + 1):
        try:
            # init_minio includes internal retries + client/bootstrap setup
            await asyncio.to_thread(init_minio)
            client = get_minio_client()
            await asyncio.to_thread(client.list_buckets)
            logger.info("[STARTUP] MinIO reachable (attempt %d/%d)", attempt, max_retries)
            break
        except Exception as exc:  # noqa: BLE001
            if attempt == max_retries:
                logger.warning(
                    "[STARTUP] MinIO not reachable at %s (%s) — retries exhausted (%d/%d)",
                    settings.MINIO_ENDPOINT,
                    exc,
                    attempt,
                    max_retries,
                )
                raise RuntimeError(
                    f"[STARTUP] MinIO preflight failed at {settings.MINIO_ENDPOINT} after retries"
                ) from None
            logger.info(
                "[STARTUP] MinIO not reachable at %s yet (%s) — retrying (%d/%d)",
                settings.MINIO_ENDPOINT,
                exc,
                attempt,
                max_retries,
            )
            await asyncio.sleep(base_delay * attempt)


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup:
      1. Configure logging
      2. Initialise MinIO client and default bucket
      3. Apply database table creation + additive column migrations
      4. Start the APScheduler purge job

    Shutdown:
      - Stop scheduler
      - Dispose DB engine connections
    """
    setup_logging()
    logger = logging.getLogger("app.startup")

    logger.info("[STARTUP] Booting %s v%s (env=%s)", settings.APP_NAME, settings.APP_VERSION, settings.APP_ENV)

    # 1. Dependency preflight (Postgres + MinIO)
    await _preflight_check()

    # 2. Init DB (tables + additive column migrations — each guarded with try/except)
    await init_db()
    logger.info("[STARTUP] Database initialization completed")

    # 3. Start Kafka blob event consumer and producer (optional in standalone mode)
    if settings.ENABLE_KAFKA_CONSUMER:
        kafka_bootstrap = settings.KAFKA_BOOTSTRAP_SERVERS or settings.KAFKA_BROKER
        if not kafka_bootstrap:
            raise RuntimeError(
                "ENABLE_KAFKA_CONSUMER=true but no Kafka bootstrap servers are configured"
            )
        
        from app.events.event_producer import init_producer
        await start_consumer()
        await init_producer()
        logger.info("[STARTUP] Kafka consumer and producer started (brokers=%s)", kafka_bootstrap)
    else:
        logger.info(
            "[STARTUP] Kafka consumer and producer disabled (ENABLE_KAFKA_CONSUMER=false) — "
            "running in standalone mode with Postgres + MinIO only"
        )

    # 4. Start purge scheduler
    _start_scheduler()

    yield  # Application runs here

    # Shutdown
    logger.info("[SHUTDOWN] Stopping blobstore service")
    _stop_scheduler()
    if settings.ENABLE_KAFKA_CONSUMER:
        from app.events.event_producer import close_producer
        await stop_consumer()
        await close_producer()
    await engine.dispose()


# ── Application Factory ────────────────────────────────────────────────────────

_DESCRIPTION = """\
## Blobstore Microservice v2

Centralised file storage service for the microservice ecosystem.

**Consuming services:** `reporting-service`, `payout-service`, `employee-service`

**MinIO bucket convention:** `<tenant_id>-blobs` per tenant; falls back to `MINIO_BUCKET` env.

**Tenant isolation:** All write operations require the `X-Tenant-Id` header, which is
cross-validated against the calling service's JWT `tenant_id` claim.

**Soft delete:** `DELETE /blobs/{id}` soft-deletes by default (sets `deleted_at`).
Objects are permanently purged after `SOFT_DELETE_RETENTION_DAYS` days (default 30) by
a scheduled daily cleanup job.

**Event streaming:** `GET /blobs/notifications/stream` delivers MinIO bucket events
(upload/delete) as a Server-Sent Events stream, sourced from Kafka with no Redis hop.

**Provider interface:** Storage backend is `MinIOBlobStore(BlobStoreInterface)` —
swap to `S3BlobStore` in one line for production AWS deployments.
"""

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=_DESCRIPTION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
    openapi_tags=[
        {"name": "Blobs", "description": "File upload, download, metadata and management."},
        {"name": "Bucket Config", "description": "Bucket creation, CORS, and status endpoints."},
        {"name": "Notifications", "description": "Kafka-backed storage event stream (SSE)."},
        {"name": "Health", "description": "Kubernetes liveness and readiness probes."},
    ],
    openapi_extra={
        "components": {
            "securitySchemes": {
                "BearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT",
                },
                "TenantId": {
                    "type": "apiKey",
                    "in": "header",
                    "name": "X-Tenant-Id",
                },
            }
        }
    },
)


# ── Rate limiting ──────────────────────────────────────────────────────────────

if settings.RATE_LIMIT_ENABLED:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware
    from slowapi.util import get_remote_address

    def _rate_limit_key(request) -> str:
        # Prefer per-tenant limiting; fall back to client IP for unauthenticated
        # or pre-auth requests.
        return request.headers.get("x-tenant-id") or get_remote_address(request)

    limiter = Limiter(
        key_func=_rate_limit_key,
        default_limits=[settings.RATE_LIMIT_DEFAULT],
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)


# ── Middleware ─────────────────────────────────────────────────────────────────

# A wildcard origin with credentials is rejected by browsers and is unsafe, so
# credentials are only allowed when an explicit origin allow-list is configured.
_cors_origins = settings.CORS_ALLOW_ORIGINS
_allow_credentials = "*" not in _cors_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Tenant-Id"],
)


# ── Routers ────────────────────────────────────────────────────────────────────

# Mounted under /api/v1 to match the platform gateway's path-prefix routing and
# the convention used by every other service.
app.include_router(blob_router, prefix="/api/v1")
app.include_router(bucket_router, prefix="/api/v1")
app.include_router(registry_router, prefix="/api/v1")
app.include_router(employee_doc_router, prefix="/api/v1")


# ── Health Probes ──────────────────────────────────────────────────────────────

@app.get(
    "/health/live",
    response_model=LivenessResponse,
    status_code=status.HTTP_200_OK,
    tags=["Health"],
    summary="Liveness probe",
    description=(
        "Kubernetes liveness probe. Always returns `200 OK` while the process is running. "
        "**Does not check external dependencies** (DB, MinIO) — use `/health/ready` for that."
    ),
)
async def health_live() -> LivenessResponse:
    """Returns 200 as long as the process is alive."""
    return LivenessResponse(status="ok")


@app.get("/health", tags=["Health"])
async def health() -> dict:
    """
    Composite health endpoint for local and standalone development.

    Returns status for all enabled dependencies.
    Kafka checks are skipped entirely when ENABLE_KAFKA_CONSUMER=false.
    """
    status_payload: dict = {
        "status": "ok",
        "env": settings.APP_ENV,
        "kafka_enabled": settings.ENABLE_KAFKA_CONSUMER,
    }

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        status_payload["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        status_payload["postgres"] = f"error: {exc}"
        status_payload["status"] = "degraded"

    try:
        from app.storage.minio_client import get_minio_client

        client = get_minio_client()
        client.list_buckets()
        status_payload["minio"] = "ok"
    except Exception as exc:  # noqa: BLE001
        status_payload["minio"] = f"error: {exc}"
        status_payload["status"] = "degraded"

    if settings.ENABLE_KAFKA_CONSUMER:
        try:
            status_payload["kafka"] = get_consumer_health()
        except Exception as exc:  # noqa: BLE001
            status_payload["kafka"] = f"error: {exc}"
            status_payload["status"] = "degraded"
    else:
        status_payload["kafka"] = "disabled"

    return status_payload


@app.get(
    "/health/ready",
    response_model=ReadinessResponse,
    tags=["Health"],
    summary="Readiness probe",
    description=(
        "Kubernetes readiness probe. Returns `200` when both PostgreSQL and MinIO are "
        "reachable. Returns **`503 Service Unavailable`** when either dependency is down "
        "— Kubernetes will stop routing traffic to this pod until it recovers."
    ),
    responses={
        200: {"description": "All dependencies healthy"},
        503: {"description": "One or more dependencies unavailable"},
    },
)
async def health_ready() -> ReadinessResponse:
    """Check DB and MinIO connectivity. Returns 503 when degraded."""
    logger = logging.getLogger(__name__)

    # DB Check
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as exc:
        logger.error("Readiness check — DB connection failed: %s", exc)
        db_status = "error"

    # MinIO Check
    try:
        from app.storage.minio_client import get_minio_client
        client = get_minio_client()
        client.bucket_exists(settings.MINIO_BUCKET)
        minio_status = "ok"
    except Exception as exc:
        logger.error("Readiness check — MinIO connection failed: %s", exc)
        minio_status = "error"

    # Kafka Consumer Check (optional)
    if settings.ENABLE_KAFKA_CONSUMER:
        consumer_health = get_consumer_health()
        consumer_lag_seconds = consumer_health["consumer_lag_seconds"]
        if not consumer_health["task_running"]:
            kafka_consumer_status = "error"
        elif (
            consumer_health["has_messages_in_buffer"]
            and consumer_lag_seconds is not None
            and consumer_lag_seconds > settings.CONSUMER_LAG_THRESHOLD_SECONDS
        ):
            kafka_consumer_status = "error"
        else:
            kafka_consumer_status = "ok"
    else:
        kafka_consumer_status = "disabled"
        consumer_lag_seconds = None

    is_healthy = (
        db_status == "ok"
        and minio_status == "ok"
        and kafka_consumer_status in {"ok", "disabled"}
    )

    from fastapi.responses import JSONResponse

    response_data = ReadinessResponse(
        status="healthy" if is_healthy else "degraded",
        database=db_status,
        minio=minio_status,
        kafka_consumer=kafka_consumer_status,
        consumer_lag_seconds=consumer_lag_seconds,
        version=settings.APP_VERSION,
    )

    if not is_healthy:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=response_data.model_dump(),
        )

    return response_data
