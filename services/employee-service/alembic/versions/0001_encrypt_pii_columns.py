"""Encrypt PII columns: pan_number, bank_account, bank_ifsc, uan_number.

Revision ID: 0001
Revises: (none — first migration)
Create Date: 2026-05-31

Changes
-------
Columns that previously stored plaintext PII as String(N) are widened to
TEXT so they can hold Fernet-encrypted ciphertext (~100+ bytes base64).

Data migration note
-------------------
If rows exist from a pre-encryption deployment, run the companion script
scripts/encrypt_existing_pii.py BEFORE applying this migration to avoid
storing a mix of plaintext and ciphertext in the same column.
The platform currently uses create_all (no prior migrations), so no
pre-existing rows are expected in a clean deployment.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "employee_schema"
TABLE = "employees"
PII_COLUMNS = ["pan_number", "bank_account", "bank_ifsc", "uan_number"]


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
    # Downgrade truncates ciphertext that exceeds the original VARCHAR length.
    # Only safe on a clean (empty) database — do NOT run on production data.
    limits = {
        "pan_number": 20,
        "bank_account": 40,
        "bank_ifsc": 20,
        "uan_number": 30,
    }
    for col, length in limits.items():
        op.alter_column(
            TABLE,
            col,
            existing_type=sa.Text(),
            type_=sa.String(length),
            schema=SCHEMA,
            existing_nullable=True,
        )
