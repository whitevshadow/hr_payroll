from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from hr_shared import RequestContext, audit_log, mask_pan, mask_bank_account, mask_aadhaar, mask_uan
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_client_context, get_session, runtime
from .models import (
    Department,
    Employee,
    FinancialYear,
    Location,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStepAction,
)
from .schemas import (
    BulkImportRequest,
    BulkImportResult,
    DepartmentCreate,
    DepartmentOut,
    EmployeeCreate,
    EmployeeOut,
    EmployeePage,
    EmployeeUpdate,
    FinancialYearCreate,
    FinancialYearOut,
    LocationCreate,
    LocationOut,
    LocationUpdate,
    RowResult,
    WorkflowActionIn,
    WorkflowDefinitionCreate,
    WorkflowDefinitionOut,
    WorkflowInstanceCreate,
    WorkflowInstanceOut,
)

router = APIRouter(prefix="/api/v1", tags=["employees"])

# Role guards
_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN", get_ctx=get_client_context)
_PRIVILEGED = ("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")

# PII fields returned masked in list/detail responses; the raw value is only
# obtainable through the audited pii-access endpoint. (bank_ifsc is a public
# branch code, not treated as sensitive PII.)
_PII_MASKERS = {
    "pan_number": mask_pan,
    "bank_account": mask_bank_account,
    "aadhaar_number": mask_aadhaar,
    "uan_number": mask_uan,
}


def _masked_employee(emp) -> EmployeeOut:
    """Serialise an Employee with its sensitive PII fields masked."""
    data = EmployeeOut.model_validate(emp).model_dump()
    for field, masker in _PII_MASKERS.items():
        if data.get(field):
            data[field] = masker(data[field])
    return EmployeeOut.model_validate(data)


# ── Locations ─────────────────────────────────────────────────────────────────

@router.get("/locations", response_model=list[LocationOut])
async def list_locations(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
    active_only: bool = Query(True),
):
    q = select(Location).where(Location.tenant_id == ctx.tenant_id, Location.client_id == ctx.client_id)
    if active_only:
        q = q.where(Location.is_active.is_(True))
    rows = await session.scalars(q.order_by(Location.location_name))
    return list(rows)


