"""Client V2: JSONB consolidation + new fields + portal credential expansion.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-30

Changes
-------
1. Adds JSONB columns: address, contact, statutory_ids
2. Adds new scalar columns: industry, payroll_start_date, payroll_frequency,
   financial_year, msme_number, website, cin_number (already exists — skip)
3. Adds client_documents table
4. Data from old flat columns is preserved; see scripts/migrate_01_clients_jsonb.py
   to run the actual data migration before dropping old columns.

WARNING: Old flat columns are NOT dropped here — dual-read period.
         Run migration 0003 after validating migrate_01_clients_jsonb.py.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SCHEMA = "employee_schema"


def upgrade() -> None:
    # ── Client table: add JSONB columns ────────────────────────────────────────
    for col_name in ("address", "contact", "statutory_ids"):
        op.add_column(
            "clients",
            sa.Column(col_name, JSONB, nullable=True),
            schema=SCHEMA,
        )

    # ── Client table: add new scalar columns ──────────────────────────────────
    op.add_column(
        "clients",
        sa.Column("industry", sa.String(100), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("payroll_start_date", sa.Date, nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("payroll_frequency", sa.String(20), server_default="MONTHLY", nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("payroll_calendar", sa.String(30), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("financial_year", sa.String(9), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("msme_number", sa.String(50), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("website", sa.String(255), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "clients",
        sa.Column("salary_template_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )

    # ── portal_type expansion: extend string width to support all portal types ─
    op.alter_column(
        "client_portal_credentials",
        "portal_type",
        existing_type=sa.String(20),
        type_=sa.String(50),
        schema=SCHEMA,
    )

    # ── client_documents table ─────────────────────────────────────────────────
    op.create_table(
        "client_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), sa.ForeignKey(f"{SCHEMA}.clients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("blob_id", UUID(as_uuid=True), nullable=True),
        sa.Column("doc_category", sa.String(50), nullable=True),
        sa.Column("doc_label", sa.String(100), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("expiry_date", sa.Date, nullable=True),
        sa.Column("version", sa.Integer, server_default="1"),
        sa.Column("verification_status", sa.String(20), server_default="PENDING"),
        sa.Column("verified_by", UUID(as_uuid=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verification_comment", sa.Text, nullable=True),
        sa.Column("superseded_by_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )
    op.create_index(
        "idx_client_docs_client_id",
        "client_documents",
        ["tenant_id", "client_id"],
        schema=SCHEMA,
    )
    op.create_index(
        "idx_client_docs_expiry",
        "client_documents",
        ["expiry_date"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("client_documents", schema=SCHEMA)
    for col in ("salary_template_id", "website", "msme_number", "financial_year",
                "payroll_calendar", "payroll_frequency", "payroll_start_date", "industry",
                "statutory_ids", "contact", "address"):
        op.drop_column("clients", col, schema=SCHEMA)
    op.alter_column(
        "client_portal_credentials",
        "portal_type",
        existing_type=sa.String(50),
        type_=sa.String(20),
        schema=SCHEMA,
    )
