from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from hr_shared import RequestContext, audit_log
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session, runtime
from .models import Department, Employee, Location
from .schemas import (
    BulkImportRequest,
    BulkImportResult,
    DepartmentCreate,
    DepartmentOut,
    EmployeeCreate,
    EmployeeOut,
    EmployeePage,
    EmployeeUpdate,
    LocationCreate,
    LocationOut,
    RowResult,
)

router = APIRouter(prefix="/api/v1", tags=["employees"])

# Role guards
_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


# ---- Locations ---------------------------------------------------------

@router.get("/locations", response_model=list[LocationOut])
async def list_locations(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(
        select(Location).where(Location.tenant_id == ctx.tenant_id)
    )
    return list(rows)


@router.post("/locations", response_model=LocationOut, status_code=201)
async def create_location(
    body: LocationCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    loc = Location(tenant_id=ctx.tenant_id, **body.model_dump())
    session.add(loc)
    await session.commit()
    await session.refresh(loc)
    return loc


# ---- Departments -------------------------------------------------------

@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(
        select(Department).where(Department.tenant_id == ctx.tenant_id)
    )
    return list(rows)


@router.post("/departments", response_model=DepartmentOut, status_code=201)
async def create_department(
    body: DepartmentCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    dept = Department(tenant_id=ctx.tenant_id, **body.model_dump())
    session.add(dept)
    await session.commit()
    await session.refresh(dept)
    return dept


@router.put("/departments/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: uuid.UUID,
    body: DepartmentCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    dept = await session.get(Department, department_id)
    if not dept or dept.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Department not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(dept, k, v)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="DEPARTMENT_UPDATED",
                    entity_type="department", entity_id=str(department_id),
                    payload=body.model_dump(), actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(dept)
    return dept


# ---- Employees ---------------------------------------------------------

@router.post("/employees/bulk-import", response_model=BulkImportResult, status_code=200)
async def bulk_import_employees(
    body: BulkImportRequest,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Batch-create up to 5000 employees in a single request.

    Algorithm:
    1. Load all existing emp_codes + emails for this tenant (one DB round-trip).
    2. Validate each row client-side rules (format, uniqueness within the upload batch).
    3. Auto-create departments that don't already exist.
    4. Insert valid rows in chunks of 100 so the DB transaction stays small.
    5. Return per-row results so the caller can show a detailed report.
    """
    import re
    from decimal import Decimal

    EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    PAN_RE   = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
    IFSC_RE  = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")

    # ── 1. Pre-load existing codes + emails (single query) ───────────────────
    existing_rows = await session.execute(
        select(Employee.emp_code, Employee.email).where(
            Employee.tenant_id == ctx.tenant_id
        )
    )
    existing_codes: set[str] = set()
    existing_emails: set[str] = set()
    for code, email in existing_rows:
        existing_codes.add(code.lower())
        if email:
            existing_emails.add(email.lower())

    # ── 2. Pre-load departments (auto-create missing ones after loop) ─────────
    dept_rows = await session.scalars(
        select(Department).where(Department.tenant_id == ctx.tenant_id)
    )
    dept_map: dict[str, uuid.UUID] = {d.name.lower(): d.id for d in dept_rows}

    # ── 3. Per-row validation pass ───────────────────────────────────────────
    results: list[RowResult] = []
    seen_codes: set[str] = set()    # within this upload batch
    seen_emails: set[str] = set()   # within this upload batch
    pending_emps: list[dict] = []   # rows that passed validation

    def _err(idx: int, row, msg: str) -> RowResult:
        return RowResult(
            row_index=idx,
            emp_code=row.emp_code or f"row-{idx+1}",
            name=f"{row.first_name} {row.last_name}".strip(),
            status="error",
            error=msg,
        )

    for idx, row in enumerate(body.rows):
        code = (row.emp_code or "").strip()
        fname = (row.first_name or "").strip()
        lname = (row.last_name or "").strip()
        email = (row.email or "").strip().lower() or None

        # Required field checks
        if not code:
            results.append(_err(idx, row, "Employee Code is required"))
            continue
        if not fname:
            results.append(_err(idx, row, "First Name is required"))
            continue
        if not lname:
            results.append(_err(idx, row, "Last Name is required"))
            continue

        # Email format
        if email and not EMAIL_RE.match(email):
            results.append(_err(idx, row, f"Invalid email: {email}"))
            continue

        # Mobile (10 digits)
        if row.mobile:
            mobile_clean = re.sub(r"[^0-9]", "", str(row.mobile))
            if len(mobile_clean) != 10:
                results.append(_err(idx, row, "Mobile must be 10 digits"))
                continue

        # PAN format
        if row.pan_number:
            pan = row.pan_number.strip().upper()
            if not PAN_RE.match(pan):
                results.append(_err(idx, row, f"Invalid PAN format: {pan}"))
                continue
            row = row.model_copy(update={"pan_number": pan})

        # IFSC format
        if row.bank_ifsc:
            ifsc = row.bank_ifsc.strip().upper()
            if not IFSC_RE.match(ifsc):
                results.append(_err(idx, row, f"Invalid IFSC format: {ifsc}"))
                continue
            row = row.model_copy(update={"bank_ifsc": ifsc})

        # Salary positivity
        if row.basic_salary is not None and row.basic_salary <= 0:
            results.append(_err(idx, row, "Basic Salary must be positive"))
            continue

        # Duplicate emp_code — within DB
        if code.lower() in existing_codes:
            results.append(RowResult(
                row_index=idx, emp_code=code, name=f"{fname} {lname}",
                status="duplicate", error="Employee Code already exists in system",
            ))
            continue
        # Duplicate within this batch
        if code.lower() in seen_codes:
            results.append(RowResult(
                row_index=idx, emp_code=code, name=f"{fname} {lname}",
                status="duplicate", error="Duplicate Employee Code in upload file",
            ))
            continue

        # Duplicate email — within DB
        if email and email in existing_emails:
            results.append(RowResult(
                row_index=idx, emp_code=code, name=f"{fname} {lname}",
                status="duplicate", error="Email already exists in system",
            ))
            continue
        if email and email in seen_emails:
            results.append(RowResult(
                row_index=idx, emp_code=code, name=f"{fname} {lname}",
                status="duplicate", error="Duplicate email in upload file",
            ))
            continue

        seen_codes.add(code.lower())
        if email:
            seen_emails.add(email)

        pending_emps.append({"idx": idx, "row": row, "code": code, "fname": fname, "lname": lname, "email": email})

    # ── 4. Auto-create missing departments ───────────────────────────────────
    needed_depts: set[str] = set()
    for p in pending_emps:
        dept_name = (p["row"].department or "").strip()
        if dept_name and dept_name.lower() not in dept_map:
            needed_depts.add(dept_name)

    for dept_name in needed_depts:
        new_dept = Department(tenant_id=ctx.tenant_id, name=dept_name)
        session.add(new_dept)
        await session.flush()
        dept_map[dept_name.lower()] = new_dept.id

    # ── 5. Batch insert valid employees (chunks of 100) ───────────────────────
    CHUNK = 100
    for chunk_start in range(0, len(pending_emps), CHUNK):
        chunk = pending_emps[chunk_start: chunk_start + CHUNK]
        for p in chunk:
            row = p["row"]
            dept_id = dept_map.get((row.department or "").strip().lower())
            emp = Employee(
                tenant_id=ctx.tenant_id,
                emp_code=p["code"],
                first_name=p["fname"],
                last_name=p["lname"],
                email=p["email"],
                pan_number=row.pan_number,
                bank_account=row.bank_account,
                bank_ifsc=row.bank_ifsc,
                uan_number=row.uan_number,
                designation=row.designation,
                department_id=dept_id,
                work_location=row.work_location,
                city=row.city,
                state=row.state,
                branch=row.branch,
                joining_date=row.joining_date,
                status="ACTIVE",
            )
            session.add(emp)
            await session.flush()  # get emp.id before commit
            results.append(RowResult(
                row_index=p["idx"],
                emp_code=p["code"],
                name=f"{p['fname']} {p['lname']}",
                status="created",
                employee_id=str(emp.id),
                work_location=row.work_location,
            ))
        await session.commit()

    # ── 6. Audit log ─────────────────────────────────────────────────────────
    created_count = sum(1 for r in results if r.status == "created")
    dup_count     = sum(1 for r in results if r.status == "duplicate")
    err_count     = sum(1 for r in results if r.status == "error")
    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="BULK_EMPLOYEE_IMPORT",
        entity_type="employee",
        entity_id="bulk",
        payload={"total": len(body.rows), "created": created_count, "duplicates": dup_count, "errors": err_count},
        actor_id=ctx.user_id,
    )
    await session.commit()

    return BulkImportResult(
        total=len(body.rows),
        created=created_count,
        duplicates=dup_count,
        errors=err_count,
        rows=sorted(results, key=lambda r: r.row_index),
    )


@router.post("/employees", response_model=EmployeeOut, status_code=201)
async def create_employee(
    body: EmployeeCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    dup = await session.scalar(
        select(Employee).where(
            Employee.tenant_id == ctx.tenant_id,
            Employee.emp_code == body.emp_code,
        )
    )
    if dup:
        raise HTTPException(status_code=409, detail="emp_code already exists")
    
    dump = body.model_dump()
    if dump.get("location_id"):
        loc = await session.get(Location, dump["location_id"])
        if loc and loc.tenant_id == ctx.tenant_id:
            dump["city"] = loc.city
            dump["state"] = loc.state
            dump["work_location"] = loc.location_name
    
    emp = Employee(tenant_id=ctx.tenant_id, **dump)
    session.add(emp)
    await session.commit()
    await session.refresh(emp)
    return emp


@router.get("/employees", response_model=EmployeePage)
async def list_employees(
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str | None = None,
    status: str | None = None,
    client_id: uuid.UUID | None = None,
):
    base = select(Employee).where(Employee.tenant_id == ctx.tenant_id)
    if search:
        like = f"%{search}%"
        base = base.where(
            or_(
                Employee.first_name.ilike(like),
                Employee.last_name.ilike(like),
                Employee.emp_code.ilike(like),
                Employee.email.ilike(like),
            )
        )
    if status:
        base = base.where(Employee.status == status)
    if client_id:
        base = base.where(Employee.client_id == client_id)

    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    rows = await session.scalars(
        base.order_by(Employee.emp_code).offset((page - 1) * page_size).limit(page_size)
    )
    return EmployeePage(items=list(rows), total=total or 0, page=page, page_size=page_size)


_PRIVILEGED = ("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


async def _resolve_my_employee(ctx: RequestContext, session: AsyncSession) -> Employee | None:
    """Find the employee record linked to the caller (matched by email, case-insensitive).

    New employees written through EmployeeCreate/EmployeeUpdate are already
    normalised to lowercase by the schema validators, so LOWER() on the stored
    value is only needed as a safety net for any legacy rows created before that
    normalisation was added.
    """
    if not ctx.email:
        return None
    return await session.scalar(
        select(Employee).where(
            Employee.tenant_id == ctx.tenant_id,
            Employee.email.isnot(None),
            func.lower(Employee.email) == ctx.email.lower(),
        )
    )


@router.get("/employees/me", response_model=EmployeeOut)
async def get_my_employee(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Resolve the authenticated user to their employee record (by email)."""
    emp = await _resolve_my_employee(ctx, session)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee record not found for this user")
    return emp


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    # EMPLOYEE-only role may read only their own record.
    if not any(r in ctx.roles for r in _PRIVILEGED):
        mine = await _resolve_my_employee(ctx, session)
        if not mine or mine.id != employee_id:
            raise HTTPException(status_code=403, detail="Access denied")
    return emp


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: uuid.UUID,
    body: EmployeeUpdate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
        
    dump = body.model_dump(exclude_unset=True)
    if "location_id" in dump and dump["location_id"]:
        loc = await session.get(Location, dump["location_id"])
        if loc and loc.tenant_id == ctx.tenant_id:
            dump["city"] = loc.city
            dump["state"] = loc.state
            dump["work_location"] = loc.location_name
            
    for k, v in dump.items():
        setattr(emp, k, v)
    await session.commit()
    await session.refresh(emp)
    return emp


class PIIAccessRequest(BaseModel):
    fields: list[str]


@router.post("/employees/{employee_id}/pii-access", status_code=204)
async def pii_access(
    employee_id: uuid.UUID,
    body: PIIAccessRequest,
    request: Request,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Record a PII access event for audit purposes."""
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="PII_ACCESSED",
        entity_type="employee",
        entity_id=str(employee_id),
        payload={"fields": body.fields, "ip": request.client.host if request.client else "unknown"},
        actor_id=ctx.user_id,
    )
    await session.commit()
