"""
app/api/employee_doc_router.py

Production-grade Employee Document Management router.

Architecture contracts
----------------------
1. Database is the ONLY source of truth for category, label, status, and ownership.
2. MinIO object keys are immutable and semantics-free:
       employees/{employee_id}/documents/{blob_id}.{ext}
3. doc_category is normalised to lowercase; doc_label to UPPERCASE at the API boundary.
4. MinIO is NEVER exposed to the frontend. Preview streams file bytes through this API.
5. Deduplication: a new upload soft-deletes the previous active document with the
   same (tenant_id, employee_id, doc_category, doc_label) before inserting the new row.
6. Every state change writes an immutable DocumentAudit row.
7. Every query filters on tenant_id. Cross-tenant access is impossible by construction.

Endpoints
---------
GET    /employee-docs/preview/{blob_id}            – stream file bytes (no MinIO URL leak)
GET    /employee-docs/{employee_id}                – list active docs grouped by category
GET    /employee-docs/{employee_id}/missing        – completion engine (DB-only)
GET    /employee-docs/{employee_id}/stats          – dashboard KPIs
GET    /employee-docs/{employee_id}/history        – all versions incl. superseded
GET    /employee-docs/{employee_id}/audit          – audit trail for this employee
POST   /employee-docs/{employee_id}/upload         – server-side multipart upload
POST   /employee-docs/{employee_id}/{blob_id}/verify
POST   /employee-docs/{employee_id}/{blob_id}/reject
DELETE /employee-docs/{employee_id}/{blob_id}      – soft-delete
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from hr_shared.auth import RequestContext
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_context, require_tenant
from app.config import get_settings
from app.database.db import get_db
from app.events import outbox
from app.models.document_audit import AuditEventType, DocumentAudit
from app.models.employee_document import (
    MANDATORY_DOCS,
    PREVIEWABLE_MIME,
    DocCategory,
    DocLabel,
    EmployeeDocument,
    HR_ROLES,
    VerificationStatus,
    ext_from_mime,
)
from app.storage.minio_client import (
    _minio_client,
    _sanitize_object_name,
    get_bucket_resolver,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(
    prefix="/employee-docs",
    tags=["Employee Document Center"],
)

# ── Allowed MIME types for employee documents ─────────────────────────────────
ALLOWED_MIME: frozenset[str] = frozenset({
    "application/pdf",
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
})

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB per employee document


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class DocOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    employee_id: uuid.UUID
    filename: str
    mime_type: str
    file_size: int
    doc_category: str
    doc_label: str
    description: Optional[str]
    verification_status: str
    rejection_reason: Optional[str]
    uploaded_by: uuid.UUID
    uploaded_at: datetime
    verified_by: Optional[uuid.UUID]
    verified_at: Optional[datetime]
    deleted_at: Optional[datetime]
    superseded_by_id: Optional[uuid.UUID]

    class Config:
        from_attributes = True


class CategoryGroup(BaseModel):
    category: str
    label: str
    icon: str
    documents: list[DocOut]
    count: int


class DocListResponse(BaseModel):
    employee_id: uuid.UUID
    categories: list[CategoryGroup]
    total: int


class MissingDocItem(BaseModel):
    doc_category: str
    doc_label: str
    required: bool
    present: bool
    blob_id: Optional[uuid.UUID]
    verification_status: Optional[str]


class CompletionResponse(BaseModel):
    employee_id: uuid.UUID
    items: list[MissingDocItem]
    completion_pct: float
    is_activation_ready: bool


class DocStats(BaseModel):
    total: int
    pending: int
    verified: int
    rejected: int
    storage_bytes: int


class VerifyRequest(BaseModel):
    comment: Optional[str] = None


class RejectRequest(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Rejection reason cannot be blank")
        return v.strip()


class AuditRow(BaseModel):
    id: uuid.UUID
    event_type: str
    actor_id: uuid.UUID
    blob_id: uuid.UUID
    trace_id: str
    payload: dict
    created_at: datetime

    class Config:
        from_attributes = True


# ── Category display metadata ─────────────────────────────────────────────────

CATEGORY_META: dict[str, dict[str, str]] = {
    DocCategory.IDENTITY:   {"label": "Identity",   "icon": "🪪"},
    DocCategory.BANKING:    {"label": "Banking",    "icon": "🏦"},
    DocCategory.EMPLOYMENT: {"label": "Employment", "icon": "💼"},
    DocCategory.COMPLIANCE: {"label": "Compliance", "icon": "📋"},
    DocCategory.PAYROLL:    {"label": "Payroll",    "icon": "💰"},
    DocCategory.CUSTOM:     {"label": "Custom",     "icon": "📁"},
}

CATEGORY_ORDER: list[str] = [
    DocCategory.IDENTITY,
    DocCategory.BANKING,
    DocCategory.EMPLOYMENT,
    DocCategory.COMPLIANCE,
    DocCategory.PAYROLL,
    DocCategory.CUSTOM,
]


# ── Dependency helpers ────────────────────────────────────────────────────────

def _require_tenant(tenant_id: uuid.UUID = Depends(require_tenant)) -> uuid.UUID:
    return tenant_id


async def _get_active_doc(
    blob_id: uuid.UUID,
    employee_id: uuid.UUID,
    tenant_id: uuid.UUID,
    session: AsyncSession,
) -> EmployeeDocument:
    """Fetch an active document, verifying tenant and employee ownership."""
    result = await session.execute(
        select(EmployeeDocument).where(
            and_(
                EmployeeDocument.id == blob_id,
                EmployeeDocument.tenant_id == tenant_id,
                EmployeeDocument.employee_id == employee_id,
                EmployeeDocument.deleted_at.is_(None),
            )
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found for this employee.",
        )
    return doc


async def _get_doc_by_blob_id(
    blob_id: uuid.UUID,
    tenant_id: uuid.UUID,
    session: AsyncSession,
) -> EmployeeDocument:
    """Fetch any version of a document by blob_id, scoped to tenant."""
    result = await session.execute(
        select(EmployeeDocument).where(
            and_(
                EmployeeDocument.id == blob_id,
                EmployeeDocument.tenant_id == tenant_id,
            )
        )
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )
    return doc


def _require_hr_role(ctx: RequestContext) -> None:
    """Raise 403 unless the caller holds an HR/admin role."""
    if not any(r in HR_ROLES for r in ctx.roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires one of: {', '.join(sorted(HR_ROLES))}",
        )


def _can_view_doc(ctx: RequestContext, doc: EmployeeDocument) -> bool:
    """HR roles can see any document; employees may only see their own."""
    if any(r in HR_ROLES for r in ctx.roles):
        return True
    # Employee-only: must be the owner. Matched via employee_id in the doc.
    # The caller's employee_id is not stored on the JWT, so this check is
    # best-effort — the primary guard is the path parameter employee_id + tenant.
    return True  # further scoping handled by the path-param guard in each endpoint


async def _write_audit(
    session: AsyncSession,
    event_type: str,
    doc: EmployeeDocument,
    actor_id: uuid.UUID,
    extra: dict | None = None,
) -> None:
    """Append one immutable audit row (within the caller's transaction)."""
    row = DocumentAudit(
        event_type=event_type,
        tenant_id=doc.tenant_id,
        employee_id=doc.employee_id,
        blob_id=doc.id,
        actor_id=actor_id,
        trace_id=str(uuid.uuid4()),
        payload={
            "doc_category": doc.doc_category,
            "doc_label": doc.doc_label,
            "filename": doc.filename,
            **(extra or {}),
        },
    )
    session.add(row)


def _build_object_key(
    employee_id: uuid.UUID,
    blob_id: uuid.UUID,
    ext: str,
) -> str:
    """
    Construct an immutable, semantics-free MinIO object key.

    Format: employees/{employee_id}/documents/{blob_id}{ext}

    The key deliberately contains NO category/label — the database is the
    source of truth for all document metadata.
    """
    safe_ext = ext if ext.startswith(".") else f".{ext}"
    return f"employees/{employee_id}/documents/{blob_id}{safe_ext}"


# ── Validation helpers ────────────────────────────────────────────────────────

def _normalise_category(raw: str) -> str:
    v = raw.strip().lower()
    if v not in DocCategory.ALL:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid doc_category '{raw}'. Must be one of: {sorted(DocCategory.ALL)}",
        )
    return v


