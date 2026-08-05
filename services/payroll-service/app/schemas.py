from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator


class CycleCreate(BaseModel):
    name: str
    client_id: uuid.UUID | None = None
    financial_year: str | None = None
    period_start: date
    period_end: date
    is_dry_run: bool = False


class CycleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    client_id: uuid.UUID | None = None
    financial_year: str | None = None
    period_start: date
    period_end: date
    status: str
    is_dry_run: bool
    created_by: uuid.UUID | None
    approved_by: uuid.UUID | None
    trace_id: uuid.UUID | None


class ResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    cycle_id: uuid.UUID
    employee_id: uuid.UUID
    gross_earnings: Decimal
    total_deductions: Decimal
    net_pay: Decimal
    breakdown_json: dict
    status: str
    error: str | None = None


class RunSummary(BaseModel):
    cycle_id: uuid.UUID
    status: str
    total_employees: int
    computed: int
    failed: int
    errors: list[str]


class CycleSummary(BaseModel):
    cycle: CycleOut
    results: list[ResultOut]
    totals: dict


class ImportRegisterRow(BaseModel):
    """One row of an imported payroll register (Excel).

    In "prefilled" mode every figure comes from the sheet, so
    total_deductions and net_pay are required. In "compute" mode only the
    earnings/attendance side is taken from the sheet; PF/ESI/PT and net
    pay are computed server-side and the deduction fields here are ignored.
    """

    employee_id: uuid.UUID
    present_days: Decimal | None = None
    holiday_days: Decimal | None = None
    wo_days: Decimal | None = None
    total_days: int
    basic: Decimal
    da: Decimal = Decimal("0")
    hra: Decimal = Decimal("0")
    bonus: Decimal = Decimal("0")
    gross: Decimal
    employee_esi: Decimal = Decimal("0")
    employee_pf: Decimal = Decimal("0")
    pt: Decimal = Decimal("0")
    total_deductions: Decimal | None = None
    net_pay: Decimal | None = None


class ImportRegisterRequest(BaseModel):
    mode: Literal["prefilled", "compute"] = "prefilled"
    rows: list[ImportRegisterRow]

    @model_validator(mode="after")
    def _prefilled_rows_are_complete(self) -> "ImportRegisterRequest":
        if self.mode == "prefilled":
            for i, row in enumerate(self.rows):
                if row.total_deductions is None or row.net_pay is None:
                    raise ValueError(
                        f"rows[{i}]: total_deductions and net_pay are required in prefilled mode"
                    )
        return self
