"""Attendance V2: leave_breakdown JSONB + full leave management tables.

Revision ID: 0002
Revises: (first migration for attendance)
Create Date: 2026-06-30

Changes
-------
1. Adds leave_breakdown JSONB column to attendance_records (dual-write, old
   columns kept for backward compatibility — see 0003 for cleanup)
2. Creates leave_policies, leave_balances, leave_requests, leave_transactions
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0002"
down_revision = None   # first attendance migration
branch_labels = None
depends_on = None

SCHEMA = "attendance_schema"


def upgrade() -> None:
    # ── attendance_records: add leave_breakdown JSONB ─────────────────────────
    op.add_column(
        "attendance_records",
        sa.Column("leave_breakdown", JSONB, nullable=True),
        schema=SCHEMA,
    )

    # ── leave_policies ────────────────────────────────────────────────────────
    op.create_table(
        "leave_policies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("leave_type", sa.String(30), nullable=False),  # CL|SL|PL|LOP|COMP_OFF|WFH|OPTIONAL
        sa.Column("annual_quota", sa.Numeric(5, 1), server_default="0"),
        sa.Column("carry_forward", sa.Boolean, server_default="FALSE"),
        sa.Column("max_carry_forward", sa.Numeric(5, 1), server_default="0"),
        sa.Column("encashable", sa.Boolean, server_default="FALSE"),
        sa.Column("max_consecutive_days", sa.Integer, server_default="0"),
        sa.Column("accrual_type", sa.String(20), server_default="'ANNUAL'"),  # ANNUAL|MONTHLY|QUARTERLY
        sa.Column("is_active", sa.Boolean, server_default="TRUE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )
    op.create_index("idx_leave_policies_tenant", "leave_policies", ["tenant_id", "client_id"], schema=SCHEMA)

    # ── leave_balances ────────────────────────────────────────────────────────
    op.create_table(
        "leave_balances",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", UUID(as_uuid=True), nullable=False),
        sa.Column("leave_type", sa.String(30), nullable=False),
        sa.Column("financial_year", sa.String(9), nullable=False),
        sa.Column("opening_balance", sa.Numeric(5, 1), server_default="0"),
        sa.Column("accrued", sa.Numeric(5, 1), server_default="0"),
        sa.Column("used", sa.Numeric(5, 1), server_default="0"),
        sa.Column("carry_forward_used", sa.Numeric(5, 1), server_default="0"),
        sa.Column("closing_balance", sa.Numeric(5, 1), server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("tenant_id", "employee_id", "leave_type", "financial_year", name="uq_leave_balance"),
        schema=SCHEMA,
    )
    op.create_index("idx_leave_balances_emp", "leave_balances", ["tenant_id", "employee_id", "financial_year"], schema=SCHEMA)

    # ── leave_requests ────────────────────────────────────────────────────────
    op.create_table(
        "leave_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", UUID(as_uuid=True), nullable=False),
        sa.Column("leave_type", sa.String(30), nullable=False),
        sa.Column("from_date", sa.Date, nullable=False),
        sa.Column("to_date", sa.Date, nullable=False),
        sa.Column("days", sa.Numeric(5, 1), nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), server_default="'PENDING'"),  # PENDING|APPROVED|REJECTED|CANCELLED
        sa.Column("applied_by", UUID(as_uuid=True), nullable=False),
        sa.Column("reviewed_by", UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_comment", sa.Text, nullable=True),
        sa.Column("financial_year", sa.String(9), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )
    op.create_index("idx_leave_requests_emp", "leave_requests", ["tenant_id", "employee_id", "status"], schema=SCHEMA)
    op.create_index("idx_leave_requests_dates", "leave_requests", ["tenant_id", "from_date", "to_date"], schema=SCHEMA)

    # ── leave_transactions (ledger) ───────────────────────────────────────────
    op.create_table(
        "leave_transactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", UUID(as_uuid=True), nullable=False),
        sa.Column("leave_request_id", UUID(as_uuid=True),
                  sa.ForeignKey(f"{SCHEMA}.leave_requests.id", ondelete="SET NULL"), nullable=True),
        sa.Column("leave_type", sa.String(30), nullable=False),
        sa.Column("financial_year", sa.String(9), nullable=False),
        sa.Column("transaction_type", sa.String(30), nullable=False),  # DEBIT|CREDIT|CARRY_FORWARD|LAPSE|ENCASHMENT
        sa.Column("days", sa.Numeric(5, 1), nullable=False),
        sa.Column("balance_after", sa.Numeric(5, 1), nullable=True),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )
    op.create_index("idx_leave_txn_emp", "leave_transactions", ["tenant_id", "employee_id", "financial_year"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_table("leave_transactions", schema=SCHEMA)
    op.drop_table("leave_requests", schema=SCHEMA)
    op.drop_table("leave_balances", schema=SCHEMA)
    op.drop_table("leave_policies", schema=SCHEMA)
    op.drop_column("attendance_records", "leave_breakdown", schema=SCHEMA)
