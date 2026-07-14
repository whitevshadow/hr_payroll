from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .deps import runtime
from .routes import router
from .leave_routes import router as leave_router

# ---------------------------------------------------------------------------
# Schema upgrade helpers
# ---------------------------------------------------------------------------
# The service uses create_all() to set up tables on first boot, but that
# will NOT add new columns to tables that already exist.  The statements
# below are idempotent (ADD COLUMN IF NOT EXISTS) so they are safe to run on
# every startup without risk of data loss.
_SCHEMA_UPGRADES = [
    # V2 → add client_id to attendance_records (added after initial release)
    """
    ALTER TABLE attendance_schema.attendance_records
        ADD COLUMN IF NOT EXISTS client_id uuid
    """,

    # V2 → add client_id to attendance_months and fix unique constraint
    """
    ALTER TABLE attendance_schema.attendance_months
        ADD COLUMN IF NOT EXISTS client_id uuid
    """,

    # Drop the old tenant-only unique constraint if it exists (pre-client_id era)
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'uq_att_control_month'
              AND conrelid = 'attendance_schema.attendance_months'::regclass
        ) THEN
            -- Check if constraint already includes client_id
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.conrelid
                    AND a.attnum = ANY(c.conkey)
                WHERE c.conname = 'uq_att_control_month'
                  AND c.conrelid = 'attendance_schema.attendance_months'::regclass
                  AND a.attname = 'client_id'
            ) THEN
                ALTER TABLE attendance_schema.attendance_months
                    DROP CONSTRAINT uq_att_control_month;
                ALTER TABLE attendance_schema.attendance_months
                    ADD CONSTRAINT uq_att_control_month
                    UNIQUE (tenant_id, client_id, month);
            END IF;
        END IF;
    END $$
    """,

    # V2 → add leave_breakdown jsonb to attendance_records (added in 0002)
    """
    ALTER TABLE attendance_schema.attendance_records
        ADD COLUMN IF NOT EXISTS leave_breakdown jsonb
    """,

    # V3 → add description column to leave_policies
    """
    ALTER TABLE attendance_schema.leave_policies
        ADD COLUMN IF NOT EXISTS description text
    """,

    # V3 → rename annual_quota → annual_allowance in leave_policies
    # Use DO block to handle the case where column already has the new name
    """
    DO $$
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'attendance_schema'
              AND table_name = 'leave_policies'
              AND column_name = 'annual_quota'
        ) THEN
            ALTER TABLE attendance_schema.leave_policies
                RENAME COLUMN annual_quota TO annual_allowance;
        END IF;
    END $$
    """,

    # V3 → add requires_document_after_days to leave_policies
    """
    ALTER TABLE attendance_schema.leave_policies
        ADD COLUMN IF NOT EXISTS requires_document_after_days integer
    """,
]


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # First: let the base runtime create any missing tables.
    await runtime.create_all()

    # Second: apply idempotent column/constraint additions for existing tables.
    async with runtime.engine.begin() as conn:
        for stmt in _SCHEMA_UPGRADES:
            try:
                await conn.execute(text(stmt.strip()))
            except Exception as exc:  # noqa: BLE001
                # Log but don't crash — a column that already exists will
                # just produce an innocuous 'duplicate column' error from an
                # older Postgres that doesn't support IF NOT EXISTS everywhere.
                print(f"[attendance-service] schema upgrade warning: {exc}")

    yield
    await runtime.engine.dispose()


app = FastAPI(title="attendance-service", lifespan=_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(leave_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "attendance-service"}
