from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from hr_shared import RequestContext, audit_log
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session, runtime
from .models import Department, Employee
from .schemas import (
    DepartmentCreate,
    DepartmentOut,
    EmployeeCreate,
    EmployeeOut,
    EmployeePage,
    EmployeeUpdate,
)

router = APIRouter(prefix="/api/v1", tags=["employees"])

# Role guards
_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


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
    emp = Employee(tenant_id=ctx.tenant_id, **body.model_dump())
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

    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    rows = await session.scalars(
        base.order_by(Employee.emp_code).offset((page - 1) * page_size).limit(page_size)
    )
    return EmployeePage(items=list(rows), total=total or 0, page=page, page_size=page_size)


_PRIVILEGED = ("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


async def _resolve_my_employee(ctx: RequestContext, session: AsyncSession) -> Employee | None:
    """Find the employee record linked to the caller (matched by email)."""
    if not ctx.email:
        return None
    return await session.scalar(
        select(Employee).where(
            Employee.tenant_id == ctx.tenant_id,
            Employee.email == ctx.email.lower(),
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
    for k, v in body.model_dump(exclude_unset=True).items():
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
