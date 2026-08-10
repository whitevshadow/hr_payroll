"""Classify daily rate cards by department.

A rate card now belongs to one department, so employees in different
departments are paid at different rates. The column is nullable in the
database: deployments that already hold rate cards have no sensible
department to backfill to, and a NOT NULL constraint would fail the
migration outright. The API enforces the field on every create/update and
the UI marks pre-existing cards as unassigned until they are edited, which
is where the actual "required" guarantee lives.

``ondelete="RESTRICT"`` stops a department from being deleted while cards
still price its workers — silently orphaning a card would leave payroll
resolving a rate nobody owns.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

SCHEMA = "employee_schema"


def upgrade() -> None:
    op.add_column(
        "daily_rate_cards",
        sa.Column("department_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_foreign_key(
        "fk_rate_card_department",
        "daily_rate_cards",
        "departments",
        ["department_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_daily_rate_cards_department_id",
        "daily_rate_cards",
        ["department_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_daily_rate_cards_department_id", "daily_rate_cards", schema=SCHEMA)
    op.drop_constraint("fk_rate_card_department", "daily_rate_cards", schema=SCHEMA, type_="foreignkey")
    op.drop_column("daily_rate_cards", "department_id", schema=SCHEMA)
