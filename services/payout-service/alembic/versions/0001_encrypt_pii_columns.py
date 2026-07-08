"""Encrypt PII column: bank_reference in payout_transactions.

Revision ID: 0001
Revises: (none — first migration)
Create Date: 2026-05-31

bank_reference holds a UTR / NEFT / IMPS reference that uniquely identifies
a financial transfer to a bank account — PII under DPDP Act 2023 s.2(t).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "payout_schema"
TABLE = "payout_transactions"


def upgrade() -> None:
    op.alter_column(
        TABLE,
        "bank_reference",
        existing_type=sa.String(60),
        type_=sa.Text(),
        schema=SCHEMA,
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        TABLE,
        "bank_reference",
        existing_type=sa.Text(),
        type_=sa.String(60),
        schema=SCHEMA,
        existing_nullable=True,
    )
