from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from hr_shared import RequestContext
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession


from .deps import get_context, get_client_context, get_session, runtime
from .logic import compute_breakdown
from .models import SalaryComponent, SalaryStructure, SalaryTemplate
from .schemas import (
    Breakdown,
    ComponentOut,
    StructureBulkCreate,
    StructureBulkCreateOut,
    SalaryTemplateCreate,
    SalaryTemplateOut,
    StructureCreate,
    StructureOut,
    StructureRevise,
)
from .settings import settings

router = APIRouter(prefix="/api/v1/salary", tags=["salary"])

_ADMIN = runtime.require_roles("SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN")

# Same roles as _ADMIN, but resolved through get_client_context so the salary
# structure endpoints keep requiring a valid x-client-id alongside the role
# check. Defining a person's pay is the most sensitive write in this service.
_ADMIN_CLIENT = runtime.require_roles(
    "SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN", get_ctx=get_client_context
)

# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates", response_model=list[SalaryTemplateOut])
async def list_templates(
    ctx: RequestContext = Depends(_ADMIN),
    session: AsyncSession = Depends(get_session),
    client_id: uuid.UUID | None = None,
):
    q = select(SalaryTemplate).where(
        SalaryTemplate.tenant_id == ctx.tenant_id,
        SalaryTemplate.is_active.is_(True),
    )
    if client_id:
        q = q.where(SalaryTemplate.client_id == client_id)
    rows = await session.scalars(q)
    return list(rows)


@router.post("/templates", response_model=SalaryTemplateOut, status_code=201)
async def create_template(
    body: SalaryTemplateCreate,
    ctx: RequestContext = Depends(_ADMIN),
    session: AsyncSession = Depends(get_session),
):
    tpl = SalaryTemplate(
        tenant_id=ctx.tenant_id,
        client_id=body.client_id,
        template_name=body.template_name,
        description=body.description,
        is_active=body.is_active,
        template_components=[c.model_dump(mode="json") for c in body.template_components],
    )
    session.add(tpl)
    await session.commit()
    await session.refresh(tpl)
    return tpl


# ── Structures ────────────────────────────────────────────────────────────────

def _components_from_breakdown(b: dict) -> list[tuple[str, object]]:
    return [
        ("Basic", b["basic"]),
        ("HRA", b["hra"]),
        ("Conveyance", b["conveyance"]),
        ("Medical", b["medical"]),
        ("Special Allowance", b["special_allowance"]),
    ]


async def _to_out(structure: SalaryStructure) -> StructureOut:
    b = compute_breakdown(structure.ctc, structure.work_location)
    components = [
        ComponentOut(
            component_name=name,
            amount=amount,
            component_type="EARNING",
            is_taxable=True,
        )
        for name, amount in _components_from_breakdown(b)
    ]
    return StructureOut(
        id=structure.id,
        employee_id=structure.employee_id,
        ctc=structure.ctc,
        effective_from=structure.effective_from,
        effective_to=structure.effective_to,
        is_active=structure.is_active,
        work_location=structure.work_location,
        template_id=structure.template_id,
        components=components,
        breakdown=Breakdown(**b),
    )


async def _build_structure(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    employee_id: uuid.UUID,
    ctc,
    effective_from,
    work_location: str | None,
    template_id: uuid.UUID | None,
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

    structure = await session.scalar(
        select(SalaryStructure).where(
            SalaryStructure.tenant_id == tenant_id,
            SalaryStructure.employee_id == employee_id,
            SalaryStructure.effective_from == effective_from,
        )
    )
    if structure:
        structure.ctc = ctc
        structure.work_location = work_location
        structure.is_active = True
        structure.effective_to = None
        structure.template_id = template_id
        await session.execute(
            delete(SalaryComponent).where(SalaryComponent.structure_id == structure.id)
        )
    else:
        structure = SalaryStructure(
            tenant_id=tenant_id,
            employee_id=employee_id,
            ctc=ctc,
            effective_from=effective_from,
            work_location=work_location,
            is_active=True,
            template_id=template_id,
        )
        session.add(structure)
    await session.flush()
    
    # If template_id provided, we could use template logic, but for V2
    # standardizing on the expanded breakdown is usually what we want.
    # The components map from the breakdown directly for now.
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
    ctx: RequestContext = Depends(_ADMIN_CLIENT),
    session: AsyncSession = Depends(get_session),
):
    structure = await _build_structure(
        session,
        ctx.tenant_id,
        body.employee_id,
        body.ctc,
        body.effective_from,
        body.work_location,
        body.template_id,
    )
    await session.commit()
    await session.refresh(structure)
    out = await _to_out(structure)
    return out


@router.post("/structures/bulk", response_model=StructureBulkCreateOut, status_code=201)
async def create_structures_bulk(
    body: StructureBulkCreate,
    ctx: RequestContext = Depends(_ADMIN_CLIENT),
    session: AsyncSession = Depends(get_session),
):
    structures: list[SalaryStructure] = []
    for item in body.structures:
        structures.append(
            await _build_structure(
                session,
                ctx.tenant_id,
                item.employee_id,
                item.ctc,
                item.effective_from,
                item.work_location,
                item.template_id,
            )
        )

    await session.commit()

    out: list[StructureOut] = []
    for structure in structures:
        await session.refresh(structure)
        structure_out = await _to_out(structure)
        out.append(structure_out)

    return StructureBulkCreateOut(total=len(body.structures), created=len(out), structures=out)


@router.get("/structures/{employee_id}", response_model=StructureOut)
async def get_active_structure(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
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
    ctx: RequestContext = Depends(get_client_context),
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
    ctx: RequestContext = Depends(_ADMIN_CLIENT),
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
        body.template_id or old.template_id,
    )
    await session.commit()
    await session.refresh(structure)
    out = await _to_out(structure)
    return out


