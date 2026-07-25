"""
app/database/db.py

Async SQLAlchemy engine and session factory.
Provides:
  - `AsyncSessionLocal`  – context-managed database sessions
  - `get_db`             – FastAPI dependency
  - `init_db`            – creates tables on first startup
"""

import logging
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings
from app.database.base import Base  # noqa: F401 – imported so models register

logger = logging.getLogger(__name__)

settings = get_settings()

# ── Engine ────────────────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,          # verify connections before checkout
    pool_size=10,
    max_overflow=20,
    pool_recycle=3600,           # recycle idle connections after 1 hour
)

# ── Session factory ───────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ── Dependency ────────────────────────────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields a database session and ensures it is
    closed after the request completes (commit/rollback handled by caller).
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Database initialisation ────────────────────────────────────────────────────
async def init_db() -> None:
    """
    Create all tables from the ORM models and ensure secondary indexes exist.

    The schema is defined authoritatively by the SQLAlchemy models, so
    ``Base.metadata.create_all`` produces the correct ``blobs``,
    ``document_registry`` and ``blob_outbox`` tables (including the partial
    ``idx_blobs_active`` index declared on the model). The platform convention is
    ``create_all`` on startup (see ``hr_shared.service`` — Alembic is the V2 plan
    across all services).

    The only extra DDL here creates the document-registry lookup indexes, which
    are not expressed on the model. Every statement is idempotent.
    """
    from sqlalchemy import text

    # Import models so Base.metadata is fully populated before create_all.
    import app.models.blob_model         # noqa: F401
    import app.models.document_registry  # noqa: F401
    import app.models.outbox             # noqa: F401
    # New production-grade employee document models.
    import app.models.employee_document  # noqa: F401
    import app.models.document_audit     # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database tables verified / created successfully.")

    # ── Document-registry lookup indexes (not declared on the model) ───────────
    registry_indexes = [
        "CREATE INDEX IF NOT EXISTS idx_registry_tenant_type ON document_registry (tenant_id, doc_type)",
        "CREATE INDEX IF NOT EXISTS idx_registry_employee ON document_registry (tenant_id, employee_id, doc_type)",
        "CREATE INDEX IF NOT EXISTS idx_registry_cycle ON document_registry (tenant_id, payroll_cycle_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_registry_month ON document_registry (tenant_id, month, doc_type)",
    ]
    try:
        async with engine.begin() as conn:
            for ddl in registry_indexes:
                await conn.execute(text(ddl))
        logger.info("Document registry indexes verified / created successfully.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Document registry index creation skipped or failed: %s", exc)

    # ── Additive column migrations for blobs table (safe — nullable with defaults) ──
    # These guards run after create_all, so they only fire on existing deployments
    # that already have the blobs table without these columns.
    blob_column_migrations = [
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS doc_category VARCHAR(50)",
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS doc_label VARCHAR(100)",
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'PENDING'",
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS verified_by UUID",
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ",
        "ALTER TABLE blobs ADD COLUMN IF NOT EXISTS verification_comment TEXT",
        # Indexes for efficient employee-doc queries
        "CREATE INDEX IF NOT EXISTS idx_blobs_employee_category ON blobs (tenant_id, employee_id, doc_category) WHERE is_deleted = false",
        "CREATE INDEX IF NOT EXISTS idx_blobs_verification ON blobs (tenant_id, verification_status) WHERE is_deleted = false",
    ]
    try:
        async with engine.begin() as conn:
            for ddl in blob_column_migrations:
                await conn.execute(text(ddl))
        logger.info("Blob table additive column migrations applied successfully.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Blob table column migration skipped or failed: %s", exc)

    # ── Data normalisation (idempotent — only touches rows that need fixing) ─────
    # doc_category must be lowercase ("identity", not "IDENTITY") so the grouping
    # and completion-tracker lookups match DocCategory constants exactly.
    # doc_label must be uppercase ("AADHAAR_CARD", not "aadhaar_card") to match
    # the MANDATORY_DOCS lookup keys in employee_doc_router.
    # These statements are safe to run on every startup; they are no-ops once all
    # existing rows have been normalised.
    normalisation_stmts = [
        """
        UPDATE blobs
        SET doc_category = LOWER(doc_category)
        WHERE doc_category IS NOT NULL
          AND doc_category != LOWER(doc_category)
        """,
        """
        UPDATE blobs
        SET doc_label = UPPER(doc_label)
        WHERE doc_label IS NOT NULL
          AND doc_label != UPPER(doc_label)
        """,
    ]
    try:
        async with engine.begin() as conn:
            for stmt in normalisation_stmts:
                result = await conn.execute(text(stmt))
                if result.rowcount:
                    logger.info(
                        "Data normalisation: %d row(s) updated → %s",
                        result.rowcount,
                        stmt.strip().split("\n")[1].strip(),
                    )
        logger.info("Blob data normalisation complete.")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Blob data normalisation skipped or failed: %s", exc)

