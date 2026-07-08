from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from hr_shared import RequestContext
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from decimal import Decimal

import httpx
import logging

from .deps import get_context, get_client_context, get_session, runtime
from .logic import REGISTRY, compute_annual_tds, compute_overview
from .models import (
    DeclarationVersion,
    EmployeeDeclaration,
    EmployeeTaxProfile,
    Form122,
    ProofDocument,
    TDSCalculation,
    TDSDeclaration,
    TDSLedger,
    TDSSnapshot,
    TaxAuditLog,
    TaxComputation,
    TaxProjection,
    TaxTrace,
)
from .schemas import (
    DeclarationSubmitIn,
    Form122In,
    ProofDecisionIn,
    ProofDocumentIn,
    TDSComputeRequest,
    TDSComputeResponse,
    TaxProfileIn,
)

router = APIRouter(prefix="/api/v1/tds", tags=["tds"])

_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN", "EMPLOYEE", get_ctx=get_client_context)


def tax_year_for_payment(payment_date: date) -> str:
    start = payment_date.year if payment_date.month >= 4 else payment_date.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


async def write_tax_audit(
    session: AsyncSession,
    *,
    ctx: RequestContext,
    event_type: str,
    employee_id: uuid.UUID | None,
    previous_values: dict | None = None,
    new_values: dict | None = None,
    reason: str | None = None,
):
    session.add(
        TaxAuditLog(
            tenant_id=ctx.tenant_id,
            actor_id=ctx.user_id,
            employee_id=employee_id,
            event_type=event_type,
            previous_values=previous_values or {},
            new_values=new_values or {},
            reason=reason,
            event_json={"event_version": "v1"},
        )
    )


@router.post("/compute", response_model=TDSComputeResponse)
async def compute(
    body: TDSComputeRequest,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    payment_date = body.salary_payment_date or date.today()
    result = compute_annual_tds(
        salary_payment_date=payment_date,
        monthly_gross=body.monthly_gross,
        fixed_pay=body.fixed_pay,
        variable_pay=body.variable_pay,
        bonus=body.bonus,
        incentives=body.incentives,
        arrears=body.arrears,
        perquisites=body.perquisites,
        employer_contributions=body.employer_contributions,
        other_taxable_income=body.other_taxable_income,
        previous_employer_income=body.previous_employer_income,
        previous_employer_tds=body.previous_employer_tds,
        current_employer_tds=body.current_employer_tds,
        remaining_payroll_months=body.remaining_payroll_months,
        tax_regime=body.tax_regime,
        declaration_version_id=body.declaration_version_id,
        declarations=body.declarations,
        approved_proofs=body.approved_proofs,
        relief_89=body.relief_89,
    )

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
        remaining_tax=result["remaining_tax"],
        monthly_tds=result["monthly_tds"],
        regime_applied=result["regime_applied"],
        law_version=result["law_version"],
        salary_payment_date=payment_date,
        trace_hash=result["trace_hash"],
        tax_trace_json=result["tax_trace"],
    )
    session.add(row)
    tax_year = tax_year_for_payment(payment_date)
    trace_id = uuid.uuid4()
    trace = TaxTrace(
        id=trace_id,
        tenant_id=ctx.tenant_id,
        employee_id=body.employee_id,
        cycle_id=body.cycle_id,
        tax_year=tax_year,
        law_version=result["law_version"],
        trace_hash=result["trace_hash"],
        trace_json=result["tax_trace"],
    )
    session.add(trace)
    session.add(
        TaxProjection(
            tenant_id=ctx.tenant_id,
            employee_id=body.employee_id,
            cycle_id=body.cycle_id,
            tax_year=tax_year,
            law_version=result["law_version"],
            regime=result["regime_applied"],
            projected_income=result["annual_gross"],
            taxable_income=result["taxable_income"],
            projection_json=result["tax_trace"].get("projected_income", {}),
        )
    )
    session.add(
        TaxComputation(
            tenant_id=ctx.tenant_id,
            employee_id=body.employee_id,
            cycle_id=body.cycle_id,
            tax_year=tax_year,
            law_version=result["law_version"],
            regime=result["regime_applied"],
            annual_tax=result["annual_tax"],
            trace_hash=result["trace_hash"],
            trace_json=result["tax_trace"],
        )
    )
    snapshot = TDSSnapshot(
        tenant_id=ctx.tenant_id,
        employee_id=body.employee_id,
        cycle_id=body.cycle_id,
        annual_tax=result["annual_tax"],
        remaining_tax=result["remaining_tax"],
        monthly_tds=result["monthly_tds"],
        tax_trace_id=trace_id,
        law_version=result["law_version"],
        regime=result["regime_applied"],
        snapshot_json={
            "trace_hash": result["trace_hash"],
            "salary_payment_date": payment_date.isoformat(),
        },
    )
    session.add(snapshot)
    session.add(
        TDSLedger(
            tenant_id=ctx.tenant_id,
            employee_id=body.employee_id,
            cycle_id=body.cycle_id,
            tax_year=tax_year,
            entry_type="MONTHLY_TDS",
            amount=result["monthly_tds"],
            reference_json={"snapshot": str(snapshot.id), "trace_hash": result["trace_hash"]},
        )
    )
    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="TDS_RECALCULATED.v1",
        employee_id=body.employee_id,
        new_values={
            "cycle_id": str(body.cycle_id),
            "law_version": result["law_version"],
            "regime": result["regime_applied"],
            "monthly_tds": str(result["monthly_tds"]),
            "trace_hash": result["trace_hash"],
        },
        reason="compute endpoint",
    )
    await session.commit()

    return TDSComputeResponse(
        employee_id=body.employee_id,
        cycle_id=body.cycle_id,
        taxable_income=result["taxable_income"],
        annual_tax=result["annual_tax"],
        remaining_tax=result["remaining_tax"],
        monthly_tds=result["monthly_tds"],
        regime_applied=result["regime_applied"],
        law_version=result["law_version"],
        salary_payment_date=payment_date,
        trace_hash=result["trace_hash"],
        tax_trace=result["tax_trace"],
    )


