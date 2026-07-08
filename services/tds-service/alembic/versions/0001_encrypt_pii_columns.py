"""Encrypt PII columns: pan, aadhaar in employee_tax_profiles.

Revision ID: 0001
Revises: (none — first migration)
Create Date: 2026-05-31

PAN and Aadhaar are explicitly named as sensitive personal data under
Schedule I of the DPDP Act 2023.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "tds_schema"
TABLE = "employee_tax_profiles"
PII_COLUMNS = ["pan", "aadhaar"]


def upgrade() -> None:
    for col in PII_COLUMNS:
        op.alter_column(
            TABLE,
            col,
            existing_type=sa.String(),
            type_=sa.Text(),
            schema=SCHEMA,
            existing_nullable=True,
        )


def downgrade() -> None:
    limits = {"pan": 16, "aadhaar": 16}
    for col, length in limits.items():
        op.alter_column(
            TABLE,
            col,
            existing_type=sa.Text(),
            type_=sa.String(length),
            schema=SCHEMA,
            existing_nullable=True,
        )
