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
    PruneRequest,
)

router = APIRouter(prefix="/api/v1/compliance", tags=["compliance"])


def _esi_period_start_month(year: int, month: int) -> str:
    """First month ("YYYY-MM") of the ESI contribution period containing
    (year, month): April–September → April of that year; October–March →
    October (of the previous year for Jan–Mar)."""
    if 4 <= month <= 9:
        return f"{year:04d}-04"
    if month >= 10:
        return f"{year:04d}-10"
    return f"{year - 1:04d}-10"


async def _resolve_esi_coverage(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    body: ComputeRequest,
    esi_wages: Decimal,
    wage_limit: Decimal,
) -> bool | None:
    """Resolve ESI coverage for this wage month, or None when the request
    carries no year (legacy month-by-month behaviour).

    ESI Act s.2(9) proviso: an employee covered at any point of a contribution
    period stays covered until the period ends, even once wages cross the
    ceiling. That history already lives in esi_contributions, so coverage is
    derived by asking whether any earlier month of the same period was
    eligible — no separate lock state to keep in step. Recomputes are
    self-correcting: /compute deletes this cycle's row before recomputing,
    and earlier months are read as plain data.
    """
    if body.year is None:
        return None
    if esi_wages <= wage_limit:
        return True
    covered_earlier = await session.scalar(
        select(ESIContribution.id).where(
            ESIContribution.tenant_id == tenant_id,
            ESIContribution.employee_id == body.employee_id,
            ESIContribution.is_esi_eligible.is_(True),
            ESIContribution.wage_month >= _esi_period_start_month(body.year, body.month),
            ESIContribution.wage_month < f"{body.year:04d}-{body.month:02d}",
        ).limit(1)
    )
    return covered_earlier is not None


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
            eps_eligible=body.eps_eligible,
        )
        session.add(PFContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                   cycle_id=body.cycle_id, **pf))
    else:
        pf = {"pf_wages": Decimal("0"), "employee_pf": Decimal("0"), "employer_eps": Decimal("0"), "employer_epf": Decimal("0"), "is_ceiling_applied": False}

    esi = {}
    if settings_obj.esi_enabled:
        esi_wages = Decimal(body.esi_gross if body.esi_gross is not None else body.monthly_gross)
        covered = await _resolve_esi_coverage(
            session, ctx.tenant_id, body, esi_wages, settings_obj.esi_wage_limit
        )
        esi = compute_esi(
            monthly_gross=esi_wages,
            employee_rate=settings_obj.esi_employee_rate,
            employer_rate=settings_obj.esi_employer_rate,
            threshold=settings_obj.esi_wage_limit,
            covered_override=covered,
        )
        session.add(ESIContribution(
            tenant_id=ctx.tenant_id, employee_id=body.employee_id, cycle_id=body.cycle_id,
            wage_month=f"{body.year:04d}-{body.month:02d}" if body.year else None,
            **esi,
        ))
    else:
        esi = {"gross_wages": Decimal("0"), "is_esi_eligible": False, "employee_esi": Decimal("0"), "employer_esi": Decimal("0")}

    pt = {}
    if settings_obj.pt_enabled:
        pt = compute_pt(body.state, body.month, body.monthly_gross, body.gender)
        session.add(PTDeduction(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                cycle_id=body.cycle_id, **pt))
    else:
        pt = {"state": body.state, "pt_amount": Decimal("0")}

    lwf = {}
    if settings_obj.lwf_enabled:
        lwf = compute_lwf(body.state, body.month, body.monthly_gross)
        session.add(LWFContribution(tenant_id=ctx.tenant_id, employee_id=body.employee_id,
                                    cycle_id=body.cycle_id, **lwf))
        # `state` is stored on the LWF row but must not reach ComputeResponse:
        # compute_pt already supplies it, and spreading both raises
        # "got multiple values for keyword argument 'state'".
        lwf = {k: v for k, v in lwf.items() if k != "state"}
    else:
        lwf = {"employee_lwf": Decimal("0"), "employer_lwf": Decimal("0")}

    await session.commit()

    return ComputeResponse(employee_id=body.employee_id, cycle_id=body.cycle_id,
                           **pf, **esi, **pt, **lwf)


@router.post("/cycles/{cycle_id}/prune")
async def prune_cycle(
    cycle_id: uuid.UUID,
    body: PruneRequest,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Drop contribution rows for employees no longer part of this cycle.

    /compute deletes and rewrites rows one employee at a time, so it only ever
    touches employees it is called for. When a re-run stops covering someone —
    they separated, or moved to another client — their rows from the previous
    run survive with the figures and rules of that run. They then keep counting
    toward the PF/ESI/PT registers and totals, and would be filed on the ESIC
    monthly return as though they had been paid.

    Payroll calls this after a run with the employees it actually computed;
    everything else attached to the cycle goes.
    """
    keep = set(body.employee_ids)
    removed = 0
    for model in (PFContribution, ESIContribution, PTDeduction, LWFContribution):
        rows = list(await session.scalars(
            select(model).where(model.tenant_id == ctx.tenant_id, model.cycle_id == cycle_id)
        ))
        for row in rows:
            if row.employee_id not in keep:
                await session.delete(row)
                removed += 1
    await session.commit()
    return {"cycle_id": str(cycle_id), "kept_employees": len(keep), "rows_removed": removed}


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
