"""Reporting V2: blob_id, client_id, financial_year, format on generated_reports.

Revision ID: 0002
Revises: None (first reporting migration)
Create Date: 2026-06-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0002"
down_revision = None
branch_labels = None
depends_on = None
SCHEMA = "reporting_schema"


def upgrade() -> None:
    op.add_column(
        "generated_reports",
        sa.Column("blob_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "generated_reports",
        sa.Column("client_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "generated_reports",
        sa.Column("financial_year", sa.String(9), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "generated_reports",
        sa.Column("format", sa.String(10), server_default="'PDF'"),
        schema=SCHEMA,
    )
    op.create_index(
        "idx_gen_reports_cycle_client",
        "generated_reports",
        ["tenant_id", "cycle_id", "client_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("idx_gen_reports_cycle_client", "generated_reports", schema=SCHEMA)
    for col in ("format", "financial_year", "client_id", "blob_id"):
        op.drop_column("generated_reports", col, schema=SCHEMA)
