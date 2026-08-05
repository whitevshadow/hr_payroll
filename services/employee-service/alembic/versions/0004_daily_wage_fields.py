"""Daily-wage support: client-level rate cards + wage_type on employees.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SCHEMA = "employee_schema"


def upgrade() -> None:
    op.create_table(
        "daily_rate_cards",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        # MONTHLY wages; payroll derives the day rate as monthly / days in the
        # cycle's month, matching the client register's own convention.
        sa.Column("monthly_basic", sa.Numeric(12, 2), nullable=False),
        sa.Column("monthly_da", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("monthly_hra", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("bonus_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "client_id", "name", name="uq_rate_card_name"),
        schema=SCHEMA,
    )
    op.create_index("ix_daily_rate_cards_client_id", "daily_rate_cards", ["client_id"], schema=SCHEMA)

    op.add_column("employees", sa.Column("wage_type", sa.String(10), nullable=False,
                                         server_default="MONTHLY"), schema=SCHEMA)
    op.add_column(
        "employees",
        sa.Column("daily_rate_card_id", UUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.daily_rate_cards.id", ondelete="SET NULL"),
                  nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("employees", "daily_rate_card_id", schema=SCHEMA)
    op.drop_column("employees", "wage_type", schema=SCHEMA)
    op.drop_index("ix_daily_rate_cards_client_id", "daily_rate_cards", schema=SCHEMA)
    op.drop_table("daily_rate_cards", schema=SCHEMA)
