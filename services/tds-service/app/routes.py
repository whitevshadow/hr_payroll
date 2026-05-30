from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from hr_shared import RequestContext
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from decimal import Decimal

from .deps import get_context, get_session, runtime
from .logic import compute_tds
from .models import TDSCalculation, TDSDeclaration
from .schemas import TDSComputeRequest, TDSComputeResponse

router = APIRouter(prefix="/api/v1/tds", tags=["tds"])

_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN", "EMPLOYEE")


@router.post("/compute", response_model=TDSComputeResponse)
async def compute(
    body: TDSComputeRequest,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    result = compute_tds(body.monthly_gross)

    # Idempotent: clear prior calc for this (employee, cycle).
    await session.execute(
        delete(TDSCalculation).where(
            TDSCalculation.tenant_id == ctx.tenant_id,
            TDSCalculation.employee_id == body.employee_id,
            TDSCalculation.cycle_id == body.cycle_id,
        )
    )
    row = TDSCalculation(
        tenant_id=ctx.tenant_id,
        employee_id=body.employee_id,
        cycle_id=body.cycle_id,
        taxable_income=result["taxable_income"],
        annual_tax=result["annual_tax"],
        monthly_tds=result["monthly_tds"],
        regime_applied=result["regime_applied"],
        tax_trace_json=result["tax_trace"],
    )
    session.add(row)
    await session.commit()

    return TDSComputeResponse(
        employee_id=body.employee_id,
        cycle_id=body.cycle_id,
        taxable_income=result["taxable_income"],
        annual_tax=result["annual_tax"],
        monthly_tds=result["monthly_tds"],
        regime_applied=result["regime_applied"],
        tax_trace=result["tax_trace"],
    )


@router.get("/calculations/{cycle_id}/{employee_id}", response_model=TDSComputeResponse)
async def get_calculation(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    row = await session.scalar(
        select(TDSCalculation).where(
            TDSCalculation.tenant_id == ctx.tenant_id,
            TDSCalculation.cycle_id == cycle_id,
            TDSCalculation.employee_id == employee_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="No TDS calculation")
    return TDSComputeResponse(
        employee_id=row.employee_id,
        cycle_id=row.cycle_id,
        taxable_income=row.taxable_income,
        annual_tax=row.annual_tax,
        monthly_tds=row.monthly_tds,
        regime_applied=row.regime_applied,
        tax_trace=row.tax_trace_json,
    )


# ---- TDS Declarations (stub for V1.1) ------------------------------------------

class DeclarationIn(BaseModel):
    employee_id: uuid.UUID
    financial_year: str = ""
    regime_preference: str = "NEW"
    sec_80c: Decimal = Decimal("0")
    sec_80d: Decimal = Decimal("0")
    hra_claimed: Decimal = Decimal("0")
    other_deductions: Decimal = Decimal("0")


@router.post("/declarations", status_code=201)
async def submit_declaration(
    body: DeclarationIn,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Record investment declarations.

    # TODO(v2): Old-regime computation using these declarations.
    """
    import datetime
    fy = body.financial_year or (
        f"{datetime.date.today().year}-{str(datetime.date.today().year + 1)[-2:]}"
    )
    row = TDSDeclaration(
        tenant_id=ctx.tenant_id,
        employee_id=body.employee_id,
        financial_year=fy,
        regime_preference=body.regime_preference,
        sec_80c=body.sec_80c,
        sec_80d=body.sec_80d,
        hra_claimed=body.hra_claimed,
        other_deductions=body.other_deductions,
        is_finalized=False,
        payload_json=body.model_dump(mode="json"),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return {
        "id": str(row.id),
        "employee_id": str(row.employee_id),
        "financial_year": row.financial_year,
        "is_finalized": row.is_finalized,
        "note": "Old-regime computation arrives in V2. # TODO(v2)",
    }
