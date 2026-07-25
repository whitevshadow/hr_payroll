from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends
from hr_shared import RequestContext
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_client_context, get_session
from .logic import compute_esi, compute_lwf, compute_pf, compute_pt
from .models import (
    ComplianceSetting,
    ESIContribution,
    LWFContribution,
    PFContribution,
    PTDeduction,
)
from .schemas import (
    ComplianceSettingCreate,
    ComplianceSettingOut,
    ComputeRequest,
    ComputeResponse,
)

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=list[ComplianceSettingOut])
async def list_settings(
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
    client_id: uuid.UUID | None = None,
):
    q = select(ComplianceSetting).where(ComplianceSetting.tenant_id == ctx.tenant_id)
    if client_id:
        q = q.where(ComplianceSetting.client_id == client_id)
    rows = await session.scalars(q)
    return list(rows)


@router.post("/settings", response_model=ComplianceSettingOut, status_code=201)
async def create_setting(
    body: ComplianceSettingCreate,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    # Delete existing for this state/client if it exists
    await session.execute(
        delete(ComplianceSetting).where(
            ComplianceSetting.tenant_id == ctx.tenant_id,
            ComplianceSetting.client_id == body.client_id,
            ComplianceSetting.state == body.state,
        )
    )
    setting = ComplianceSetting(
        tenant_id=ctx.tenant_id,
        client_id=body.client_id,
        state=body.state,
        pf_enabled=body.pf_enabled,
        pf_employer_rate=body.pf_employer_rate,
        pf_employee_rate=body.pf_employee_rate,
        pf_wage_limit=body.pf_wage_limit,
        esi_enabled=body.esi_enabled,
        esi_employer_rate=body.esi_employer_rate,
        esi_employee_rate=body.esi_employee_rate,
        esi_wage_limit=body.esi_wage_limit,
        pt_enabled=body.pt_enabled,
        lwf_enabled=body.lwf_enabled,
        bonus_enabled=body.bonus_enabled,
        gratuity_enabled=body.gratuity_enabled,
    )
    session.add(setting)
    await session.commit()
    await session.refresh(setting)
    return setting


# ── Compute ───────────────────────────────────────────────────────────────────

@router.post("/compute", response_model=ComputeResponse)
async def compute(
    body: ComputeRequest,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    # Load state or default settings
    settings_obj = await session.scalar(
        select(ComplianceSetting).where(
            ComplianceSetting.tenant_id == ctx.tenant_id,
            ComplianceSetting.client_id == body.client_id,
            ComplianceSetting.state.in_([body.state, "ALL"]),
        ).order_by(ComplianceSetting.state.desc())  # Prefers specific state over "ALL"
    )

    if not settings_obj:
        # No configured settings for this tenant/client/state. Fall back to the
        # statutory defaults. These mirror the model column defaults, which are
        # NOT applied to a transient (un-flushed) object — building a bare
        # ComplianceSetting left every *_enabled flag None, so PF/ESI/PT were
        # all silently skipped and everyone got zero statutory deductions.
        settings_obj = ComplianceSetting(
            tenant_id=ctx.tenant_id,
            state="ALL",
            pf_enabled=True,
            pf_employer_rate=Decimal("12"),
            pf_employee_rate=Decimal("12"),
            pf_wage_limit=Decimal("15000"),
            esi_enabled=True,
            esi_employer_rate=Decimal("3.25"),
            esi_employee_rate=Decimal("0.75"),
            esi_wage_limit=Decimal("21000"),
            pt_enabled=True,
            lwf_enabled=False,
        )

    # Clean old data for this cycle
    for model in (PFContribution, ESIContribution, PTDeduction, LWFContribution):
        await session.execute(
            delete(model).where(
                model.tenant_id == ctx.tenant_id,
                model.employee_id == body.employee_id,
                model.cycle_id == body.cycle_id,
            )
        )

    pf = {}
    if settings_obj.pf_enabled:
        pf = compute_pf(
            basic=body.basic,
            employee_rate=settings_obj.pf_employee_rate,
            employer_rate=settings_obj.pf_employer_rate,
            ceiling=settings_obj.pf_wage_limit,
            ceiling_on=body.ceiling_on,
        )
        session.add(PFContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                   cycle_id=body.cycle_id, **pf))
    else:
        pf = {"pf_wages": Decimal("0"), "employee_pf": Decimal("0"), "employer_eps": Decimal("0"), "employer_epf": Decimal("0"), "is_ceiling_applied": False}

    esi = {}
    if settings_obj.esi_enabled:
        esi = compute_esi(
            monthly_gross=body.monthly_gross,
            employee_rate=settings_obj.esi_employee_rate,
            employer_rate=settings_obj.esi_employer_rate,
            threshold=settings_obj.esi_wage_limit,
        )
        session.add(ESIContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                    cycle_id=body.cycle_id, **esi))
    else:
        esi = {"gross_wages": Decimal("0"), "is_esi_eligible": False, "employee_esi": Decimal("0"), "employer_esi": Decimal("0")}

    pt = {}
    if settings_obj.pt_enabled:
        pt = compute_pt(body.state, body.month)
        session.add(PTDeduction(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                cycle_id=body.cycle_id, **pt))
    else:
        pt = {"state": body.state, "pt_amount": Decimal("0")}

    lwf = {}
    if settings_obj.lwf_enabled:
        lwf = compute_lwf(body.state)
        session.add(LWFContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                    cycle_id=body.cycle_id, **lwf))
    else:
        lwf = {"employee_lwf": Decimal("0"), "employer_lwf": Decimal("0")}

    await session.commit()

    return ComputeResponse(employee_id=body.employee_id, cycle_id=body.cycle_id,
                           **pf, **esi, **pt, **lwf)


@router.get("/summary/{cycle_id}")
async def summary(
    cycle_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Return per-employee detail + aggregates for PF, ESI, PT, LWF."""

    def _where(model, extra=None):
        filters = [model.tenant_id == ctx.tenant_id, model.cycle_id == cycle_id]
        if extra:
            filters += extra
        return filters

    pf_rows = list(await session.scalars(select(PFContribution).where(*_where(PFContribution))))
    esi_rows = list(await session.scalars(select(ESIContribution).where(*_where(ESIContribution))))
    pt_rows = list(await session.scalars(select(PTDeduction).where(*_where(PTDeduction))))
    lwf_rows = list(await session.scalars(select(LWFContribution).where(*_where(LWFContribution))))

    def _sum(rows, attr):
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
            "total_employee_lwf": _sum(lwf_rows, "employee_lwf"),
            "total_employer_lwf": _sum(lwf_rows, "employer_lwf"),
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
        "lwf": [
            {
                "employee_id": str(r.employee_id),
                "state": r.state,
                "employee_lwf": str(r.employee_lwf),
                "employer_lwf": str(r.employer_lwf),
            }
            for r in lwf_rows
        ],
    }
