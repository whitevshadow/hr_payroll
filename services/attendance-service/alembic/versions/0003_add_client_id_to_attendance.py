"""Add client_id to attendance_records and attendance_months.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-12

Changes
-------
1. Adds nullable client_id (UUID) column to attendance_records
2. Adds index on attendance_records.client_id
3. Adds nullable client_id (UUID) column to attendance_months
4. Replaces old unique constraint uq_att_control_month with one that
   includes client_id (tenant_id, client_id, month)
   — Note: uq_att_month on attendance_records is unchanged because
     one employee can only appear once per month per tenant regardless
     of client_id (employees belong to exactly one client).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

SCHEMA = "attendance_schema"


def upgrade() -> None:
    # ── attendance_records: add client_id ─────────────────────────────────────
    op.add_column(
        "attendance_records",
        sa.Column("client_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_attendance_records_client_id",
        "attendance_records",
        ["client_id"],
        schema=SCHEMA,
    )

    # ── attendance_months: add client_id + fix unique constraint ──────────────
    op.add_column(
        "attendance_months",
        sa.Column("client_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_attendance_months_client_id",
        "attendance_months",
        ["tenant_id", "client_id"],
        schema=SCHEMA,
    )

    # Drop old unique constraint (only tenant_id + month) and replace with
    # one that also includes client_id so different clients can have separate
    # monthly control rows for the same month.
    # Use IF EXISTS to be idempotent in case the DB was freshly created with
    # create_all() which already used the new schema.
    op.execute(
        sa.text(
            "ALTER TABLE attendance_schema.attendance_months "
            "DROP CONSTRAINT IF EXISTS uq_att_control_month"
        )
    )
    op.create_unique_constraint(
        "uq_att_control_month",
        "attendance_months",
        ["tenant_id", "client_id", "month"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    # Restore old constraint
    op.drop_constraint("uq_att_control_month", "attendance_months", schema=SCHEMA)
    op.create_unique_constraint(
        "uq_att_control_month",
        "attendance_months",
        ["tenant_id", "month"],
        schema=SCHEMA,
    )
    op.drop_index("ix_attendance_months_client_id", table_name="attendance_months", schema=SCHEMA)
    op.drop_column("attendance_months", "client_id", schema=SCHEMA)

    op.drop_index("ix_attendance_records_client_id", table_name="attendance_records", schema=SCHEMA)
    op.drop_column("attendance_records", "client_id", schema=SCHEMA)