@router.post("/locations", response_model=LocationOut, status_code=201)
async def create_location(
    body: LocationCreate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    if not body.location_code:
        import uuid
        body.location_code = f"LOC-{uuid.uuid4().hex[:6].upper()}"
    loc = Location(tenant_id=ctx.tenant_id, client_id=ctx.client_id, **body.model_dump())
    session.add(loc)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="LOCATION_CREATED",
                    entity_type="location", entity_id="new",
                    payload=body.model_dump(), actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(loc)
    return loc


@router.put("/locations/{location_id}", response_model=LocationOut)
async def update_location(
    location_id: uuid.UUID,
    body: LocationUpdate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    loc = await session.get(Location, location_id)
    if not loc or loc.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Location not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(loc, k, v)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="LOCATION_UPDATED",
                    entity_type="location", entity_id=str(location_id),
                    payload=body.model_dump(exclude_unset=True), actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(loc)
    return loc


# ── Departments ───────────────────────────────────────────────────────────────

@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(
        select(Department).where(Department.tenant_id == ctx.tenant_id, Department.client_id == ctx.client_id).order_by(Department.name)
    )
    return list(rows)


@router.post("/departments", response_model=DepartmentOut, status_code=201)
async def create_department(
    body: DepartmentCreate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    dept = Department(tenant_id=ctx.tenant_id, client_id=ctx.client_id, **body.model_dump())
    session.add(dept)
    await session.commit()
    await session.refresh(dept)
    return dept


@router.put("/departments/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: uuid.UUID,
    body: DepartmentCreate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
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


# ── Employees ─────────────────────────────────────────────────────────────────

@router.post("/employees/bulk-import", response_model=BulkImportResult, status_code=200)
async def bulk_import_employees(
    body: BulkImportRequest,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    """Batch-create up to 5000 employees in a single request.

    Algorithm:
    1. Load all existing emp_codes + emails for this tenant (one DB round-trip).
    2. Validate each row (format, uniqueness, client/dept/location lookup).
    3. Auto-create departments that don't already exist.
    4. Insert valid rows in chunks of 100.
    5. Return per-row results for detailed import report.
    """
    import re

    EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    PAN_RE   = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
    IFSC_RE  = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
    AADHAAR_RE = re.compile(r"^\d{12}$")

    existing_rows = await session.execute(
        select(
            Employee.emp_code,
            Employee.email,
            Employee.id,
            Employee.mobile,
            Employee.aadhaar_number,
            Employee.first_name,
            Employee.last_name,
        ).where(Employee.tenant_id == ctx.tenant_id, Employee.client_id == ctx.client_id)
    )
    existing_codes: dict[str, str] = {}
    existing_emails: dict[str, str] = {}
    existing_aadhaars: dict[str, str] = {}
    existing_mobile_names: dict[tuple[str, str, str], str] = {}
    for code, email, emp_id, mobile, aadhaar, first_name, last_name in existing_rows:
        existing_codes[code.lower()] = str(emp_id)
        if email:
            existing_emails[email.lower()] = str(emp_id)
        if aadhaar:
            existing_aadhaars[str(aadhaar).replace(" ", "").replace("-", "")] = str(emp_id)
        mobile_clean = re.sub(r"[^0-9]", "", str(mobile or ""))
        if mobile_clean:
            existing_mobile_names.setdefault(
                (
                    mobile_clean,
                    (first_name or "").strip().lower(),
                    (last_name or "").strip().lower(),
                ),
                str(emp_id),
            )

    # 2. Pre-load departments
    dept_rows = await session.scalars(select(Department).where(Department.tenant_id == ctx.tenant_id, Department.client_id == ctx.client_id))
    dept_map: dict[str, uuid.UUID] = {d.name.lower(): d.id for d in dept_rows}

    # 3. Pre-load locations
    loc_rows = await session.scalars(select(Location).where(Location.tenant_id == ctx.tenant_id, Location.client_id == ctx.client_id))
    loc_map: dict[str, Location] = {l.location_name.lower(): l for l in loc_rows}

    # 4. Per-row validation
    results: list[RowResult] = []
    seen_codes: set[str] = set()
    seen_emails: set[str] = set()
    pending_emps: list[dict] = []

    def _err(idx: int, row, msg: str) -> RowResult:
        return RowResult(
            row_index=idx, emp_code=row.emp_code or f"row-{idx+1}",
            name=f"{row.first_name} {row.last_name}".strip(),
            status="error", error=msg,
        )

    for idx, row in enumerate(body.rows):
        code  = (row.emp_code or "").strip()
        if not code:
            code = f"EMP-{uuid.uuid4().hex[:6].upper()}"
            row.emp_code = code

        fname = (row.first_name or "").strip()
        lname = (row.last_name or "").strip()
        email = (row.email or "").strip().lower() or None
        if not fname:
            results.append(_err(idx, row, "First Name is required")); continue
        if not lname:
            results.append(_err(idx, row, "Last Name is required")); continue
        if email and not EMAIL_RE.match(email):
            results.append(_err(idx, row, f"Invalid email: {email}")); continue
        if row.mobile:
            mobile_clean = re.sub(r"[^0-9]", "", str(row.mobile))
            if len(mobile_clean) != 10:
                results.append(_err(idx, row, "Mobile must be 10 digits")); continue
        if row.pan_number:
            pan = row.pan_number.strip().upper()
            if not PAN_RE.match(pan):
                results.append(_err(idx, row, f"Invalid PAN format: {pan}")); continue
            row = row.model_copy(update={"pan_number": pan})
        if row.bank_ifsc:
            ifsc = row.bank_ifsc.strip().upper()
            if not IFSC_RE.match(ifsc):
                results.append(_err(idx, row, f"Invalid IFSC format: {ifsc}")); continue
            row = row.model_copy(update={"bank_ifsc": ifsc})
        if not row.aadhaar_number:
            results.append(_err(idx, row, "Aadhaar Number is required")); continue
        aadhaar_clean = row.aadhaar_number.replace(" ", "").replace("-", "")
        if not AADHAAR_RE.match(aadhaar_clean):
            results.append(_err(idx, row, "Aadhaar must be 12 digits")); continue
        row = row.model_copy(update={"aadhaar_number": aadhaar_clean})
        if row.basic_salary is not None and row.basic_salary <= 0:
            results.append(_err(idx, row, "Basic Salary must be positive")); continue
        if code and code.lower() in existing_codes:
            emp_id = existing_codes[code.lower()]
            results.append(RowResult(row_index=idx, emp_code=code, name=f"{fname} {lname}",
                                     status="duplicate", error="Employee Code already exists", employee_id=emp_id)); continue
        if aadhaar_clean in existing_aadhaars:
            emp_id = existing_aadhaars[aadhaar_clean]
            results.append(RowResult(row_index=idx, emp_code=code, name=f"{fname} {lname}",
                                     status="duplicate", error="Aadhaar already exists", employee_id=emp_id)); continue
        mobile_key = (
            re.sub(r"[^0-9]", "", str(row.mobile or "")),
            fname.lower(),
            lname.lower(),
        )
        if mobile_key in existing_mobile_names:
            emp_id = existing_mobile_names[mobile_key]
            results.append(RowResult(row_index=idx, emp_code=code, name=f"{fname} {lname}",
                                     status="duplicate", error="Mobile and name already exist", employee_id=emp_id)); continue
        if code.lower() in seen_codes:
            results.append(RowResult(row_index=idx, emp_code=code, name=f"{fname} {lname}",
                                     status="duplicate", error="Duplicate Employee Code in file")); continue
        if email and email in existing_emails:
            emp_id = existing_emails[email]
            results.append(RowResult(row_index=idx, emp_code=code, name=f"{fname} {lname}",
                                     status="duplicate", error="Email already exists", employee_id=emp_id)); continue
        if email and email in seen_emails:
            results.append(RowResult(row_index=idx, emp_code=code, name=f"{fname} {lname}",
                                     status="duplicate", error="Duplicate email in file")); continue

        seen_codes.add(code.lower())
        if email:
            seen_emails.add(email)
        pending_emps.append({"idx": idx, "row": row, "code": code, "fname": fname, "lname": lname, "email": email})

    # 5. Auto-create missing departments
    needed_depts: set[str] = set()
    for p in pending_emps:
        dept_name = (p["row"].department or "").strip()
        if dept_name and dept_name.lower() not in dept_map:
            needed_depts.add(dept_name)
    for dept_name in needed_depts:
        new_dept = Department(tenant_id=ctx.tenant_id, client_id=ctx.client_id, name=dept_name)
        session.add(new_dept)
        await session.flush()
        dept_map[dept_name.lower()] = new_dept.id

    # 6. Batch insert (chunks of 100)
    CHUNK = 100
    for chunk_start in range(0, len(pending_emps), CHUNK):
        chunk = pending_emps[chunk_start: chunk_start + CHUNK]
        for p in chunk:
            row = p["row"]
            dept_id = dept_map.get((row.department or "").strip().lower())
            # Resolve location
            loc_key = (row.work_location or "").strip().lower()
            matched_loc = loc_map.get(loc_key)
            emp = Employee(
                tenant_id=ctx.tenant_id,
                client_id=ctx.client_id,
                emp_code=p["code"],
                first_name=p["fname"],
                last_name=p["lname"],
                email=p["email"],
                mobile=row.mobile,
                gender=row.gender,
                date_of_birth=row.date_of_birth,
                employment_type=row.employment_type,
                pan_number=row.pan_number,
                bank_account=row.bank_account,
                bank_ifsc=row.bank_ifsc,
                uan_number=row.uan_number,
                aadhaar_number=row.aadhaar_number,
                designation=row.designation,
                department_id=dept_id,
                location_id=matched_loc.id if matched_loc else None,
                work_location=matched_loc.location_name if matched_loc else row.work_location,
                city=matched_loc.city if matched_loc else row.city,
                state=matched_loc.state if matched_loc else row.state,
                branch=row.branch,
                joining_date=row.joining_date,
                status="ACTIVE",
            )
            session.add(emp)
            await session.flush()
            results.append(RowResult(
                row_index=p["idx"], emp_code=p["code"],
                name=f"{p['fname']} {p['lname']}", status="created",
                employee_id=str(emp.id), work_location=emp.work_location,
            ))
        await session.commit()

    # 7. Audit log
    created_count = sum(1 for r in results if r.status == "created")
    dup_count     = sum(1 for r in results if r.status == "duplicate")
    err_count     = sum(1 for r in results if r.status == "error")
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="BULK_EMPLOYEE_IMPORT",
                    entity_type="employee", entity_id="bulk",
                    payload={"total": len(body.rows), "created": created_count,
                             "duplicates": dup_count, "errors": err_count},
                    actor_id=ctx.user_id)
    await session.commit()
    return BulkImportResult(total=len(body.rows), created=created_count,
                            duplicates=dup_count, errors=err_count,
                            rows=sorted(results, key=lambda r: r.row_index))


@router.post("/employees", response_model=EmployeeOut, status_code=201)
async def create_employee(
    body: EmployeeCreate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    if not body.emp_code:
        import uuid
        body.emp_code = f"EMP-{uuid.uuid4().hex[:6].upper()}"

    dup = await session.scalar(
        select(Employee).where(Employee.tenant_id == ctx.tenant_id, Employee.client_id == ctx.client_id, Employee.emp_code == body.emp_code)
    )
    if dup:
        raise HTTPException(status_code=409, detail="emp_code already exists")
    dump = body.model_dump(exclude={"client_id"})
    # Denormalise location fields from FK
    if dump.get("location_id"):
        loc = await session.get(Location, dump["location_id"])
        if loc and loc.tenant_id == ctx.tenant_id:
            dump.update(city=loc.city, state=loc.state, work_location=loc.location_name)
    emp = Employee(tenant_id=ctx.tenant_id, client_id=ctx.client_id, **dump)
    session.add(emp)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="EMPLOYEE_CREATED",
                    entity_type="employee", entity_id=body.emp_code,
                    payload={"emp_code": body.emp_code, "name": f"{body.first_name} {body.last_name}"},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(emp)
    return emp


@router.get("/employees", response_model=EmployeePage)
async def list_employees(
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    search: str | None = None,
    status: str | None = None,
    client_id: uuid.UUID | None = None,
    department_id: uuid.UUID | None = None,
    location_id: uuid.UUID | None = None,
):
    base = select(Employee).where(Employee.tenant_id == ctx.tenant_id, Employee.client_id == ctx.client_id)
    if search:
        like = f"%{search}%"
        base = base.where(or_(
            Employee.first_name.ilike(like), Employee.last_name.ilike(like),
            Employee.emp_code.ilike(like), Employee.email.ilike(like),
        ))
    if status:
        base = base.where(Employee.status == status)
    if client_id:
        base = base.where(Employee.client_id == client_id)
    if department_id:
        base = base.where(Employee.department_id == department_id)
    if location_id:
        base = base.where(Employee.location_id == location_id)
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    rows  = await session.scalars(
        base.order_by(Employee.emp_code).offset((page - 1) * page_size).limit(page_size)
    )
    return EmployeePage(
        items=[_masked_employee(e) for e in rows],
        total=total or 0, page=page, page_size=page_size,
    )


async def _resolve_my_employee(ctx: RequestContext, session: AsyncSession) -> Employee | None:
    if not ctx.email:
        return None
    return await session.scalar(
        select(Employee).where(
            Employee.tenant_id == ctx.tenant_id, Employee.client_id == ctx.client_id,
            Employee.email.isnot(None),
            func.lower(Employee.email) == ctx.email.lower(),
        )
    )


@router.get("/employees/me", response_model=EmployeeOut)
async def get_my_employee(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    emp = await _resolve_my_employee(ctx, session)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee record not found for this user")
    return emp


@router.get("/employees/{employee_id}/org-chart")
async def get_org_chart(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Return the reporting chain upward from the given employee."""
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    chain = []
    current = emp
    visited: set[uuid.UUID] = set()
    while current and current.reporting_manager_id and current.id not in visited:
        visited.add(current.id)
        chain.append({"id": str(current.id), "name": f"{current.first_name} {current.last_name}",
                      "designation": current.designation, "emp_code": current.emp_code})
        manager = await session.get(Employee, current.reporting_manager_id)
        if manager and manager.tenant_id == ctx.tenant_id:
            current = manager
        else:
            break
    return {"employee_id": str(employee_id), "reporting_chain": chain}


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not any(r in ctx.roles for r in _PRIVILEGED):
        mine = await _resolve_my_employee(ctx, session)
        if not mine or mine.id != employee_id:
            raise HTTPException(status_code=403, detail="Access denied")
    return _masked_employee(emp)


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: uuid.UUID,
    body: EmployeeUpdate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    dump = body.model_dump(exclude_unset=True)
    if "location_id" in dump and dump["location_id"]:
        loc = await session.get(Location, dump["location_id"])
        if loc and loc.tenant_id == ctx.tenant_id:
            dump.update(city=loc.city, state=loc.state, work_location=loc.location_name)
    for k, v in dump.items():
        setattr(emp, k, v)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="EMPLOYEE_UPDATED",
                    entity_type="employee", entity_id=str(employee_id),
                    payload=dump, actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(emp)
    return emp


class PIIAccessRequest(BaseModel):
    fields: list[str]


class PIIAccessResponse(BaseModel):
    values: dict[str, str | None]


# Fields whose unmasked value may be revealed through this audited endpoint.
_REVEALABLE_FIELDS = {"pan_number", "bank_account", "aadhaar_number", "uan_number", "bank_ifsc"}


@router.post("/employees/{employee_id}/pii-access", response_model=PIIAccessResponse)
async def pii_access(
    employee_id: uuid.UUID,
    body: PIIAccessRequest,
    request: Request,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Return the unmasked value of specific PII fields, recording an audit event.

    Detail/list responses mask PII; this is the only way to obtain the raw value,
    so every access is authorised (privileged role or self) and logged.
    """
    emp = await session.get(Employee, employee_id)
    if not emp or emp.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not any(r in ctx.roles for r in _PRIVILEGED):
        mine = await _resolve_my_employee(ctx, session)
        if not mine or mine.id != employee_id:
            raise HTTPException(status_code=403, detail="Access denied")

    fields = [f for f in body.fields if f in _REVEALABLE_FIELDS]
    values = {f: getattr(emp, f) for f in fields}
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="PII_ACCESSED",
                    entity_type="employee", entity_id=str(employee_id),
                    payload={"fields": fields, "ip": request.client.host if request.client else "unknown"},
                    actor_id=ctx.user_id)
    await session.commit()
    return PIIAccessResponse(values=values)


# ── Financial Years ───────────────────────────────────────────────────────────

@router.get("/financial-years", response_model=list[FinancialYearOut])
async def list_financial_years(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    rows = await session.scalars(
        select(FinancialYear)
        .where(FinancialYear.tenant_id == ctx.tenant_id)
        .order_by(FinancialYear.start_date.desc())
    )
    return list(rows)


@router.post("/financial-years", response_model=FinancialYearOut, status_code=201)
async def create_financial_year(
    body: FinancialYearCreate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    # A financial year is tenant-level: the statutory FY (1 Apr - 31 Mar) is the
    # same for every client company under the tenant, so FinancialYear carries no
    # client_id. Passing one raised TypeError and 500'd every call.
    fy = FinancialYear(tenant_id=ctx.tenant_id, **body.model_dump())
    session.add(fy)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="FINANCIAL_YEAR_CREATED",
                    entity_type="financial_year", entity_id=body.name,
                    payload=body.model_dump(), actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(fy)
    return fy


@router.patch("/financial-years/{fy_id}/activate", response_model=FinancialYearOut)
async def activate_financial_year(
    fy_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    fy = await session.get(FinancialYear, fy_id)
    if not fy or fy.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Financial year not found")
    # Exactly one FY may be active per tenant: deactivate the others, otherwise
    # "the active FY" is ambiguous for every downstream consumer.
    await session.execute(
        update(FinancialYear)
        .where(
            FinancialYear.tenant_id == ctx.tenant_id,
            FinancialYear.id != fy_id,
            FinancialYear.is_active.is_(True),
        )
        .values(is_active=False)
    )
    fy.is_active = True
    await session.commit()
    await session.refresh(fy)
    return fy


# ── Workflow Engine ───────────────────────────────────────────────────────────

@router.get("/workflow/definitions", response_model=list[WorkflowDefinitionOut])
async def list_workflow_definitions(
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
    entity_type: str | None = None,
):
    q = select(WorkflowDefinition).where(
        WorkflowDefinition.tenant_id == ctx.tenant_id,
        WorkflowDefinition.is_active.is_(True),
    )
    if entity_type:
        q = q.where(WorkflowDefinition.entity_type == entity_type)
    rows = await session.scalars(q)
    return list(rows)


@router.post("/workflow/definitions", response_model=WorkflowDefinitionOut, status_code=201)
async def create_workflow_definition(
    body: WorkflowDefinitionCreate,
    ctx: RequestContext = Depends(_admin),
    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context,
    session: AsyncSession = Depends(get_session),
):
    wf = WorkflowDefinition(
        tenant_id=ctx.tenant_id,
        name=body.name,
        entity_type=body.entity_type,
        steps=[s.model_dump() for s in body.steps],
    )
    session.add(wf)
    await session.commit()
    await session.refresh(wf)
    return wf


@router.post("/workflow/instances", response_model=WorkflowInstanceOut, status_code=201)
async def create_workflow_instance(
    body: WorkflowInstanceCreate,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    instance = WorkflowInstance(
        tenant_id=ctx.tenant_id,
        definition_id=body.definition_id,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        initiated_by=ctx.user_id,
        payload=body.payload,
        status="PENDING",
        current_step=0,
    )
    session.add(instance)
    await session.commit()
    await session.refresh(instance)
    return instance


@router.get("/workflow/instances", response_model=list[WorkflowInstanceOut])
async def list_workflow_instances(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
    entity_type: str | None = None,
    status: str | None = None,
    pending_for_me: bool = Query(False),
):
    q = select(WorkflowInstance).where(WorkflowInstance.tenant_id == ctx.tenant_id)
    if entity_type:
        q = q.where(WorkflowInstance.entity_type == entity_type)
    if status:
        q = q.where(WorkflowInstance.status == status)
    if pending_for_me:
        q = q.where(WorkflowInstance.status == "PENDING")
    rows = await session.scalars(q.order_by(WorkflowInstance.created_at.desc()))
    return list(rows)


@router.post("/workflow/instances/{instance_id}/action", response_model=WorkflowInstanceOut)
async def act_on_workflow(
    instance_id: uuid.UUID,
    body: WorkflowActionIn,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    instance = await session.get(WorkflowInstance, instance_id)
    if not instance or instance.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Workflow instance not found")
    if instance.status not in ("PENDING",):
        raise HTTPException(status_code=409, detail=f"Cannot act on instance in status {instance.status!r}")

    step_action = WorkflowStepAction(
        tenant_id=ctx.tenant_id,
        instance_id=instance.id,
        step_number=instance.current_step,
        actor_id=ctx.user_id,
        action=body.action,
        comment=body.comment,
    )
    session.add(step_action)

    if body.action == "APPROVE":
        # Advance step or complete
        definition = await session.get(WorkflowDefinition, instance.definition_id) if instance.definition_id else None
        total_steps = len(definition.steps) if definition else 1
        if instance.current_step + 1 >= total_steps:
            instance.status = "APPROVED"
        else:
            instance.current_step += 1
    elif body.action == "REJECT":
        instance.status = "REJECTED"

    await audit_log(session, tenant_id=ctx.tenant_id, event_type=f"WORKFLOW_{body.action}",
                    entity_type=instance.entity_type, entity_id=str(instance.entity_id),
                    payload={"instance_id": str(instance_id), "step": instance.current_step,
                             "action": body.action, "comment": body.comment},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(instance)
    return instance
