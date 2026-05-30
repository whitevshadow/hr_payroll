from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from hr_shared import RequestContext
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .logic import compute_esi, compute_pf, compute_pt
from .models import ESIContribution, PFContribution, PTDeduction
from .schemas import ComputeRequest, ComputeResponse

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])


@router.post("/compute", response_model=ComputeResponse)
async def compute(
    body: ComputeRequest,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    pf = compute_pf(body.basic, body.ceiling_on)
    esi = compute_esi(body.monthly_gross)
    pt = compute_pt(body.state, body.month)

    for model in (PFContribution, ESIContribution, PTDeduction):
        await session.execute(
            delete(model).where(
                model.tenant_id == ctx.tenant_id,
                model.employee_id == body.employee_id,
                model.cycle_id == body.cycle_id,
            )
        )

    session.add(PFContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                               cycle_id=body.cycle_id, **pf))
    session.add(ESIContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                cycle_id=body.cycle_id, **esi))
    session.add(PTDeduction(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                            cycle_id=body.cycle_id, **pt))
    await session.commit()

    return ComputeResponse(employee_id=body.employee_id, cycle_id=body.cycle_id,
                           **pf, **esi, **pt)


@router.get("/summary/{cycle_id}")
async def summary(
    cycle_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Return per-employee detail + aggregates for PF, ESI, PT."""

    def _where(model, extra=None):
        filters = [model.tenant_id == ctx.tenant_id, model.cycle_id == cycle_id]
        if extra:
            filters += extra
        return filters

    pf_rows = list(await session.scalars(
        select(PFContribution).where(*_where(PFContribution))
    ))
    esi_rows = list(await session.scalars(
        select(ESIContribution).where(*_where(ESIContribution))
    ))
    pt_rows = list(await session.scalars(
        select(PTDeduction).where(*_where(PTDeduction))
    ))

    def _sum(rows, attr):
        from decimal import Decimal
        return str(sum((getattr(r, attr) for r in rows), Decimal("0")))

    return {
        "cycle_id": str(cycle_id),
        "totals": {
            "total_employee_pf": _sum(pf_rows, "employee_pf"),
            "total_employer_pf": _sum(pf_rows, "employer_epf"),
            "total_employer_eps": _sum(pf_rows, "employer_eps"),
            "total_employee_esi": _sum(esi_rows, "employee_esi"),
            "total_employer_esi": _sum(esi_rows, "employer_esi"),
            "total_pt": _sum(pt_rows, "pt_amount"),
            "ceiling_applied_count": sum(1 for r in pf_rows if r.is_ceiling_applied),
            "esi_eligible_count": sum(1 for r in esi_rows if r.is_esi_eligible),
        },
        "pf": [
            {
                "employee_id": str(r.employee_id),
                "pf_wages": str(r.pf_wages),
                "employee_pf": str(r.employee_pf),
                "employer_eps": str(r.employer_eps),
                "employer_epf": str(r.employer_epf),
                "is_ceiling_applied": r.is_ceiling_applied,
            }
            for r in pf_rows
        ],
        "esi": [
            {
                "employee_id": str(r.employee_id),
                "gross_wages": str(r.gross_wages),
                "is_esi_eligible": r.is_esi_eligible,
                "employee_esi": str(r.employee_esi),
                "employer_esi": str(r.employer_esi),
            }
            for r in esi_rows
        ],
        "pt": [
            {
                "employee_id": str(r.employee_id),
                "state": r.state,
                "pt_amount": str(r.pt_amount),
            }
            for r in pt_rows
        ],
    }
