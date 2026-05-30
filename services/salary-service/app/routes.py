from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from hr_shared import RequestContext
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .logic import compute_breakdown
from .models import SalaryComponent, SalaryStructure
from .schemas import Breakdown, StructureCreate, StructureOut, StructureRevise

router = APIRouter(prefix="/api/v1/salary", tags=["salary"])


def _components_from_breakdown(b: dict) -> list[tuple[str, "object"]]:
    return [
        ("Basic", b["basic"]),
        ("HRA", b["hra"]),
        ("Special Allowance", b["special_allowance"]),
    ]


async def _to_out(structure: SalaryStructure) -> StructureOut:
    b = compute_breakdown(structure.ctc, structure.work_location)
    return StructureOut(
        id=structure.id,
        employee_id=structure.employee_id,
        ctc=structure.ctc,
        effective_from=structure.effective_from,
        effective_to=structure.effective_to,
        is_active=structure.is_active,
        work_location=structure.work_location,
        components=structure.components,
        breakdown=Breakdown(**b),
    )


async def _build_structure(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    employee_id: uuid.UUID,
    ctc,
    effective_from,
    work_location: str | None,
) -> SalaryStructure:
    # Deactivate any currently-active structure for this employee.
    await session.execute(
        update(SalaryStructure)
        .where(
            SalaryStructure.tenant_id == tenant_id,
            SalaryStructure.employee_id == employee_id,
            SalaryStructure.is_active.is_(True),
        )
        .values(is_active=False)
    )
    breakdown = compute_breakdown(ctc, work_location)
    structure = SalaryStructure(
        tenant_id=tenant_id,
        employee_id=employee_id,
        ctc=ctc,
        effective_from=effective_from,
        work_location=work_location,
        is_active=True,
    )
    session.add(structure)
    await session.flush()
    for name, amount in _components_from_breakdown(breakdown):
        session.add(
            SalaryComponent(
                tenant_id=tenant_id,
                structure_id=structure.id,
                component_name=name,
                amount=amount,
                component_type="EARNING",
                is_taxable=True,
            )
        )
    await session.flush()
    return structure


@router.post("/structures", response_model=StructureOut, status_code=201)
async def create_structure(
    body: StructureCreate,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    structure = await _build_structure(
        session,
        ctx.tenant_id,
        body.employee_id,
        body.ctc,
        body.effective_from,
        body.work_location,
    )
    await session.commit()
    await session.refresh(structure)
    return await _to_out(structure)


@router.get("/structures/{employee_id}", response_model=StructureOut)
async def get_active_structure(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    structure = await session.scalar(
        select(SalaryStructure).where(
            SalaryStructure.tenant_id == ctx.tenant_id,
            SalaryStructure.employee_id == employee_id,
            SalaryStructure.is_active.is_(True),
        )
    )
    if not structure:
        raise HTTPException(status_code=404, detail="No active salary structure")
    return await _to_out(structure)


@router.get("/structures/{employee_id}/history", response_model=list[StructureOut])
async def get_structure_history(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Return all salary structures for an employee, newest first."""
    structures = list(await session.scalars(
        select(SalaryStructure)
        .where(
            SalaryStructure.tenant_id == ctx.tenant_id,
            SalaryStructure.employee_id == employee_id,
        )
        .order_by(SalaryStructure.effective_from.desc())
    ))
    return [await _to_out(s) for s in structures]


@router.put("/structures/{structure_id}/revise", response_model=StructureOut)
async def revise_structure(
    structure_id: uuid.UUID,
    body: StructureRevise,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    old = await session.get(SalaryStructure, structure_id)
    if not old or old.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Structure not found")
    work_location = body.work_location or old.work_location
    structure = await _build_structure(
        session,
        ctx.tenant_id,
        old.employee_id,
        body.ctc,
        body.effective_from,
        work_location,
    )
    await session.commit()
    await session.refresh(structure)
    return await _to_out(structure)
