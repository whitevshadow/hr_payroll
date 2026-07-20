from __future__ import annotations

import asyncio
import io
import logging
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

logger = logging.getLogger(__name__)

# Renders in flight during a bulk download. Each one pins a WeasyPrint thread,
# so this trades wall-clock time against CPU on the reporting container.
_BULK_CONCURRENCY = 4


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return auth.split(" ", 1)[1]


def _payroll_headers(token: str, client_id: str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if client_id:
        headers["x-client-id"] = client_id
    return headers


async def _fetch_result(token: str, cycle_id, employee_id, client_id: str | None = None) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/results/{cycle_id}/{employee_id}"
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers=_payroll_headers(token, client_id))
    if resp.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail="No payroll result for this employee — run the payroll cycle first.",
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Payroll lookup failed: {resp.text}")
    return resp.json()


async def _fetch_cycle(token: str, cycle_id, client_id: str | None = None) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/cycles/{cycle_id}"
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers=_payroll_headers(token, client_id))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Payroll cycle not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Cycle lookup failed: {resp.text}")
    return resp.json()


async def _fetch_client(token: str, client_id: str) -> dict:
    """Look up the client company. Never fatal — a payslip is still renderable."""
    url = f"{settings.client_url}/api/v1/clients/{client_id}"
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(url, headers=headers)
    if resp.status_code != 200:
        logger.warning(
            "Could not resolve client %s for payslip header (%s): %s",
            client_id, resp.status_code, resp.text,
        )
        return {}
    return resp.json()


async def _fetch_summary(token: str, cycle_id, client_id: str | None = None) -> dict:
    url = f"{settings.payroll_url}/api/v1/payroll/cycles/{cycle_id}/summary"
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.get(url, headers=_payroll_headers(token, client_id))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Payroll cycle not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Cycle lookup failed: {resp.text}")
    return resp.json()


def _render(result: dict, cycle: dict, client_info: dict | None) -> str:
    return render_payslip_html(
        cycle, result.get("breakdown_json", {}), result.get("net_pay", "0"), client_info
    )


async def _client_for_cycle(token: str, cycle: dict, client_id: str | None) -> dict | None:
    """Resolve the company the payslip is issued by.

    The cycle carries the client it was run for; the caller's ``x-client-id``
    is only a fallback for the (legacy) cycles that predate client scoping.
    """
    resolved = cycle.get("client_id") or client_id
    if not resolved:
        return None
    return await _fetch_client(token, str(resolved)) or None


async def _write_pdf(html: str) -> bytes:
    """Rasterise HTML to PDF. WeasyPrint is CPU-bound and synchronous, so it
    runs in a worker thread — rendering must not stall the event loop."""
    return await asyncio.to_thread(lambda: HTML(string=html).write_pdf())


async def _build_payslip_pdf(token: str, cycle_id, employee_id, client_id: str | None) -> bytes:
    """Render the payslip PDF for one employee from their payroll result."""
    result = await _fetch_result(token, cycle_id, employee_id, client_id)
    cycle = await _fetch_cycle(token, cycle_id, client_id)
    client_info = await _client_for_cycle(token, cycle, client_id)
    return await _write_pdf(_render(result, cycle, client_info))