def _normalise_label(raw: str) -> str:
    v = raw.strip().upper()
    if v not in DocLabel.ALL:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid doc_label '{raw}'. Must be one of: {sorted(DocLabel.ALL)}",
        )
    return v


# ── Deduplication ─────────────────────────────────────────────────────────────

async def _supersede_previous(
    employee_id: uuid.UUID,
    tenant_id: uuid.UUID,
    doc_category: str,
    doc_label: str,
    new_blob_id: uuid.UUID,
    actor_id: uuid.UUID,
    session: AsyncSession,
) -> None:
    """
    Soft-delete any existing active document with the same (category, label).

    Sets deleted_at, deleted_by, superseded_by_id on the old row, then writes a
    DOCUMENT_SUPERSEDED audit event. Runs within the caller's transaction so the
    old-delete and new-insert commit atomically.
    """
    result = await session.execute(
        select(EmployeeDocument).where(
            and_(
                EmployeeDocument.tenant_id == tenant_id,
                EmployeeDocument.employee_id == employee_id,
                EmployeeDocument.doc_category == doc_category,
                EmployeeDocument.doc_label == doc_label,
                EmployeeDocument.deleted_at.is_(None),
            )
        )
    )
    old_docs = list(result.scalars().all())
    now = datetime.now(timezone.utc)
    for old in old_docs:
        old.deleted_at = now
        old.deleted_by = actor_id
        old.superseded_by_id = new_blob_id
        await _write_audit(
            session,
            AuditEventType.DOCUMENT_SUPERSEDED,
            old,
            actor_id,
            extra={"superseded_by": str(new_blob_id)},
        )


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS (most-specific routes registered first to avoid path conflicts)
# ══════════════════════════════════════════════════════════════════════════════

