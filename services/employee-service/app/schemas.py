from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, field_validator


class DepartmentCreate(BaseModel):
    name: str
    cost_center: str | None = None


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    cost_center: str | None = None


class LocationCreate(BaseModel):
    location_name: str
    city: str
    state: str
    country: str = "India"


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    location_name: str
    city: str
    state: str
    country: str


def _normalize_email(v: str | None) -> str | None:
    """Lowercase and strip whitespace so DB lookups are case-insensitive by convention."""
    return v.strip().lower() if v else v


class EmployeeBase(BaseModel):
    emp_code: str
    first_name: str
    last_name: str
    email: str | None = None
    pan_number: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    uan_number: str | None = None
    status: str = "ACTIVE"
    joining_date: date | None = None
    department_id: uuid.UUID | None = None
    designation: str | None = None
    location_id: uuid.UUID | None = None
    work_location: str | None = None
    city: str | None = None
    state: str | None = None
    branch: str | None = None
    client_id: uuid.UUID | None = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str | None) -> str | None:
        return _normalize_email(v)

    @field_validator("pan_number", mode="before")
    @classmethod
    def normalize_pan(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v

    @field_validator("bank_ifsc", mode="before")
    @classmethod
    def normalize_ifsc(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    pan_number: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    uan_number: str | None = None
    status: str | None = None
    joining_date: date | None = None
    department_id: uuid.UUID | None = None
    designation: str | None = None
    location_id: uuid.UUID | None = None
    work_location: str | None = None
    city: str | None = None
    state: str | None = None
    branch: str | None = None
    client_id: uuid.UUID | None = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: str | None) -> str | None:
        return _normalize_email(v)

    @field_validator("pan_number", mode="before")
    @classmethod
    def normalize_pan(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v

    @field_validator("bank_ifsc", mode="before")
    @classmethod
    def normalize_ifsc(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


class EmployeeOut(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


class EmployeePage(BaseModel):
    items: list[EmployeeOut]
    total: int
    page: int
    page_size: int


# ── Bulk Import ──────────────────────────────────────────────────────────────

class BulkImportRow(BaseModel):
    """One row from the Excel/CSV template."""
    emp_code: str
    first_name: str
    last_name: str
    email: str | None = None
    mobile: str | None = None
    department: str | None = None
    designation: str | None = None
    work_location: str | None = None
    joining_date: date | None = None
    employment_type: str | None = None
    # Financials (used by frontend to call salary-service)
    basic_salary: float | None = None
    # Optional PII
    pan_number: str | None = None
    uan_number: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    state: str | None = None
    city: str | None = None
    branch: str | None = None


class BulkImportRequest(BaseModel):
    rows: list[BulkImportRow]


class RowResult(BaseModel):
    row_index: int         # 0-based row number in uploaded file
    emp_code: str
    name: str
    status: str            # "created" | "duplicate" | "error"
    error: str | None = None
    employee_id: str | None = None   # UUID of created employee (for salary creation)
    work_location: str | None = None


class BulkImportResult(BaseModel):
    total: int
    created: int
    duplicates: int
    errors: int
    rows: list[RowResult]
