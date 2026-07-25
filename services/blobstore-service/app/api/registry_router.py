from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin, require_tenant
from app.database.db import get_db
from app.models.document_registry import DocumentRegistry, DocumentStatus
from app.schemas.blob_schema import CreateRegistryEntry, UpdateRegistryEntry
from app.services.registry_service import RegistryService

router = APIRouter(prefix="/registry", tags=["Document Registry"])


@router.post("/", status_code=201)
async def create_entry(
    body: CreateRegistryEntry,
    tenant_id: UUID = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    entry = DocumentRegistry(
        tenant_id=tenant_id,
        raw_blob_id=body.raw_blob_id,
        doc_type=body.doc_type,
        employee_id=body.employee_id,
        payroll_cycle_id=body.payroll_cycle_id,
        month=body.month,
        status=DocumentStatus.UPLOADED,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/reconcile-stale")
async def reconcile_stale(
    stale_minutes: int | None = None,
    max_attempts: int | None = None,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    service = RegistryService(db)
    return await service.reconcile_stale(
        stale_minutes=stale_minutes,
        max_attempts=max_attempts,
    )


@router.patch("/{registry_id}")
async def update_entry(
    registry_id: UUID,
    body: UpdateRegistryEntry,
    tenant_id: UUID = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(DocumentRegistry, registry_id)
    if not entry or entry.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Registry entry not found")

    update_data = body.model_dump(exclude_unset=True, exclude_none=True)
    for field, val in update_data.items():
        setattr(entry, field, val)

    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/")
async def list_entries(
    doc_type: Optional[str] = None,
    employee_id: Optional[UUID] = None,
    payroll_cycle_id: Optional[UUID] = None,
    month: Optional[str] = None,
    status: Optional[str] = None,
    tenant_id: UUID = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    q = select(DocumentRegistry).where(DocumentRegistry.tenant_id == tenant_id)

    if doc_type:
        q = q.where(DocumentRegistry.doc_type == doc_type)
    if employee_id:
        q = q.where(DocumentRegistry.employee_id == employee_id)
    if payroll_cycle_id:
        q = q.where(DocumentRegistry.payroll_cycle_id == payroll_cycle_id)
    if month:
        q = q.where(DocumentRegistry.month == month)
    if status:
        q = q.where(DocumentRegistry.status == status)

    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{registry_id}")
async def get_entry(
    registry_id: UUID,
    tenant_id: UUID = Depends(require_tenant),
    db: AsyncSession = Depends(get_db),
):
    entry = await db.get(DocumentRegistry, registry_id)
    if not entry or entry.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Registry entry not found")
    return entry
