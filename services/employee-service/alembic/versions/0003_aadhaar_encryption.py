"""Alter aadhaar_number to Text for encryption.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

SCHEMA = "employee_schema"
TABLE = "employees"

def upgrade() -> None:
    op.alter_column(
        TABLE,
        "aadhaar_number",
        existing_type=sa.String(20),
        type_=sa.Text(),
        schema=SCHEMA,
        existing_nullable=True,
    )

def downgrade() -> None:
    op.alter_column(
        TABLE,
        "aadhaar_number",
        existing_type=sa.Text(),
        type_=sa.String(20),
        schema=SCHEMA,
        existing_nullable=True,
    )
