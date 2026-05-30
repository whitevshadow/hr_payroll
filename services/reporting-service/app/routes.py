from __future__ import annotations

import io
import os
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from hr_shared import RequestContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .models import GeneratedReport
from .schemas import GenerateRequest
from .settings import settings
from .template import render_payslip_html

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return auth.split(" ", 1)[1]


async def _fetch_result(token: str, cycle_id, employee_id) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/results/{cycle_id}/{employee_id}"
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers={"Authorization": f"Bearer {token}"})
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Payroll result not found")
    resp.raise_for_status()
    return resp.json()


async def _fetch_cycle(token: str, cycle_id) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/cycles/{cycle_id}"
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers={"Authorization": f"Bearer {token}"})
    resp.raise_for_status()
    return resp.json()


def _render(result: dict, cycle: dict) -> str:
    return render_payslip_html(
        cycle, result.get("breakdown_json", {}), result.get("net_pay", "0")
    )


@router.post("/payslips/generate")
async def generate_payslips(
    body: GenerateRequest,
    request: Request,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Generate + persist a payslip per employee for a cycle (called on approve)."""
    token = _bearer(request)
    os.makedirs(settings.reports_dir, exist_ok=True)
    cycle = await _fetch_cycle(token, body.cycle_id)
    generated = 0
    for employee_id in body.employee_ids:
        try:
            result = await _fetch_result(token, body.cycle_id, employee_id)
            html = _render(result, cycle)
            path = os.path.join(
                settings.reports_dir, f"payslip_{body.cycle_id}_{employee_id}.html"
            )
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(html)
            status = "COMPLETED"
        except Exception:
            path = None
            status = "FAILED"

        # Idempotent: replace any prior report row for this (cycle, employee).
        existing = await session.scalar(
            select(GeneratedReport).where(
                GeneratedReport.tenant_id == ctx.tenant_id,
                GeneratedReport.cycle_id == body.cycle_id,
                GeneratedReport.employee_id == uuid.UUID(str(employee_id)),
            )
        )
        if existing:
            existing.status = status
            existing.file_path = path
        else:
            session.add(
                GeneratedReport(
                    tenant_id=ctx.tenant_id,
                    cycle_id=body.cycle_id,
                    employee_id=uuid.UUID(str(employee_id)),
                    report_type="PAYSLIP",
                    status=status,
                    file_path=path,
                )
            )
        if status == "COMPLETED":
            generated += 1
    await session.commit()
    return {"cycle_id": str(body.cycle_id), "generated": generated}


@router.get("/payslip/{cycle_id}/{employee_id}")
async def get_payslip(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    request: Request,
    format: str = "html",
    ctx: RequestContext = Depends(get_context),
):
    """Return the payslip as HTML (default) or PDF (?format=pdf)."""
    token = _bearer(request)
    result = await _fetch_result(token, cycle_id, employee_id)
    cycle = await _fetch_cycle(token, cycle_id)
    html = _render(result, cycle)

    if format.lower() == "pdf":
        try:
            # TODO(v2): use WeasyPrint or a headless browser for real PDF export.
            # xhtml2pdf is an optional dep that needs system build tools.
            from xhtml2pdf import pisa

            buf = io.BytesIO()
            pisa.CreatePDF(html.replace("₹", "Rs."), dest=buf)
            return Response(
                content=buf.getvalue(),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": (
                        f'attachment; filename="payslip_{employee_id}.pdf"'
                    )
                },
            )
        except ImportError:
            # xhtml2pdf not installed — fall back to HTML with download headers.
            return Response(
                content=html.encode("utf-8"),
                media_type="text/html",
                headers={
                    "Content-Disposition": (
                        f'attachment; filename="payslip_{employee_id}.html"'
                    )
                },
            )
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}")

    return HTMLResponse(content=html)


# ---- Generated reports list -----------------------------------------------

@router.get("/generated")
async def list_generated(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
    cycle_id: uuid.UUID | None = None,
    report_type: str | None = None,
):
    stmt = select(GeneratedReport).where(GeneratedReport.tenant_id == ctx.tenant_id)
    if cycle_id:
        stmt = stmt.where(GeneratedReport.cycle_id == cycle_id)
    if report_type:
        stmt = stmt.where(GeneratedReport.report_type == report_type)
    stmt = stmt.order_by(GeneratedReport.created_at.desc())
    rows = await session.scalars(stmt)
    return [
        {
            "id": str(r.id),
            "cycle_id": str(r.cycle_id),
            "employee_id": str(r.employee_id) if r.employee_id else None,
            "report_type": r.report_type,
            "status": r.status,
            "file_path": r.file_path,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


# ---- Stub report types (Form 16, PF ECR) -----------------------------------

@router.post("/form-16/{year}", status_code=201)
async def generate_form16(
    year: int,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Create a Form 16 generation request row.

    # TODO(v2): Implement actual Form 16 XML/PDF generator (TRACES integration).
    """
    row = GeneratedReport(
        tenant_id=ctx.tenant_id,
        cycle_id=uuid.uuid4(),  # no specific cycle for annual
        employee_id=None,
        report_type="FORM_16",
        status="FAILED",
        file_path=None,
    )
    session.add(row)
    await session.commit()
    return {
        "id": str(row.id),
        "report_type": "FORM_16",
        "status": "FAILED",
        "reason": "Form 16 generation arrives in V2. # TODO(v2)",
    }


@router.post("/pf-ecr/{cycle_id}", status_code=201)
async def generate_pf_ecr(
    cycle_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Create a PF ECR generation request row.

    # TODO(v2): Generate PF ECR text file from pf_contributions for EPFO portal.
    """
    row = GeneratedReport(
        tenant_id=ctx.tenant_id,
        cycle_id=cycle_id,
        employee_id=None,
        report_type="PF_ECR",
        status="FAILED",
        file_path=None,
    )
    session.add(row)
    await session.commit()
    return {
        "id": str(row.id),
        "report_type": "PF_ECR",
        "status": "FAILED",
        "reason": "PF ECR generator arrives in V2. # TODO(v2)",
    }