@router.get("/calculations/{cycle_id}/{employee_id}", response_model=TDSComputeResponse)
async def get_calculation(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
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
        remaining_tax=row.remaining_tax,
        monthly_tds=row.monthly_tds,
        regime_applied=row.regime_applied,
        law_version=row.law_version,
        salary_payment_date=row.salary_payment_date,
        trace_hash=row.trace_hash,
        tax_trace=row.tax_trace_json,
    )


@router.get("/laws")
async def list_laws():
    return {"versions": REGISTRY.versions()}


@router.post("/profiles", status_code=201)
async def upsert_tax_profile(
    body: TaxProfileIn,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    row = EmployeeTaxProfile(tenant_id=ctx.tenant_id, client_id=ctx.client_id, **body.model_dump())
    session.add(row)
    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="TAX_PROFILE_CREATED.v1",
        employee_id=body.employee_id,
        new_values=body.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id), "status": row.status}


@router.post("/declarations/v2", status_code=201)
async def submit_versioned_declaration(
    body: DeclarationSubmitIn,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    current = await session.scalar(
        select(EmployeeDeclaration).where(
            EmployeeDeclaration.tenant_id == ctx.tenant_id, EmployeeDeclaration.client_id == ctx.client_id,
            EmployeeDeclaration.employee_id == body.employee_id,
            EmployeeDeclaration.tax_year == body.tax_year,
        )
    )
    if current:
        current.current_version += 1
        current.status = "SUBMITTED"
        current.submitted_at = datetime.now(timezone.utc)
        current.declaration_json = body.payload
        declaration_id = current.id
        version = current.current_version
    else:
        current = EmployeeDeclaration(
            tenant_id=ctx.tenant_id,
            employee_id=body.employee_id,
            tax_year=body.tax_year,
            current_version=1,
            status="SUBMITTED",
            submitted_at=datetime.now(timezone.utc),
            declaration_json=body.payload,
        )
        session.add(current)
        await session.flush()
        declaration_id = current.id
        version = 1

    version_row = DeclarationVersion(
        tenant_id=ctx.tenant_id,
        declaration_id=declaration_id,
        employee_id=body.employee_id,
        tax_year=body.tax_year,
        version=version,
        status="SUBMITTED",
        payload_json=body.payload,
        change_reason=body.change_reason,
    )
    session.add(version_row)
    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="DECLARATION_SUBMITTED.v1",
        employee_id=body.employee_id,
        new_values={"declaration_id": str(declaration_id), "version": version, "payload": body.payload},
        reason=body.change_reason,
    )
    await session.commit()
    await session.refresh(version_row)
    return {"declaration_id": str(declaration_id), "version_id": str(version_row.id), "version": version}


@router.post("/proofs", status_code=201)
async def upload_proof_reference(
    body: ProofDocumentIn,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    row = ProofDocument(tenant_id=ctx.tenant_id, client_id=ctx.client_id, **body.model_dump())
    session.add(row)
    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="PROOF_SUBMITTED.v1",
        employee_id=body.employee_id,
        new_values=body.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id), "status": row.status}


