from __future__ import annotations

import uuid

from hr_shared import TenantAwareBase
from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column


class GeneratedReport(TenantAwareBase):
    __tablename__ = "generated_reports"

    cycle_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    employee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    report_type: Mapped[str] = mapped_column(String(30), default="PAYSLIP")
    status: Mapped[str] = mapped_column(String(20), default="QUEUED")
    file_path: Mapped[str | None] = mapped_column(Text)
    blob_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    report_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
