from __future__ import annotations

import uuid
from datetime import date

from hr_shared import EncryptedString, TenantAwareBase
from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class Department(TenantAwareBase):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    cost_center: Mapped[str | None] = mapped_column(String(100))
    # V2: parent department + department head
    parent_department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True
    )
    head_employee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class Location(TenantAwareBase):
    __tablename__ = "locations"

    location_name: Mapped[str] = mapped_column(String(100), nullable=False)
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


class Employee(TenantAwareBase):
    __tablename__ = "employees"
    __table_args__ = (
        UniqueConstraint("tenant_id", "emp_code", name="uq_emp_code"),
    )

    emp_code: Mapped[str] = mapped_column(String(50), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    mobile: Mapped[str | None] = mapped_column(String(20))
    gender: Mapped[str | None] = mapped_column(String(10))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    employment_type: Mapped[str | None] = mapped_column(String(30))  # FULL_TIME|PART_TIME|CONTRACT

    # DPDP Act 2023 s.8(4): PII fields encrypted at rest via Fernet.
    pan_number: Mapped[str | None] = mapped_column(EncryptedString)
    bank_account: Mapped[str | None] = mapped_column(EncryptedString)
    bank_ifsc: Mapped[str | None] = mapped_column(EncryptedString)
    uan_number: Mapped[str | None] = mapped_column(EncryptedString)
    aadhaar_number: Mapped[str | None] = mapped_column(EncryptedString)

    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    joining_date: Mapped[date | None] = mapped_column(Date)
    exit_date: Mapped[date | None] = mapped_column(Date)
    exit_reason: Mapped[str | None] = mapped_column(String(30))

    department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id")
    )
    designation: Mapped[str | None] = mapped_column(String(120))

    # Location tracking
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("locations.id")
    )
    work_location: Mapped[str | None] = mapped_column(String(120))  # denormalised cache
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    branch: Mapped[str | None] = mapped_column(String(100))

    # Client mapping — FK enforced at DB level by client-service schema init
    client_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    # V2: linked user account + reporting manager
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    reporting_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )


class FinancialYear(TenantAwareBase):
    """Master financial year records (FY 2025-26, FY 2026-27, etc.)."""

    __tablename__ = "financial_years"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_fy_tenant_name"),
    )

    name: Mapped[str] = mapped_column(String(20), nullable=False)  # e.g. "FY 2025-26"
    start_date: Mapped[date] = mapped_column(Date, nullable=False)  # April 1
    end_date: Mapped[date] = mapped_column(Date, nullable=False)    # March 31
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WorkflowDefinition(TenantAwareBase):
    """Reusable approval workflow templates (e.g., Leave Approval 3-Step)."""

    __tablename__ = "workflow_definitions"

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # steps: [{order, role, action, label}]
    steps: Mapped[dict] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    instances: Mapped[list["WorkflowInstance"]] = relationship(
        back_populates="definition", cascade="all, delete-orphan", lazy="selectin"
    )


class WorkflowInstance(TenantAwareBase):
    """One approval chain instance (e.g., Leave Request #42 approval)."""

    __tablename__ = "workflow_instances"

    definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workflow_definitions.id"), nullable=True
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    initiated_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)

    definition: Mapped["WorkflowDefinition | None"] = relationship(back_populates="instances")
    step_actions: Mapped[list["WorkflowStepAction"]] = relationship(
        back_populates="instance", cascade="all, delete-orphan", lazy="selectin"
    )


class WorkflowStepAction(TenantAwareBase):
    """Individual approver action on a workflow step."""

    __tablename__ = "workflow_step_actions"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)  # APPROVE|REJECT|DELEGATE
    comment: Mapped[str | None] = mapped_column(Text)

    instance: Mapped[WorkflowInstance] = relationship(back_populates="step_actions")