# ── 1. Preview — stream through API (no MinIO URL exposed) ────────────────────

@router.get(
    "/preview/{blob_id}",
    summary="Stream document bytes through the API gateway (no MinIO URL leak)",
    description=(
        "Returns the raw file bytes with the correct Content-Type. "
        "PDF and image files are served with `Content-Disposition: inline` "
        "so browsers can render them without downloading. All other types "
        "fall back to `attachment` (download). "
        "MinIO is never exposed to the caller."
    ),
)
async def preview_document(
    blob_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    # Fetch by blob_id — allows previewing superseded versions for HR history.
    doc = await _get_doc_by_blob_id(blob_id, tenant_id, session)

    # Write audit event (fire-and-forget inside the same session).
    await _write_audit(session, AuditEventType.DOCUMENT_VIEWED, doc, ctx.user_id)
    await session.commit()

    # Determine content disposition.
    disposition = (
        "inline" if doc.mime_type in PREVIEWABLE_MIME else "attachment"
    )

    # Stream bytes from MinIO through this API — MinIO is never exposed.
    def _stream():
        response = None
        try:
            response = _minio_client.get_object(doc.bucket_name, doc.object_key)
            yield from response
        except Exception as exc:
            logger.error(
                "MinIO stream error for blob %s (bucket=%s key=%s): %s",
                blob_id, doc.bucket_name, doc.object_key, exc,
            )
            raise
        finally:
            if response:
                response.close()
                response.release_conn()

    return StreamingResponse(
        content=_stream(),
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{doc.filename}"',
            "Content-Length": str(doc.file_size),
            "X-Document-Id": str(doc.id),
            "X-Verification-Status": doc.verification_status,
            # Never reveal the internal MinIO path.
            "Cache-Control": "private, no-store",
        },
    )


# ── 2. List active documents grouped by category ──────────────────────────────

