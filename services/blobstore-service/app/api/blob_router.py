"""
app/api/blob_router.py

FastAPI router exposing all blob-related endpoints.

Consuming services: reporting-service, payout-service, employee-service
MinIO bucket convention: <tenant_id>-blobs (falls back to MINIO_BUCKET env)

Endpoints
---------
POST   /blobs/upload              – single file upload
POST   /blobs/batch-upload        – multi-file upload with atomic rollback
GET    /blobs                     – paginated, filtered blob listing
GET    /blobs/{id}                – stream raw file bytes
GET    /blobs/{id}/metadata       – lightweight metadata-only (no file transfer)
DELETE /blobs/{id}                – soft delete (default) / hard delete (?permanent=true)
POST   /blobs/{id}/restore        – restore a soft-deleted blob
GET    /blobs/{id}/url            – pre-signed GET URL (query params)
POST   /blobs/{id}/url            – pre-signed GET URL (body, safe from log leakage)
PATCH  /blobs/{id}/tags           – server-side JSONB tag merge
POST   /blobs/file-exists         – check object existence without downloading
POST   /blobs/presigned-url       – presigned POST URL for direct browser-to-MinIO upload
GET    /blobs/notifications        – recent storage events (snapshot from Kafka deque)
GET    /blobs/notifications/stream – Server-Sent Events stream of storage events
"""

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
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
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_context, require_admin, require_tenant
from app.database.db import get_db
from app.schemas.blob_schema import (
    BatchUploadResponse,
    BlobMetadata,
    BlobTagsUpdate,
    ErrorResponse,
    PaginatedBlobList,
    PresignedUrlRequest,
    PresignedUrlResponse,
    UploadResponse,
)
from app.services.blob_service import BlobService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/blobs",
    tags=["Blobs"],
)

# ── Common 429 / 413 response doc entries ──────────────────────────────────────
_429 = {
    429: {
        "model": ErrorResponse,
        "description": "Rate limit exceeded. Retry after the value in the Retry-After response header.",
        "content": {
            "application/json": {
                "example": {"detail": "Rate limit exceeded. Please retry later."}
            }
        },
    }
}
_413 = {
    413: {
        "model": ErrorResponse,
        "description": "Payload Too Large — file exceeds the configured size limit.",
        "content": {
            "application/json": {
                "example": {"detail": "File exceeds configured size limit."}
            }
        },
    }
}


# ── Dependency helper ──────────────────────────────────────────────────────────

def get_blob_service(session: AsyncSession = Depends(get_db)) -> BlobService:
    return BlobService(session)


# Tenant identity is derived from the verified JWT (app.auth.require_tenant).
# The alias keeps the existing `Depends(_require_tenant)` call sites unchanged
# while routing them through real token verification instead of a trusted header.
_require_tenant = require_tenant


