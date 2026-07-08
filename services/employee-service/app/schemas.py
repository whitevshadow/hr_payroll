from __future__ import annotations

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, field_validator


# ── Department Schemas ────────────────────────────────────────────────────────

class DepartmentCreate(BaseModel):
    name: str
    cost_center: str | None = None
    parent_department_id: uuid.UUID | None = None
    head_employee_id: uuid.UUID | None = None


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    cost_center: str | None = None
    parent_department_id: uuid.UUID | None = None
    head_employee_id: uuid.UUID | None = None


# ── Location Schemas ──────────────────────────────────────────────────────────

class LocationCreate(BaseModel):
    location_code: str | None = None
    location_name: str
    city: str
    state: str
    country: str = "India"
    pincode: str | None = None


class LocationUpdate(BaseModel):
    location_code: str | None = None
    location_name: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    pincode: str | None = None
    is_active: bool | None = None


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    location_code: str | None = None
    location_name: str
    city: str
    state: str
    country: str
    pincode: str | None = None
    is_active: bool = True


# ── Employee Schemas ──────────────────────────────────────────────────────────

def _normalize_email(v: str | None) -> str | None:
    return v.strip().lower() if v else v


class EmployeeBase(BaseModel):
    emp_code: str
    first_name: str
    last_name: str
    email: str | None = None
    mobile: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    employment_type: str | None = None
    pan_number: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    uan_number: str | None = None
    aadhaar_number: str | None = None
    status: str = "ACTIVE"
    joining_date: date | None = None
    exit_date: date | None = None
    exit_reason: str | None = None
    department_id: uuid.UUID | None = None
    designation: str | None = None
    location_id: uuid.UUID | None = None
    work_location: str | None = None
    city: str | None = None
    state: str | None = None
    branch: str | None = None
    client_id: uuid.UUID | None = None
    # V2 additions
    user_id: uuid.UUID | None = None
    reporting_manager_id: uuid.UUID | None = None

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
    mobile: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    employment_type: str | None = None
    pan_number: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    uan_number: str | None = None
    aadhaar_number: str | None = None
    status: str | None = None
    joining_date: date | None = None
    exit_date: date | None = None
    exit_reason: str | None = None
    department_id: uuid.UUID | None = None
    designation: str | None = None
    location_id: uuid.UUID | None = None
    work_location: str | None = None
    city: str | None = None
    state: str | None = None
    branch: str | None = None
    client_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    reporting_manager_id: uuid.UUID | None = None

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
    client_name: str | None = None        # looked up to client_id
    department: str | None = None
    designation: str | None = None
    work_location: str | None = None
    joining_date: date | None = None
    employment_type: str | None = None
    salary_structure: str | None = None   # template name
    basic_salary: float | None = None
    # PII
    pan_number: str | None = None
    uan_number: str | None = None
    bank_account: str | None = None
    bank_ifsc: str | None = None
    aadhaar_number: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    state: str | None = None
    city: str | None = None
    branch: str | None = None


class BulkImportRequest(BaseModel):
    rows: list[BulkImportRow]


class RowResult(BaseModel):
    row_index: int
    emp_code: str
    name: str
    status: str               # "created" | "duplicate" | "error"
    error: str | None = None
    employee_id: str | None = None
    work_location: str | None = None


class BulkImportResult(BaseModel):
    total: int
    created: int
    duplicates: int
    errors: int
    rows: list[RowResult]


# ── Financial Year Schemas ────────────────────────────────────────────────────

class FinancialYearCreate(BaseModel):
    name: str                  # e.g. "FY 2025-26"
    start_date: date           # April 1
    end_date: date             # March 31
    is_active: bool = True


class FinancialYearOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    is_active: bool


# ── Workflow Schemas ──────────────────────────────────────────────────────────

class WorkflowStep(BaseModel):
    order: int
    role: str
    label: str


class WorkflowDefinitionCreate(BaseModel):
    name: str
    entity_type: str
    steps: list[WorkflowStep]


class WorkflowDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    entity_type: str
    steps: list[dict]
    is_active: bool


class WorkflowInstanceCreate(BaseModel):
    definition_id: uuid.UUID | None = None
    entity_type: str
    entity_id: uuid.UUID
    payload: dict = {}


class WorkflowActionIn(BaseModel):
    action: str   # APPROVE | REJECT | DELEGATE
    comment: str | None = None


class WorkflowInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    current_step: int
    status: str
    initiated_by: uuid.UUID
    payload: dict
