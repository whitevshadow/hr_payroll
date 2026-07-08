from __future__ import annotations

import uuid

from pydantic import BaseModel


class GenerateRequest(BaseModel):
    cycle_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    employee_ids: list[uuid.UUID] = []
    report_type: str = "PAYSLIP"
    financial_year: str | None = None