# ── Single Upload ──────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a single file",
    description=(
        "Upload a file to MinIO object storage and persist its metadata in PostgreSQL.\n\n"
        "- **X-Tenant-Id** (required header): UUID identifying the tenant that owns this blob. "
        "Cross-validated against the calling service's JWT `tenant_id` claim.\n"
        "- **uploaded_by**: UUID of the calling **service** (not a user UUID).\n"
        "- **file**: The multipart file binary."
    ),
    responses={
        400: {
            "model": ErrorResponse,
            "description": "Invalid file type or empty file",
            "content": {
                "application/json": {
                    "example": {"detail": "Invalid file type or empty file."}
                }
            },
        },
        **_413,
        422: {
            "model": ErrorResponse,
            "description": "Missing or invalid X-Tenant-Id header",
            "content": {
                "application/json": {
                    "example": {"detail": "X-Tenant-Id header is required."}
                }
            },
        },
        **_429,
        500: {
            "model": ErrorResponse,
            "description": "Storage or database error",
            "content": {
                "application/json": {
                    "example": {"detail": "Object storage upload failed. Please try again later."}
                }
            },
        },
    },
)
async def upload_blob(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Binary file to upload"),
    doc_type: str = Form("raw", description="Document type used for bucket routing"),
    employee_id: str | None = Form(None, description="Optional employee ID for object key partitioning"),
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> UploadResponse:
    # uploaded_by is taken from the verified token, never from a client field.
    logger.info(
        "POST /blobs/upload – file='%s' tenant=%s uploaded_by=%s",
        file.filename, tenant_id, ctx.user_id,
    )
    return await service.upload(
        file=file,
        uploaded_by=ctx.user_id,
        tenant_id=tenant_id,
        doc_type=doc_type,
        employee_id=employee_id,
        background_tasks=background_tasks,
    )


# ── Batch Upload ───────────────────────────────────────────────────────────────

@router.post(
    "/batch-upload",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Batch upload multiple files",
    description=(
        "Upload up to `MAX_BATCH_FILES` (default 10) files in a single request.\n\n"
        "All file sizes and content-types are validated **before** any write to MinIO. "
        "If any file fails mid-batch, all already-uploaded files are rolled back atomically.\n\n"
        "Useful for payroll workflows (e.g. PF ECR + ESI + Form 16 in one call)."
    ),
    responses={
        400: {
            "model": ErrorResponse,
            "description": "Invalid file type or size in batch",
            "content": {
                "application/json": {
                    "example": {"detail": "Invalid file type or size in batch."}
                }
            },
        },
        **_413,
        422: {
            "model": ErrorResponse,
            "description": "Batch exceeds MAX_BATCH_FILES limit",
            "content": {
                "application/json": {
                    "example": {"detail": "Batch exceeds maximum of 10 files."}
                }
            },
        },
        **_429,
        500: {
            "model": ErrorResponse,
            "description": "Storage or database error",
            "content": {
                "application/json": {
                    "example": {"detail": "Metadata persistence failed. The upload has been rolled back."}
                }
            },
        },
    },
)
async def batch_upload_blobs(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(..., description="List of files to upload"),
    ctx: RequestContext = Depends(get_context),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> BatchUploadResponse:
    # uploaded_by is taken from the verified token, never from a client field.
    logger.info(
        "POST /blobs/batch-upload – %d files tenant=%s uploaded_by=%s",
        len(files), tenant_id, ctx.user_id,
    )
    return await service.batch_upload(
        files=files,
        uploaded_by=ctx.user_id,
        tenant_id=tenant_id,
        background_tasks=background_tasks,
    )


# ── List (paginated, filtered) ─────────────────────────────────────────────────

@router.get(
    "",
    response_model=PaginatedBlobList,
    summary="List blobs (paginated)",
    description=(
        "Return a paginated list of active blob metadata records.\n\n"
        "Use `page` and `page_size` for pagination. Use filter params to narrow results. "
        "Soft-deleted blobs are never included."
    ),
    responses={
        **_429,
    },
)
async def list_blobs(
    limit: int = Query(20, ge=1, le=100, description="Maximum records to return"),
    cursor: Optional[str] = Query(None, description="Opaque cursor from a previous page's next_cursor"),
    content_type: Optional[str] = Query(None, description="Filter by MIME type (e.g. application/pdf)"),
    uploaded_by: Optional[uuid.UUID] = Query(None, description="Filter by uploading user UUID"),
    created_after: Optional[datetime] = Query(None, description="Filter blobs created after this ISO 8601 timestamp"),
    created_before: Optional[datetime] = Query(None, description="Filter blobs created before this ISO 8601 timestamp"),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> PaginatedBlobList:
    logger.debug("GET /blobs – tenant=%s limit=%d cursor=%s", tenant_id, limit, cursor)
    items, next_cursor = await service.list_blobs(
        tenant_id=tenant_id,
        limit=limit,
        cursor=cursor,
        content_type=content_type,
        uploaded_by=uploaded_by,
        created_after=created_after,
        created_before=created_before,
    )
    return PaginatedBlobList(
        items=[BlobMetadata.model_validate(b) for b in items],
        count=len(items),
        limit=limit,
        next_cursor=next_cursor,
    )

# ── Notifications (Kafka → deque → SSE) — MUST be registered before /{blob_id} ──

import asyncio as _asyncio
import json as _json


@router.get(
    "/notifications",
    summary="Recent storage events (snapshot)",
    tags=["Notifications"],
    description=(
        "Return a JSON snapshot of the last up-to-50 MinIO bucket events "
        "received via Kafka.  Events include `put` (upload) and `delete` "
        "operations on any bucket.\n\n"
        "For a live stream, use `GET /blobs/notifications/stream` (SSE)."
    ),
)
async def get_notifications(
    _admin: RequestContext = Depends(require_admin),
) -> dict:
    from app.events.event_consumer import event_queue

    events = list(event_queue)
    return {"notifications": events, "count": len(events)}


@router.get(
    "/notifications/stream",
    summary="Server-Sent Events stream of storage events",
    tags=["Notifications"],
    description=(
        "Open an SSE connection that pushes new MinIO bucket events to the client "
        "as they arrive from Kafka.  Events are polled from the in-memory deque "
        "every 500 ms.\n\n"
        "Response content-type: `text/event-stream`."
    ),
)
async def stream_notifications(
    _admin: RequestContext = Depends(require_admin),
) -> StreamingResponse:
    from app.events.event_consumer import event_queue

    async def _generator():
        seen = 0
        while True:
            current = list(event_queue)
            new_count = len(current) - seen
            if new_count > 0:
                for event in reversed(current[:new_count]):
                    yield f"data: {_json.dumps(event)}\n\n"
                seen = len(current)
            await _asyncio.sleep(0.5)

    return StreamingResponse(
        _generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Download (stream) ──────────────────────────────────────────────────────────

@router.get(
    "/{blob_id}",
    summary="Download a file",
    description=(
        "Stream the raw binary content of a blob directly from MinIO.\n\n"
        "Response is a binary octet-stream with the original `Content-Type` and a "
        "`Content-Disposition: attachment` header so browsers trigger a file download."
    ),
    responses={
        200: {
            "description": "Binary file stream",
            "content": {"application/octet-stream": {}},
        },
        404: {"model": ErrorResponse, "description": "Blob not found or soft-deleted"},
        500: {"model": ErrorResponse, "description": "Storage retrieval error"},
    },
)
async def download_blob(
    blob_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> StreamingResponse:
    logger.info("GET /blobs/%s – streaming download tenant=%s", blob_id, tenant_id)
    blob = await service.get_blob_metadata(blob_id, tenant_id)
    await service.record_download(blob)
    stream = service.stream_blob(blob)

    return StreamingResponse(
        content=stream,
        media_type=blob.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{blob.file_name}"',
            "Content-Length": str(blob.size),
            "X-Blob-Id": str(blob.id),
            "ETag": str(blob.id),  # stable opaque identifier for client caching
        },
    )


# ── Metadata only (no file transfer) ──────────────────────────────────────────

@router.get(
    "/{blob_id}/metadata",
    response_model=BlobMetadata,
    summary="Get blob metadata (lightweight)",
    description=(
        "Return only the metadata row for a blob — no file bytes transferred.\n\n"
        "Useful for services that need to check file existence, tags, or size "
        "before initiating a download or regenerating a report."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found or soft-deleted"},
    },
)
async def get_blob_metadata(
    blob_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> BlobMetadata:
    logger.debug("GET /blobs/%s/metadata tenant=%s", blob_id, tenant_id)
    blob = await service.get_blob_metadata(blob_id, tenant_id)
    return BlobMetadata.model_validate(blob)


# ── Version history ──────────────────────────────────────────────────────────

@router.get(
    "/{blob_id}/versions",
    summary="List blob versions",
    description=(
        "Return the MinIO version history for a blob (newest first), scoped to "
        "the caller's tenant. Requires versioning to be enabled on the bucket "
        "(applied automatically at bucket provisioning)."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found or soft-deleted"},
    },
)
async def list_blob_versions(
    blob_id: uuid.UUID,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> dict:
    logger.debug("GET /blobs/%s/versions tenant=%s", blob_id, tenant_id)
    versions = await service.get_blob_versions(blob_id, tenant_id)
    return {"blob_id": str(blob_id), "versions": versions, "count": len(versions)}


# ── Delete ─────────────────────────────────────────────────────────────────────

@router.delete(
    "/{blob_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a blob",
    description=(
        "Delete a blob.\n\n"
        "**Default (soft delete):** Sets `deleted_at` timestamp. MinIO object is "
        "retained. Blob is hidden from all listings and can be restored via "
        "`POST /blobs/{id}/restore`. Objects are permanently purged after "
        "`SOFT_DELETE_RETENTION_DAYS` days (default 30) by the scheduled cleanup job.\n\n"
        "**Hard delete** (`?permanent=true`): Removes the MinIO object and the "
        "database row immediately. This action is **irreversible**."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found"},
        500: {"model": ErrorResponse, "description": "Storage deletion error (hard delete only)"},
    },
)
async def delete_blob(
    blob_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    permanent: bool = Query(False, description="Set true for immediate hard-delete (irreversible)"),
    _admin: RequestContext = Depends(require_admin),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> None:
    logger.info("DELETE /blobs/%s permanent=%s tenant=%s", blob_id, permanent, tenant_id)
    await service.delete_blob(
        blob_id, tenant_id, permanent=permanent, background_tasks=background_tasks
    )


# ── Restore ────────────────────────────────────────────────────────────────────

@router.post(
    "/{blob_id}/restore",
    response_model=BlobMetadata,
    status_code=status.HTTP_200_OK,
    summary="Restore a soft-deleted blob",
    description="Clear the `deleted_at` timestamp, making the blob active again.",
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found"},
    },
)
async def restore_blob(
    blob_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    _admin: RequestContext = Depends(require_admin),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> BlobMetadata:
    logger.info("POST /blobs/%s/restore tenant=%s", blob_id, tenant_id)
    blob = await service.restore_blob(blob_id, tenant_id, background_tasks=background_tasks)
    return BlobMetadata.model_validate(blob)


# ── Pre-signed URL (GET) ───────────────────────────────────────────────────────

@router.get(
    "/{blob_id}/url",
    response_model=PresignedUrlResponse,
    summary="Get a pre-signed download URL",
    description=(
        "Generate a time-limited pre-signed GET URL for direct MinIO access.\n\n"
        "The `expires_in_seconds` value is capped at `PRESIGNED_URL_MAX_EXPIRY_SECONDS` "
        "(default 86400 = 24 h). For sensitive parameters, prefer the POST variant to "
        "avoid URL leakage in server logs or browser history."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found"},
        500: {"model": ErrorResponse, "description": "URL generation error"},
    },
)
async def get_presigned_url(
    blob_id: uuid.UUID,
    expires_in_seconds: Optional[int] = Query(
        None,
        ge=1,
        description="Desired URL lifetime in seconds (server caps at PRESIGNED_URL_MAX_EXPIRY_SECONDS)",
    ),
    inline: bool = Query(False, description="Set content disposition to inline instead of attachment"),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> PresignedUrlResponse:
    logger.debug("GET /blobs/%s/url expires_in=%s inline=%s tenant=%s", blob_id, expires_in_seconds, inline, tenant_id)
    return await service.get_presigned_url(blob_id, tenant_id, expires_in_seconds=expires_in_seconds, inline=inline)


# ── Pre-signed URL (POST) ──────────────────────────────────────────────────────

@router.post(
    "/{blob_id}/url",
    response_model=PresignedUrlResponse,
    status_code=status.HTTP_200_OK,
    summary="Get a pre-signed download URL (via POST body)",
    description=(
        "Same as `GET /blobs/{id}/url` but accepts parameters in a JSON request body, "
        "preventing expiry values from appearing in server logs, proxy logs, or browser history."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found"},
        500: {"model": ErrorResponse, "description": "URL generation error"},
    },
)
async def post_presigned_url(
    blob_id: uuid.UUID,
    body: PresignedUrlRequest,
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> PresignedUrlResponse:
    logger.debug("POST /blobs/%s/url expires_in=%s inline=%s tenant=%s", blob_id, body.expires_in_seconds, body.inline, tenant_id)
    return await service.get_presigned_url(blob_id, tenant_id, expires_in_seconds=body.expires_in_seconds, inline=body.inline)


# ── Tags (PATCH) ───────────────────────────────────────────────────────────────

@router.patch(
    "/{blob_id}/tags",
    response_model=BlobMetadata,
    summary="Update blob tags",
    description=(
        "Update the `tags` JSONB field for a blob using a **server-side merge** "
        "(PostgreSQL `||` operator) — no read-modify-write race condition.\n\n"
        "**Default (merge):** New keys are added; existing keys are overwritten at the "
        "top level. Nested dicts are NOT recursively merged.\n\n"
        "**Replace mode** (`?replace=true`): The entire `tags` dict is replaced with the "
        "supplied value. Use with care — all existing annotations are lost."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Blob not found"},
    },
)
async def patch_blob_tags(
    blob_id: uuid.UUID,
    body: BlobTagsUpdate,
    replace: bool = Query(False, description="Replace entire tags dict instead of merging"),
    tenant_id: uuid.UUID = Depends(_require_tenant),
    service: BlobService = Depends(get_blob_service),
) -> BlobMetadata:
    logger.info("PATCH /blobs/%s/tags replace=%s tenant=%s", blob_id, replace, tenant_id)
    blob = await service.update_tags(blob_id, body.tags, tenant_id, replace=replace)
    return BlobMetadata.model_validate(blob)


# ── File Existence Check ────────────────────────────────────────────────────────────────────

@router.post(
    "/file-exists",
    summary="Check file existence",
    description=(
        "Check whether an object exists in a MinIO bucket without downloading it.\n\n"
        "Uses a lightweight `stat_object()` HEAD request — no data is transferred.\n\n"
        "Used by `reporting-service` to avoid regenerating a PF ECR file that was "
        "already produced and stored."
    ),
    responses={
        200: {"description": "Existence check result"},
    },
)
async def file_exists(
    object_name: str = Query(..., description="Object key within the caller's tenant bucket"),
    tenant_id: uuid.UUID = Depends(_require_tenant),
) -> dict:
    from app.storage.minio_client import _sanitize_object_name, blob_store, get_bucket_resolver

    # Bucket is always derived from the caller's tenant — never accepted from the
    # client — so existence probing cannot cross tenant boundaries.
    bucket_name = get_bucket_resolver().resolve(str(tenant_id))
    try:
        safe_key = _sanitize_object_name(object_name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    logger.debug("POST /blobs/file-exists tenant=%s key=%s", tenant_id, safe_key)
    exists = await blob_store.file_exists(bucket_name, safe_key)
    return {"exists": exists, "bucket": bucket_name, "key": safe_key}


# ── Presigned POST URL (direct browser → MinIO upload) ──────────────────────

from pydantic import BaseModel as _BaseModel


class PresignedPostRequest(_BaseModel):
    """Request body for POST /blobs/presigned-url.

    Note: the target bucket is **always** derived from the caller's tenant
    (``X-Tenant-Id``) — a client-supplied bucket is never honoured.
    """
    object_name: str
    expires_in: int = 300
    tags: dict | None = None


@router.post(
    "/presigned-url",
    summary="Generate presigned POST URL",
    description=(
        "Return a presigned POST policy `{ url, fields }` that lets a client "
        "upload a file **directly** to MinIO without routing bytes through FastAPI.\n\n"
        "Critical for large Form 16 PDFs where proxying through the API would be wasteful.\n\n"
        "The returned `url` and `fields` dict are passed directly to an HTML form "
        "or a `fetch()` with `FormData`."
    ),
    responses={
        400: {"model": ErrorResponse, "description": "expires_in exceeds server cap"},
    },
)
async def presigned_post_url(
    body: PresignedPostRequest,
    tenant_id: uuid.UUID = Depends(_require_tenant),
) -> dict:
    from app.config import get_settings
    from app.storage.minio_client import _sanitize_object_name, blob_store, get_bucket_resolver
    _settings = get_settings()

    if body.expires_in > _settings.PRESIGNED_URL_MAX_EXPIRY_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"expires_in exceeds server cap of {_settings.PRESIGNED_URL_MAX_EXPIRY_SECONDS}s.",
        )

    # Bucket is resolved from the caller's tenant; the upload key is sanitized so
    # the presigned POST can only ever write inside this tenant's bucket.
    bucket = get_bucket_resolver().resolve(str(tenant_id))
    try:
        safe_key = _sanitize_object_name(body.object_name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    tags = dict(body.tags or {})
    tags["tenant_id"] = str(tenant_id)

    logger.debug(
        "POST /blobs/presigned-url tenant=%s bucket=%s key=%s expires=%ds",
        tenant_id, bucket, safe_key, body.expires_in,
    )
    result = await blob_store.generate_presigned_post(
        bucket=bucket,
        object_name=safe_key,
        expires_in=body.expires_in,
        tags=tags or None,
    )
    return result  # {"url": str, "fields": dict}