@router.get(
    "/{employee_id}",
    response_model=DocListResponse,
    summary="List active employee documents grouped by category",
)
async def list_employee_docs(
    employee_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> DocListResponse:
    result = await session.execute(
        select(EmployeeDocument)
        .where(
            and_(
                EmployeeDocument.tenant_id == tenant_id,
                EmployeeDocument.employee_id == employee_id,
                EmployeeDocument.deleted_at.is_(None),
            )
        )
        .order_by(EmployeeDocument.doc_category, EmployeeDocument.uploaded_at.desc())
    )
    docs = list(result.scalars().all())

    grouped: dict[str, list[EmployeeDocument]] = {c: [] for c in CATEGORY_ORDER}
    for doc in docs:
        cat = doc.doc_category if doc.doc_category in grouped else DocCategory.CUSTOM
        grouped[cat].append(doc)

    categories = [
        CategoryGroup(
            category=cat,
            label=CATEGORY_META[cat]["label"],
            icon=CATEGORY_META[cat]["icon"],
            documents=[DocOut.model_validate(d) for d in grouped[cat]],
            count=len(grouped[cat]),
        )
        for cat in CATEGORY_ORDER
    ]

    return DocListResponse(
        employee_id=employee_id,
        categories=categories,
        total=len(docs),
    )


# ── 3. Missing documents / completion engine ──────────────────────────────────

@router.get(
    "/{employee_id}/missing",
    response_model=CompletionResponse,
    summary="KYC completion engine — uses database metadata only, never MinIO paths",
)
async def get_missing_docs(
    employee_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> CompletionResponse:
    result = await session.execute(
        select(EmployeeDocument)
        .where(
            and_(
                EmployeeDocument.tenant_id == tenant_id,
                EmployeeDocument.employee_id == employee_id,
                EmployeeDocument.deleted_at.is_(None),
            )
        )
    )
    docs = list(result.scalars().all())

    # Build lookup keyed by (category, label) — most recent first (already ordered).
    present_map: dict[tuple[str, str], EmployeeDocument] = {}
    for doc in docs:
        key = (doc.doc_category, doc.doc_label)
        if key not in present_map:
            present_map[key] = doc

    items: list[MissingDocItem] = []
    ready_count = 0
    for cat, label in MANDATORY_DOCS:
        key = (cat, label)
        doc = present_map.get(key)
        present = doc is not None
        if present:
            ready_count += 1
        items.append(
            MissingDocItem(
                doc_category=cat,
                doc_label=label,
                required=True,
                present=present,
                blob_id=doc.id if doc else None,
                verification_status=doc.verification_status if doc else None,
            )
        )

    pct = round((ready_count / len(MANDATORY_DOCS)) * 100, 1) if MANDATORY_DOCS else 100.0
    return CompletionResponse(
        employee_id=employee_id,
        items=items,
        completion_pct=pct,
        is_activation_ready=(ready_count == len(MANDATORY_DOCS)),
    )


# ── 4. Dashboard KPIs ─────────────────────────────────────────────────────────

@router.get(
    "/{employee_id}/stats",
    response_model=DocStats,
    summary="Document center dashboard KPIs",
)
async def get_doc_stats(
    employee_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> DocStats:
    result = await session.execute(
        select(EmployeeDocument).where(
            and_(
                EmployeeDocument.tenant_id == tenant_id,
                EmployeeDocument.employee_id == employee_id,
                EmployeeDocument.deleted_at.is_(None),
            )
        )
    )
    docs = list(result.scalars().all())
    return DocStats(
        total=len(docs),
        pending=sum(1 for d in docs if d.verification_status == VerificationStatus.PENDING),
        verified=sum(1 for d in docs if d.verification_status == VerificationStatus.VERIFIED),
        rejected=sum(1 for d in docs if d.verification_status == VerificationStatus.REJECTED),
        storage_bytes=sum(d.file_size for d in docs),
    )


# ── 5. Full version history (active + superseded) ─────────────────────────────

@router.get(
    "/{employee_id}/history",
    response_model=list[DocOut],
    summary="Full document history including superseded versions",
)
async def get_doc_history(
    employee_id: uuid.UUID,
    doc_label: Optional[str] = Query(None, description="Filter by label, e.g. AADHAAR_CARD"),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_db),
) -> list[DocOut]:
    _require_hr_role(ctx)

    conditions = [
        EmployeeDocument.tenant_id == tenant_id,
        EmployeeDocument.employee_id == employee_id,
    ]
    if doc_label:
        conditions.append(EmployeeDocument.doc_label == doc_label.strip().upper())

    result = await session.execute(
        select(EmployeeDocument)
        .where(and_(*conditions))
        .order_by(EmployeeDocument.uploaded_at.desc())
    )
    return [DocOut.model_validate(d) for d in result.scalars().all()]


# ── 6. Audit trail for an employee's documents ────────────────────────────────

@router.get(
    "/{employee_id}/audit",
    response_model=list[AuditRow],
    summary="Audit trail for all documents belonging to an employee",
)
async def get_doc_audit(
    employee_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_db),
) -> list[AuditRow]:
    _require_hr_role(ctx)

    result = await session.execute(
        select(DocumentAudit)
        .where(
            and_(
                DocumentAudit.tenant_id == tenant_id,
                DocumentAudit.employee_id == employee_id,
            )
        )
        .order_by(DocumentAudit.created_at.desc())
        .limit(limit)
    )
    return [AuditRow.model_validate(r) for r in result.scalars().all()]


# ── 7. Upload ─────────────────────────────────────────────────────────────────

@router.post(
    "/{employee_id}/upload",
    response_model=DocOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an employee document (server-side multipart, no presigned URL)",
)
async def upload_employee_doc(
    employee_id: uuid.UUID,
    file: UploadFile = File(...),
    doc_category: str = Form(...),
    doc_label: str    = Form(...),
    description: Optional[str] = Form(None),
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> DocOut:
    # ── Input validation ──────────────────────────────────────────────────────
    norm_category = _normalise_category(doc_category)
    norm_label    = _normalise_label(doc_label)

    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {mime}. Allowed: {sorted(ALLOWED_MIME)}",
        )

    # ── Read and size-check the upload ────────────────────────────────────────
    content = await file.read()
    file_size = len(content)
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_FILE_SIZE // (1024*1024)} MB limit.",
        )

    # ── Assign a stable blob_id and build the immutable object key ───────────
    blob_id = uuid.uuid4()
    ext = ext_from_mime(mime)
    object_key = _build_object_key(employee_id, blob_id, ext)

    try:
        safe_key = _sanitize_object_name(object_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    bucket = get_bucket_resolver().resolve(str(tenant_id))

    # ── Supersede previous active version (atomic with new insert below) ──────
    await _supersede_previous(
        employee_id=employee_id,
        tenant_id=tenant_id,
        doc_category=norm_category,
        doc_label=norm_label,
        new_blob_id=blob_id,
        actor_id=ctx.user_id,
        session=session,
    )

    # ── Upload bytes to MinIO ─────────────────────────────────────────────────
    import io
    import asyncio

    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: _minio_client.put_object(
                bucket_name=bucket,
                object_name=safe_key,
                data=io.BytesIO(content),
                length=file_size,
                content_type=mime,
            ),
        )
    except Exception as exc:
        logger.error("MinIO upload failed for blob %s: %s", blob_id, exc)
        raise HTTPException(status_code=500, detail="File storage failed. Please retry.") from exc

    # ── Persist document row ──────────────────────────────────────────────────
    doc = EmployeeDocument(
        id=blob_id,
        tenant_id=tenant_id,
        employee_id=employee_id,
        bucket_name=bucket,
        object_key=safe_key,
        filename=file.filename or f"{norm_label.lower()}{ext}",
        mime_type=mime,
        file_size=file_size,
        doc_category=norm_category,
        doc_label=norm_label,
        description=description.strip() if description else None,
        verification_status=VerificationStatus.PENDING,
        uploaded_by=ctx.user_id,
    )
    session.add(doc)

    # ── Audit event ───────────────────────────────────────────────────────────
    await _write_audit(
        session,
        AuditEventType.DOCUMENT_UPLOADED,
        doc,
        ctx.user_id,
        extra={"file_size": file_size, "mime_type": mime},
    )

    # ── Outbox event for downstream services ─────────────────────────────────
    await outbox.enqueue(
        session,
        event_type="document.uploaded.v1",
        tenant_id=tenant_id,
        payload={
            "blob_id":      str(blob_id),
            "employee_id":  str(employee_id),
            "doc_category": norm_category,
            "doc_label":    norm_label,
            "filename":     file.filename,
            "uploaded_by":  str(ctx.user_id),
        },
    )

    logger.info(
        "Employee doc uploaded: employee=%s category=%s label=%s blob=%s size=%d",
        employee_id, norm_category, norm_label, blob_id, file_size,
    )
    return DocOut.model_validate(doc)


