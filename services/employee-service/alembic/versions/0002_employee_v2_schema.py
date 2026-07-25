"""Employee V2: user_id FK, reporting_manager_id self-ref, FinancialYear,
WorkflowDefinition, WorkflowInstance, WorkflowStepAction tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-30
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
    # ── employee: user_id FK + reporting_manager_id ───────────────────────────
    op.add_column(
        "employees",
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "employees",
        sa.Column(
            "reporting_manager_id",
            UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.employees.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema=SCHEMA,
    )
    op.create_index("idx_employees_user_id", "employees", ["user_id"], schema=SCHEMA)
    op.create_index("idx_employees_manager_id", "employees", ["reporting_manager_id"], schema=SCHEMA)

    # ── financial_years table ─────────────────────────────────────────────────
    op.create_table(
        "financial_years",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(20), nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("is_active", sa.Boolean, server_default="TRUE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_fy_tenant_name"),
        schema=SCHEMA,
    )
    op.create_index("idx_fy_tenant", "financial_years", ["tenant_id"], schema=SCHEMA)

    # ── workflow_definitions table ────────────────────────────────────────────
    op.create_table(
        "workflow_definitions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("steps", JSONB, server_default="'[]'"),
        sa.Column("is_active", sa.Boolean, server_default="TRUE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )

    # ── workflow_instances table ──────────────────────────────────────────────
    op.create_table(
        "workflow_instances",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("definition_id", UUID(as_uuid=True), sa.ForeignKey(f"{SCHEMA}.workflow_definitions.id"), nullable=True),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=False),
        sa.Column("current_step", sa.Integer, server_default="0"),
        sa.Column("status", sa.String(20), server_default="'PENDING'"),
        sa.Column("initiated_by", UUID(as_uuid=True), nullable=False),
        sa.Column("payload", JSONB, server_default="'{}'"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )
    op.create_index("idx_workflow_instances_entity", "workflow_instances", ["tenant_id", "entity_type", "entity_id"], schema=SCHEMA)
    op.create_index("idx_workflow_instances_status", "workflow_instances", ["tenant_id", "status"], schema=SCHEMA)

    # ── workflow_step_actions table ───────────────────────────────────────────
    op.create_table(
        "workflow_step_actions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False),
        sa.Column("instance_id", UUID(as_uuid=True), sa.ForeignKey(f"{SCHEMA}.workflow_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_number", sa.Integer, nullable=False),
        sa.Column("actor_id", UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column("acted_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        schema=SCHEMA,
    )

    # ── departments: add head_employee_id + parent_department_id ─────────────
    op.add_column(
        "departments",
        sa.Column("head_employee_id", UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "departments",
        sa.Column("parent_department_id", UUID(as_uuid=True), sa.ForeignKey(f"{SCHEMA}.departments.id", ondelete="SET NULL"), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "departments",
        sa.Column("cost_center", sa.String(50), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    for col in ("cost_center", "parent_department_id", "head_employee_id"):
        op.drop_column("departments", col, schema=SCHEMA)
    op.drop_table("workflow_step_actions", schema=SCHEMA)
    op.drop_table("workflow_instances", schema=SCHEMA)
    op.drop_table("workflow_definitions", schema=SCHEMA)
    op.drop_table("financial_years", schema=SCHEMA)
    op.drop_index("idx_employees_manager_id", "employees", schema=SCHEMA)
    op.drop_index("idx_employees_user_id", "employees", schema=SCHEMA)
    op.drop_column("employees", "reporting_manager_id", schema=SCHEMA)
    op.drop_column("employees", "user_id", schema=SCHEMA)