@router.post("/proofs/{proof_id}/decision")
async def decide_proof(
    proof_id: uuid.UUID,
    body: ProofDecisionIn,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    row = await session.scalar(
        select(ProofDocument).where(ProofDocument.tenant_id == ctx.tenant_id, ProofDocument.client_id == ctx.client_id, ProofDocument.id == proof_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Proof not found")
    previous = {"status": row.status}
    row.status = body.status
    row.verified_by = ctx.user_id
    row.verified_at = datetime.now(timezone.utc)
    row.verification_json = body.verification | {"reason": body.reason}
    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="PROOF_APPROVED.v1" if body.status == "APPROVED" else "PROOF_REVIEWED.v1",
        employee_id=row.employee_id,
        previous_values=previous,
        new_values={"status": body.status, "proof_id": str(proof_id)},
        reason=body.reason,
    )
    await session.commit()
    return {"id": str(row.id), "status": row.status}


@router.post("/form122", status_code=201)
async def generate_form122(
    body: Form122In,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    row = Form122(
        tenant_id=ctx.tenant_id,
        employee_id=body.employee_id,
        tax_year=body.tax_year,
        salary_details=body.salary_details,
        declaration_summary=body.declaration_summary,
        generated_at=datetime.now(timezone.utc),
        status="GENERATED",
        submission_mode=body.submission_mode,
    )
    session.add(row)
    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="FORM122_GENERATED.v1",
        employee_id=body.employee_id,
        new_values=body.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(row)
    return {"id": str(row.id), "status": row.status, "submission_mode": row.submission_mode}


# ── Overview: full TDS dashboard for one employee ──────────────────────────────

@router.get("/overview/{employee_id}")
async def get_employee_overview(
    employee_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Compute live TDS overview for an employee using their salary data.

    This is the primary endpoint for the TDS dashboard. It fetches the salary
    from the salary-service, runs both-regime comparison, and returns everything
    the frontend needs.
    """
    from .settings import settings
    logger = logging.getLogger(__name__)

    # Forward the original Authorization header for inter-service auth
    auth_val = request.headers.get("authorization", "")
    headers = {
        "x-tenant-id": str(ctx.tenant_id),
        "x-user-id": str(ctx.user_id),
    }
    if auth_val:
        headers["authorization"] = auth_val

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            salary_resp = await client.get(
                f"{settings.salary_url}/api/v1/salary/structures/{employee_id}",
                headers=headers,
            )
            if salary_resp.status_code == 404:
                raise HTTPException(status_code=404, detail="No salary structure found for this employee")
            salary_resp.raise_for_status()
            salary = salary_resp.json()
        except httpx.RequestError as exc:
            logger.error(f"Failed to fetch salary for {employee_id}: {exc}")
            raise HTTPException(status_code=502, detail=f"Salary service unavailable: {exc}")

    bd = salary.get("breakdown", {})
    ctc = Decimal(str(salary.get("ctc", "0")))
    basic_monthly = Decimal(str(bd.get("basic", "0")))
    hra_monthly = Decimal(str(bd.get("hra", "0")))
    is_metro = bd.get("is_metro", False)

    # Fetch existing declarations for this employee
    decl_declarations: dict[str, Decimal] = {}
    today = date.today()
    fy_start = today.year if today.month >= 4 else today.year - 1
    tax_year = f"{fy_start}-{str(fy_start + 1)[-2:]}"

    existing_decl = await session.scalar(
        select(EmployeeDeclaration).where(
            EmployeeDeclaration.tenant_id == ctx.tenant_id, EmployeeDeclaration.client_id == ctx.client_id,
            EmployeeDeclaration.employee_id == employee_id,
            EmployeeDeclaration.tax_year == tax_year,
        )
    )

    decl_payload = {}
    if existing_decl and existing_decl.declaration_json:
        decl_payload = existing_decl.declaration_json
        # Extract declarations into the format compute_overview expects
        sec_80c = decl_payload.get("sec_80c", {})
        if isinstance(sec_80c, dict):
            total_80c = sum(Decimal(str(v)) for v in sec_80c.values() if isinstance(v, (int, float, str)))
            decl_declarations["80C"] = min(total_80c, Decimal("150000"))
        sec_80d = decl_payload.get("sec_80d", {})
        if isinstance(sec_80d, dict):
            total_80d = Decimal(str(sec_80d.get("self", 0))) + Decimal(str(sec_80d.get("parents", 0)))
            decl_declarations["80D"] = total_80d
        nps = decl_payload.get("nps_80ccd_1b", 0)
        if nps:
            decl_declarations["80CCD_1B"] = min(Decimal(str(nps)), Decimal("50000"))
        hra_info = decl_payload.get("hra", {})
        if isinstance(hra_info, dict) and hra_info.get("rent_monthly", 0) > 0:
            rent_m = Decimal(str(hra_info["rent_monthly"]))
            hra_exempt = min(
                hra_monthly * 12,
                rent_m * 12 - Decimal("0.1") * basic_monthly * 12,
                basic_monthly * 12 * (Decimal("0.5") if hra_info.get("is_metro", is_metro) else Decimal("0.4")),
            )
            decl_declarations["HRA"] = max(Decimal("0"), hra_exempt)
        other = decl_payload.get("other", {})
        if isinstance(other, dict):
            pt = other.get("professional_tax", 0)
            if pt:
                decl_declarations["PROFESSIONAL_TAX"] = min(Decimal(str(pt)), Decimal("2500"))

    # Auto-populate EPF from basic (12% of annual basic, capped at 80C limit)
    epf_annual = basic_monthly * 12 * Decimal("0.12")
    if "80C" not in decl_declarations or decl_declarations["80C"] == 0:
        decl_declarations["80C"] = min(epf_annual, Decimal("150000"))

    overview = compute_overview(
        ctc=ctc,
        basic_monthly=basic_monthly,
        hra_monthly=hra_monthly,
        is_metro=is_metro,
        declarations=decl_declarations,
    )

    # Include salary and declaration details for the frontend
    overview["salary"] = {
        "ctc": str(ctc),
        "basic_monthly": str(basic_monthly),
        "hra_monthly": str(hra_monthly),
        "is_metro": is_metro,
        "epf_annual": str(epf_annual),
    }
    overview["declaration_payload"] = decl_payload
    overview["tax_year"] = tax_year

    return overview


# ── Declarations retrieval ─────────────────────────────────────────────────────

@router.get("/declarations/{employee_id}")
async def get_declarations(
    employee_id: uuid.UUID,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Retrieve the latest declaration for an employee in the current FY."""
    today = date.today()
    fy_start = today.year if today.month >= 4 else today.year - 1
    tax_year = f"{fy_start}-{str(fy_start + 1)[-2:]}"

    decl = await session.scalar(
        select(EmployeeDeclaration).where(
            EmployeeDeclaration.tenant_id == ctx.tenant_id, EmployeeDeclaration.client_id == ctx.client_id,
            EmployeeDeclaration.employee_id == employee_id,
            EmployeeDeclaration.tax_year == tax_year,
        )
    )

    if not decl:
        return {
            "employee_id": str(employee_id),
            "tax_year": tax_year,
            "has_declaration": False,
            "declaration_json": {},
            "status": None,
            "version": 0,
        }

    return {
        "employee_id": str(employee_id),
        "tax_year": decl.tax_year,
        "has_declaration": True,
        "declaration_json": decl.declaration_json,
        "status": decl.status,
        "version": decl.current_version,
        "submitted_at": decl.submitted_at.isoformat() if decl.submitted_at else None,
    }


# ── Auto-compute: called by salary-service on create/revise ──────────────────

class AutoComputeIn(BaseModel):
    employee_id: uuid.UUID
    ctc: Decimal
    basic_monthly: Decimal
    hra_monthly: Decimal
    is_metro: bool = False


@router.post("/auto-compute", status_code=200)
async def auto_compute_tds(
    body: AutoComputeIn,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Trigger TDS recalculation when salary is created/revised.

    This stores a TDS profile and initial calculation so the employee
    immediately has non-zero tax data in the system.
    """
    logger = logging.getLogger(__name__)
    payment_date = date.today()
    tax_year = tax_year_for_payment(payment_date)

    # Run the overview computation
    overview = compute_overview(
        ctc=body.ctc,
        basic_monthly=body.basic_monthly,
        hra_monthly=body.hra_monthly,
        is_metro=body.is_metro,
    )

    # Ensure a tax profile exists
    existing_profile = await session.scalar(
        select(EmployeeTaxProfile).where(
            EmployeeTaxProfile.tenant_id == ctx.tenant_id, EmployeeTaxProfile.client_id == ctx.client_id,
            EmployeeTaxProfile.employee_id == body.employee_id,
            EmployeeTaxProfile.status == "ACTIVE",
        )
    )
    if not existing_profile:
        session.add(EmployeeTaxProfile(
            tenant_id=ctx.tenant_id,
            employee_id=body.employee_id,
            tax_regime="DEFAULT",
            effective_from=payment_date,
            status="ACTIVE",
        ))

    await write_tax_audit(
        session,
        ctx=ctx,
        event_type="TDS_AUTO_COMPUTED.v1",
        employee_id=body.employee_id,
        new_values={
            "ctc": str(body.ctc),
            "tax_year": tax_year,
            "recommended_regime": overview["recommended"],
            "monthly_tds": overview["employee_overview"]["monthly_tds"],
        },
        reason="salary created/revised",
    )
    await session.commit()

    logger.info(
        f"Auto-computed TDS for employee {body.employee_id}: "
        f"CTC={body.ctc}, recommended={overview['recommended']}, "
        f"monthly_tds={overview['employee_overview']['monthly_tds']}"
    )

    return {
        "employee_id": str(body.employee_id),
        "tax_year": tax_year,
        "overview": overview["employee_overview"],
        "recommended": overview["recommended"],
    }


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
    ctx: RequestContext = Depends(get_client_context),
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