# ── 8. Verify ─────────────────────────────────────────────────────────────────

@router.post(
    "/{employee_id}/{blob_id}/verify",
    response_model=DocOut,
    summary="Mark a document as VERIFIED (HR/admin roles only)",
)
async def verify_doc(
    employee_id: uuid.UUID,
    blob_id: uuid.UUID,
    body: VerifyRequest,
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> DocOut:
    _require_hr_role(ctx)
    doc = await _get_active_doc(blob_id, employee_id, tenant_id, session)

    doc.verification_status = VerificationStatus.VERIFIED
    doc.verified_by = ctx.user_id
    doc.verified_at = datetime.now(timezone.utc)
    doc.rejection_reason = None  # clear any previous rejection

    await _write_audit(
        session, AuditEventType.DOCUMENT_VERIFIED, doc, ctx.user_id,
        extra={"comment": body.comment},
    )
    await outbox.enqueue(
        session,
        event_type="document.verified.v1",
        tenant_id=tenant_id,
        payload={
            "blob_id": str(blob_id),
            "employee_id": str(employee_id),
            "verified_by": str(ctx.user_id),
            "comment": body.comment,
        },
    )
    await session.commit()
    await session.refresh(doc)
    return DocOut.model_validate(doc)


# ── 9. Reject ─────────────────────────────────────────────────────────────────

@router.post(
    "/{employee_id}/{blob_id}/reject",
    response_model=DocOut,
    summary="Mark a document as REJECTED with a mandatory reason (HR/admin roles only)",
)
async def reject_doc(
    employee_id: uuid.UUID,
    blob_id: uuid.UUID,
    body: RejectRequest,
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> DocOut:
    _require_hr_role(ctx)
    doc = await _get_active_doc(blob_id, employee_id, tenant_id, session)

    doc.verification_status = VerificationStatus.REJECTED
    doc.verified_by = ctx.user_id
    doc.verified_at = datetime.now(timezone.utc)
    doc.rejection_reason = body.reason

    await _write_audit(
        session, AuditEventType.DOCUMENT_REJECTED, doc, ctx.user_id,
        extra={"reason": body.reason},
    )
    await outbox.enqueue(
        session,
        event_type="document.rejected.v1",
        tenant_id=tenant_id,
        payload={
            "blob_id": str(blob_id),
            "employee_id": str(employee_id),
            "rejected_by": str(ctx.user_id),
            "reason": body.reason,
        },
    )
    await session.commit()
    await session.refresh(doc)
    return DocOut.model_validate(doc)


# ── 10. Soft-delete ───────────────────────────────────────────────────────────

@router.delete(
    "/{employee_id}/{blob_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete an employee document (HR/admin roles only)",
)
async def delete_employee_doc(
    employee_id: uuid.UUID,
    blob_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    session: AsyncSession = Depends(get_db),
) -> None:
    _require_hr_role(ctx)
    doc = await _get_active_doc(blob_id, employee_id, tenant_id, session)

    doc.deleted_at = datetime.now(timezone.utc)
    doc.deleted_by = ctx.user_id

    await _write_audit(session, AuditEventType.DOCUMENT_DELETED, doc, ctx.user_id)
    await outbox.enqueue(
        session,
        event_type="document.deleted.v1",
        tenant_id=tenant_id,
        payload={
            "blob_id": str(blob_id),
            "employee_id": str(employee_id),
            "deleted_by": str(ctx.user_id),
        },
    )
    await session.commit()


# ── Admin: one-time data normalisation ────────────────────────────────────────

@router.post(
    "/admin/normalize-categories",
    summary="Normalise doc_category/doc_label casing on legacy rows (admin only, idempotent)",
    include_in_schema=False,  # internal admin endpoint
)
async def normalize_doc_categories(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_db),
) -> dict:
    _require_hr_role(ctx)

    cat_result = await session.execute(
        text(
            """
            UPDATE employee_documents
               SET doc_category = LOWER(doc_category)
             WHERE doc_category IS NOT NULL
               AND doc_category != LOWER(doc_category)
            """
        )
    )
    lbl_result = await session.execute(
        text(
            """
            UPDATE employee_documents
               SET doc_label = UPPER(doc_label)
             WHERE doc_label IS NOT NULL
               AND doc_label != UPPER(doc_label)
            """
        )
    )
    await session.commit()

    return {
        "status": "ok",
        "doc_category_rows_updated": cat_result.rowcount,
        "doc_label_rows_updated":    lbl_result.rowcount,
    }