async def _upload_payslip(http: httpx.AsyncClient, token: str, tenant_id, employee_id, pdf_bytes: bytes) -> str:
    """Store the PDF in the blobstore and return its blob id."""
    resp = await http.post(
        f"{settings.blobstore_url}/api/v1/blobs/upload",
        headers={"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant_id)},
        files={"file": (f"payslip_{employee_id}.pdf", pdf_bytes, "application/pdf")},
        data={"doc_type": "PAYSLIP", "employee_id": str(employee_id)},
    )
    resp.raise_for_status()
    return resp.json()["blob_id"]


async def _record_payslip(session: AsyncSession, tenant_id, cycle_id, employee_id, blob_id: str | None) -> None:
    """Upsert the generated_reports row for a payslip."""
    status = "COMPLETED" if blob_id else "FAILED"
    existing = await session.scalar(
        select(GeneratedReport).where(
            GeneratedReport.tenant_id == tenant_id,
            GeneratedReport.cycle_id == cycle_id,
            GeneratedReport.employee_id == uuid.UUID(str(employee_id)),
            GeneratedReport.report_type == "PAYSLIP",
        )
    )
    if existing:
        existing.status = status
        existing.file_path = blob_id
        existing.blob_id = uuid.UUID(blob_id) if blob_id else None
    else:
        session.add(
            GeneratedReport(
                tenant_id=tenant_id,
                cycle_id=cycle_id,
                employee_id=uuid.UUID(str(employee_id)),
                report_type="PAYSLIP",
                status=status,
                file_path=blob_id,
                blob_id=uuid.UUID(blob_id) if blob_id else None,
            )
        )


async def _fetch_blob(token: str, tenant_id, blob_id: str) -> bytes | None:
    """Download a stored payslip; None if the blobstore no longer has it."""
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.get(
            f"{settings.blobstore_url}/api/v1/blobs/{blob_id}",
            headers={"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant_id)},
        )
    return resp.content if resp.status_code == 200 else None


async def _payslip_bytes(
    session: AsyncSession,
    ctx: RequestContext,
    token: str,
    cycle_id,
    employee_id,
    *,
    force: bool = False,
) -> bytes:
    """Return a payslip PDF, generating and storing it on first request.

    Payslips used to be produced only as a side effect of disbursement, so
    viewing one for a cycle that had merely been computed or approved 404'd.
    A payslip is fully derivable from the payroll result, so we render it on
    demand and cache the blob for subsequent reads.
    """
    client_id = str(ctx.client_id) if ctx.client_id else None

    if not force:
        existing = await session.scalar(
            select(GeneratedReport).where(
                GeneratedReport.tenant_id == ctx.tenant_id,
                GeneratedReport.cycle_id == cycle_id,
                GeneratedReport.employee_id == employee_id,
                GeneratedReport.report_type == "PAYSLIP",
                GeneratedReport.status == "COMPLETED",
            )
        )
        if existing and existing.file_path:
            cached = await _fetch_blob(token, ctx.tenant_id, existing.file_path)
            if cached is not None:
                return cached
            # The row outlived its blob (purged bucket, restored DB); re-render
            # rather than failing a read the user is entitled to.

    pdf_bytes = await _build_payslip_pdf(token, cycle_id, employee_id, client_id)

    async with httpx.AsyncClient(timeout=30.0) as http:
        blob_id = await _upload_payslip(http, token, ctx.tenant_id, employee_id, pdf_bytes)
    await _record_payslip(session, ctx.tenant_id, cycle_id, employee_id, blob_id)
    await session.commit()
    return pdf_bytes


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
    client_info = await _client_for_cycle(token, cycle, client_id)

    limit = asyncio.Semaphore(_BULK_CONCURRENCY)

    async def _one(employee_id) -> str | None:
        async with limit:
            try:
                result = await _fetch_result(token, body.cycle_id, employee_id, client_id)
                pdf_bytes = await _write_pdf(_render(result, cycle, client_info))
                async with httpx.AsyncClient(timeout=30.0) as http:
                    return await _upload_payslip(
                        http, token, ctx.tenant_id, employee_id, pdf_bytes
                    )
            except Exception as exc:
                logger.error("Failed to generate payslip for %s: %s", employee_id, exc)
                return None

    # A whole cycle is rendered per call; serially this outran the caller's
    # timeout long before it finished.
    blob_ids = await asyncio.gather(*(_one(e) for e in body.employee_ids))

    generated = 0
    for employee_id, blob_id in zip(body.employee_ids, blob_ids):
        # The session is not concurrency-safe — rows are written once the
        # renders have all landed.
        await _record_payslip(session, ctx.tenant_id, body.cycle_id, employee_id, blob_id)
        if blob_id:
            generated += 1

    await session.commit()
    return {"cycle_id": str(body.cycle_id), "generated": generated}


@router.get("/payslip/{cycle_id}/{employee_id}")
async def get_payslip(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    request: Request,
    inline: bool = False,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Fetch the MinIO presigned URL for the payslip blob."""
    token = _bearer(request)

    # Generates the payslip if this is the first time it has been asked for.
    await _payslip_bytes(session, ctx, token, cycle_id, employee_id)
    existing = await session.scalar(
        select(GeneratedReport).where(
            GeneratedReport.tenant_id == ctx.tenant_id,
            GeneratedReport.cycle_id == cycle_id,
            GeneratedReport.employee_id == employee_id,
            GeneratedReport.report_type == "PAYSLIP",
            GeneratedReport.status == "COMPLETED",
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


@router.get("/payslip/{cycle_id}/{employee_id}/pdf")
async def download_payslip_pdf(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    request: Request,
    inline: bool = False,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Stream the payslip PDF itself, rather than a presigned object-store URL.

    The browser cannot reach MinIO (it publishes no host port), and an <iframe>
    or <img> cannot carry an Authorization header — which is why the presigned
    URL existed. Serving the bytes through the gateway keeps everything on one
    origin: the client fetches this with its bearer token and renders the blob.
    """
    token = _bearer(request)
    pdf_bytes = await _payslip_bytes(session, ctx, token, cycle_id, employee_id)

    disposition = "inline" if inline else "attachment"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'{disposition}; filename="payslip_{employee_id}.pdf"'
        },
    )


@router.post("/payslip/{cycle_id}/{employee_id}/regenerate")
async def regenerate_payslip(
    cycle_id: uuid.UUID,
    employee_id: uuid.UUID,
    request: Request,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Re-render a payslip from the current payroll result and company details."""
    token = _bearer(request)
    await _payslip_bytes(session, ctx, token, cycle_id, employee_id, force=True)
    return {"cycle_id": str(cycle_id), "employee_id": str(employee_id), "status": "COMPLETED"}


@router.get("/payslips/bulk/{cycle_id}")
async def bulk_download_payslips(
    cycle_id: uuid.UUID,
    request: Request,
    # Requires x-client-id: every payroll read this fans out to is
    # client-scoped, so without it the request can only die downstream as an
    # opaque 502. Failing here yields a clear 400 instead.
    ctx: RequestContext = Depends(get_client_context),
    session: AsyncSession = Depends(get_session),
):
    """Zip every payslip for a cycle, generating any that do not exist yet."""
    token = _bearer(request)
    client_id = str(ctx.client_id) if ctx.client_id else None

    # Drive the zip from the payroll results rather than the reports table, so a
    # cycle that was computed but never disbursed still yields a full download.
    summary = await _fetch_summary(token, cycle_id, client_id)
    employee_ids = [
        uuid.UUID(str(r["employee_id"]))
        for r in summary.get("results", [])
        if r.get("status") != "FAILED"
    ]
    if not employee_ids:
        raise HTTPException(status_code=404, detail="No payroll results for this cycle.")

    stored = {
        row.employee_id: row.file_path
        for row in await session.scalars(
            select(GeneratedReport).where(
                GeneratedReport.tenant_id == ctx.tenant_id,
                GeneratedReport.cycle_id == cycle_id,
                GeneratedReport.report_type == "PAYSLIP",
                GeneratedReport.status == "COMPLETED",
            )
        )
        if row.file_path
    }

    # The whole cycle is rendered inside one request, so the per-employee work
    # runs concurrently — serially it outruns the gateway's proxy timeout.
    cycle = await _fetch_cycle(token, cycle_id, client_id)
    client_info = await _client_for_cycle(token, cycle, client_id)
    limit = asyncio.Semaphore(_BULK_CONCURRENCY)

    async def _one(employee_id: uuid.UUID) -> tuple[uuid.UUID, bytes | None, str | None]:
        """Return (employee, pdf, newly_created_blob_id)."""
        async with limit:
            blob_id = stored.get(employee_id)
            if blob_id:
                cached = await _fetch_blob(token, ctx.tenant_id, blob_id)
                if cached is not None:
                    return employee_id, cached, None
            result = await _fetch_result(token, cycle_id, employee_id, client_id)
            pdf_bytes = await _write_pdf(_render(result, cycle, client_info))
            async with httpx.AsyncClient(timeout=30.0) as http:
                new_blob_id = await _upload_payslip(
                    http, token, ctx.tenant_id, employee_id, pdf_bytes
                )
            return employee_id, pdf_bytes, new_blob_id

    outcomes = await asyncio.gather(
        *(_one(e) for e in employee_ids), return_exceptions=True
    )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for employee_id, outcome in zip(employee_ids, outcomes):
            if isinstance(outcome, BaseException):
                logger.error("Bulk payslip failed for %s: %s", employee_id, outcome)
                continue
            _, pdf_bytes, new_blob_id = outcome
            if new_blob_id:
                # The session is not concurrency-safe, so rows are written here,
                # after every render has landed.
                await _record_payslip(
                    session, ctx.tenant_id, cycle_id, employee_id, new_blob_id
                )
            zip_file.writestr(f"payslip_{employee_id}.pdf", pdf_bytes)
    await session.commit()

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
