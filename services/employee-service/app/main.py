from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .deps import runtime
from .routes import router

# ── Additive schema guards ────────────────────────────────────────────────────
# V1 bootstraps with metadata.create_all (see hr_shared.service), which only
# CREATEs tables that are missing — it never ALTERs an existing table to add a
# column. So a new column on an existing model lands on a fresh database but is
# silently absent on every deployment that already has the table, and the next
# SELECT fails with UndefinedColumn. Alembic is the V2 plan and nothing in the
# compose stack runs `upgrade head` yet, so the platform convention is an
# idempotent ALTER after create_all (blobstore-service/app/database/db.py does
# the same). Every statement here must be safe to run on every boot.
#
# The FK is guarded by column rather than by constraint name: on a fresh
# database create_all has already built it under an auto-generated name, and a
# name check would add a second, redundant constraint alongside it.
_ADDITIVE_DDL = [
    """
    ALTER TABLE daily_rate_cards
        ADD COLUMN IF NOT EXISTS department_id UUID
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
            WHERE c.contype = 'f'
              AND t.relname = 'daily_rate_cards'
              AND a.attname = 'department_id'
        ) THEN
            ALTER TABLE daily_rate_cards
                ADD CONSTRAINT fk_rate_card_department
                FOREIGN KEY (department_id) REFERENCES departments (id)
                ON DELETE RESTRICT;
        END IF;
    END $$
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_daily_rate_cards_department_id
        ON daily_rate_cards (department_id)
    """,
    # ESIC Insured Person number. TEXT because EncryptedString stores a Fernet
    # token, which is far longer than the 10 digits it holds.
    """
    ALTER TABLE employees
        ADD COLUMN IF NOT EXISTS ip_number TEXT
    """,
]


async def apply_additive_migrations() -> None:
    """Bring an already-provisioned schema up to the current models.

    Runs inside one transaction: a half-applied set would leave the column
    present but unconstrained, which is harder to reason about than a clean
    failure at boot.
    """
    async with runtime.engine.begin() as conn:
        for ddl in _ADDITIVE_DDL:
            await conn.execute(text(ddl))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # runtime.lifespan() creates the schema and tables, then disposes the engine
    # on shutdown; the additive guards run after it, on the tables it just
    # ensured exist.
    async with runtime.lifespan()(app):
        await apply_additive_migrations()
        yield


app = FastAPI(title="employee-service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "employee-service"}
