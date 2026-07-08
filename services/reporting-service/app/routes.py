from __future__ import annotations

import io
import os
import uuid
import zipfile

import httpx
from weasyprint import HTML
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response, JSONResponse
from hr_shared import RequestContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_client_context, get_session
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


async def _fetch_result(token: str, cycle_id, employee_id, client_id: str | None = None) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/results/{cycle_id}/{employee_id}"
    headers = {"Authorization": f"Bearer {token}"}
    if client_id:
        headers["x-client-id"] = client_id
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers=headers)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Payroll result not found")
    resp.raise_for_status()
    return resp.json()


async def _fetch_cycle(token: str, cycle_id, client_id: str | None = None) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/cycles/{cycle_id}"
    headers = {"Authorization": f"Bearer {token}"}
    if client_id:
        headers["x-client-id"] = client_id
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers=headers)
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
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Generate + persist a payslip per employee for a cycle, uploaded to MinIO."""
    token = _bearer(request)
    client_id = str(ctx.client_id) if ctx.client_id else None
    cycle = await _fetch_cycle(token, body.cycle_id, client_id)
    generated = 0
    
    async with httpx.AsyncClient(timeout=30.0) as http:
        for employee_id in body.employee_ids:
            try:
                # 1. Fetch data and render HTML
                result = await _fetch_result(token, body.cycle_id, employee_id, client_id)
                html = _render(result, cycle)
                
                # 2. Generate PDF via weasyprint
                pdf_bytes = HTML(string=html).write_pdf()
                
                # 3. Upload to Blobstore Service
                blobstore_upload_url = f"{settings.blobstore_url}/api/v1/blobs/upload"
                files = {"file": (f"payslip_{employee_id}.pdf", pdf_bytes, "application/pdf")}
                data = {"doc_type": "PAYSLIP", "employee_id": str(employee_id)}
                headers = {
                    "Authorization": f"Bearer {token}",
                    "X-Tenant-Id": str(ctx.tenant_id)
                }
                
                blob_resp = await http.post(
                    blobstore_upload_url,
                    headers=headers,
                    files=files,
                    data=data
                )
                blob_resp.raise_for_status()
                blob_data = blob_resp.json()
                path = blob_data["blob_id"]  # Store the blob_id instead of local path
                status = "COMPLETED"
            except Exception as exc:
                import logging
                logging.error(f"Failed to generate payslip for {employee_id}: {exc}")
                path = None
                status = "FAILED"

            # 4. Save to Database
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
                existing.blob_id = path
            else:
                session.add(
                    GeneratedReport(
                        tenant_id=ctx.tenant_id,
                        cycle_id=body.cycle_id,
                        employee_id=uuid.UUID(str(employee_id)),
                        report_type="PAYSLIP",
                        status=status,
                        file_path=path,
                        blob_id=uuid.UUID(path) if path else None,
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
    inline: bool = False,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Fetch the MinIO presigned URL for the payslip blob."""
    token = _bearer(request)
    
    existing = await session.scalar(
        select(GeneratedReport).where(
            GeneratedReport.tenant_id == ctx.tenant_id,
            GeneratedReport.cycle_id == cycle_id,
            GeneratedReport.employee_id == employee_id,
            GeneratedReport.status == "COMPLETED"
        )
    )
    if not existing or not existing.file_path:
        raise HTTPException(status_code=404, detail="Payslip not found or not generated")

    blob_id = existing.file_path
    blobstore_url = f"{settings.blobstore_url}/api/v1/blobs/{blob_id}/url?inline={str(inline).lower()}"
    
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(
            blobstore_url, 
            headers={"Authorization": f"Bearer {token}", "X-Tenant-Id": str(ctx.tenant_id)}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to retrieve payslip URL")
        
        data = resp.json()
        return {"url": data["url"]}


@router.get("/payslips/bulk/{cycle_id}")
async def bulk_download_payslips(
    cycle_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Zip all generated payslips for a cycle and download."""
    token = _bearer(request)
    
    stmt = select(GeneratedReport).where(
        GeneratedReport.tenant_id == ctx.tenant_id,
        GeneratedReport.cycle_id == cycle_id,
        GeneratedReport.report_type == "PAYSLIP",
        GeneratedReport.status == "COMPLETED"
    )
    rows = (await session.scalars(stmt)).all()
    
    if not rows:
        raise HTTPException(status_code=404, detail="No payslips generated for this cycle.")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        async with httpx.AsyncClient(timeout=60.0) as http:
            for row in rows:
                if not row.file_path:
                    continue
                blob_id = row.file_path
                
                # Fetch raw bytes directly from blobstore
                blob_url = f"{settings.blobstore_url}/api/v1/blobs/{blob_id}"
                resp = await http.get(
                    blob_url, 
                    headers={"Authorization": f"Bearer {token}", "X-Tenant-Id": str(ctx.tenant_id)}
                )
                if resp.status_code == 200:
                    zip_file.writestr(f"payslip_{row.employee_id}.pdf", resp.content)

    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="payslips_cycle_{cycle_id}.zip"'}
    )


# ---- Generated reports list -----------------------------------------------

@router.get("/generated")
async def list_generated(
    ctx: RequestContext = Depends(get_client_context),
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


@router.post("/generate", status_code=201)
async def generate_report(
    body: GenerateRequest,
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Generate generic or statutory reports (BANK_ADVICE, PF_ECR, ESI_ECR, PT_REPORT, TDS_REPORT)."""
    # For now, this is a stub. It creates a queued request.
    cycle_id = body.cycle_id or uuid.uuid4()
    row = GeneratedReport(
        tenant_id=ctx.tenant_id,
        cycle_id=cycle_id,
        employee_id=None,
        report_type=body.report_type,
        status="QUEUED",
        file_path=None,
    )
    session.add(row)
    await session.commit()
    return {
        "id": str(row.id),
        "report_type": body.report_type,
        "status": "QUEUED",
        "message": f"{body.report_type} generation arrives in V2. Queued for processing.",
    }
