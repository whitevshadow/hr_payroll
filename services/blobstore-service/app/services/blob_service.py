"""
app/services/blob_service.py

Business logic layer that orchestrates between the repository (PostgreSQL)
and the MinIO storage client.  Encapsulates:
- File size and content-type validation
- Upload pipeline (single + batch with atomic rollback)
- Download streaming
- Soft-delete / hard-delete / restore
- Pre-signed URL generation (with configurable expiry cap)
- Tags update (delegated to server-side JSONB merge)
- Expired blob purge (called by the scheduler)
- Audit event emission (fire-and-forget background tasks)
"""

import asyncio
import hashlib
import logging
import uuid
from collections.abc import Sequence
from datetime import datetime, timezone

import httpx
from fastapi import BackgroundTasks, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.events import outbox
from app.models.blob_model import Blob
from app.repositories.blob_repository import BlobRepository
from app.schemas.blob_schema import (
    BatchUploadResponse,
    PresignedUrlResponse,
    UploadResponse,
)
from app.storage import minio_client as minio

logger = logging.getLogger(__name__)
settings = get_settings()


# ── Keyset cursor helpers ──────────────────────────────────────────────────────

def _encode_cursor(uploaded_at: datetime, blob_id: uuid.UUID) -> str:
    """Encode a ``(uploaded_at, id)`` pair into an opaque base64 cursor."""
    import base64

    raw = f"{uploaded_at.isoformat()}|{blob_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def _decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    """Decode an opaque cursor back into ``(uploaded_at, id)``; None if absent/invalid."""
    if not cursor:
        return None
    import base64

    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        ts_str, id_str = raw.rsplit("|", 1)
        return datetime.fromisoformat(ts_str), uuid.UUID(id_str)
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid pagination cursor."
        ) from None


# ── Audit helper ───────────────────────────────────────────────────────────────

async def _emit_audit_event(
    action: str,
    blob_id: uuid.UUID,
    tenant_id: uuid.UUID,
    performed_by: uuid.UUID,
) -> None:
    """
    Fire-and-forget audit event to the audit-service ingest endpoint.

    Failures are logged and silently swallowed — audit events must never
    break the primary operation.
    """
    payload = {
        "service": "blobstore-service",
        "action": action,
        "blob_id": str(blob_id),
        "tenant_id": str(tenant_id),
        "performed_by": str(performed_by),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        audit_url = getattr(settings, "AUDIT_SERVICE_URL", None)
        if not audit_url:
            logger.debug("AUDIT_SERVICE_URL not configured; skipping audit event.")
            return
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(f"{audit_url}/audit/ingest", json=payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Audit event emission failed (action=%s blob=%s): %s", action, blob_id, exc)


class BlobService:
    """High-level operations on blobs (upload, download, list, delete, tags, purge)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = BlobRepository(session)

    # ── Upload (single) ─────────────────────────────────────────────────────────

    async def upload(
        self,
        file: UploadFile,
        uploaded_by: uuid.UUID,
        tenant_id: uuid.UUID,
        doc_type: str = "raw",
        employee_id: str | None = None,
        background_tasks: BackgroundTasks | None = None,
        tags: dict | None = None,
    ) -> UploadResponse:
        """
        Validate, upload to MinIO, and persist metadata.

        Raises
        ------
        HTTPException 400  – content-type is disallowed or file is empty.
        HTTPException 413  – file exceeds the configured size limit.
        HTTPException 500  – MinIO upload or database write fails.
        """
        self._validate_content_type(file.content_type)

        file_bytes = await file.read()
        file_size = len(file_bytes)
        self._validate_file_size(file_size)

        # Antivirus gate (no-op unless VIRUS_SCAN_ENABLED) — runs before storage.
        from app.storage.virus_scan import scan_or_raise
        await scan_or_raise(file_bytes)

        logger.info(
            "Uploading file='%s' content_type='%s' size=%d bytes tenant=%s by=%s",
            file.filename, file.content_type, file_size, tenant_id, uploaded_by,
        )

        blob_id = uuid.uuid4()
        # Integrity checksum is computed over the exact bytes we store, so a
        # later download can be validated against it.
        checksum = f"sha256:{hashlib.sha256(file_bytes).hexdigest()}"

        # ── Storage ──────────────────────────────────────────────────────────
        try:
            object_key, bucket_name, folder, etag, version_id = minio.upload_object(
                data=file_bytes,
                content_type=file.content_type,
                original_filename=file.filename or "unknown",
                tenant_id=str(tenant_id),
                doc_type=doc_type,
                blob_id=str(blob_id),
                employee_id=employee_id,
            )
        except Exception as exc:
            logger.exception("MinIO upload failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Object storage upload failed. Please try again later.",
            ) from exc

        # ── Metadata ─────────────────────────────────────────────────────────
        parsed_employee_id = None
        if employee_id:
            try:
                parsed_employee_id = uuid.UUID(employee_id)
            except ValueError:
                logger.warning("employee_id %s is not a valid UUID", employee_id)

        try:
            blob: Blob = await self._repo.create(
                blob_id=blob_id,
                file_name=file.filename or "unknown",
                mime_type=file.content_type or "application/octet-stream",
                document_type=(doc_type or "CUSTOM").strip().upper(),
                bucket_name=bucket_name,
                object_key=object_key,
                folder=folder,
                size=file_size,
                etag=etag,
                version=version_id,
                checksum=checksum,
                uploaded_by=uploaded_by,
                tenant_id=tenant_id,
                employee_id=parsed_employee_id,
                tags={
                    **(tags or {}),
                    "doc_type": (doc_type or "CUSTOM").strip().upper(),
                    "tenant_id": str(tenant_id),
                    **({"employee_id": employee_id} if employee_id else {}),
                },
            )
        except Exception as exc:
            logger.exception("Database write failed after upload: %s", exc)
            try:
                minio.delete_object(object_key, bucket_name)
            except Exception as rollback_exc:  # noqa: BLE001
                logger.error(
                    "Failed to rollback MinIO object '%s' after DB error: %s",
                    object_key, rollback_exc,
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Metadata persistence failed. The upload has been rolled back.",
            ) from exc

        # Durable event via the transactional outbox (survives Kafka downtime).
        await outbox.enqueue(
            self._session,
            event_type="blob.created.v1",
            tenant_id=tenant_id,
            payload={
                "blob_id": str(blob.id),
                "file_name": blob.file_name,
                "mime_type": blob.mime_type,
                "document_type": blob.document_type,
                "bucket_name": blob.bucket_name,
                "object_key": blob.object_key,
                "folder": blob.folder,
                "size": blob.size,
                "etag": blob.etag,
                "version": blob.version,
                "checksum": blob.checksum,
                "employee_id": str(blob.employee_id) if blob.employee_id else None,
                "uploaded_by": str(uploaded_by),
                "tags": blob.tags,
            },
        )
        if background_tasks is not None:
            background_tasks.add_task(
                _emit_audit_event, "blob_uploaded", blob.id, tenant_id, uploaded_by
            )

        return UploadResponse(
            blob_id=blob.id,
            file_name=blob.file_name,
            object_key=blob.object_key,
        )

    # ── Batch Upload ────────────────────────────────────────────────────────────

    async def batch_upload(
        self,
        files: list[UploadFile],
        uploaded_by: uuid.UUID,
        tenant_id: uuid.UUID,
        background_tasks: BackgroundTasks | None = None,
    ) -> BatchUploadResponse:
        """
        Upload multiple files atomically.

        Strategy
        --------
        1. Validate ALL file sizes and content-types before any write.
        2. Upload files sequentially; track successes.
        3. If any upload fails, call ``delete_blob`` on all successes so far
           before returning the failure response.

        Raises
        ------
        HTTPException 400  – any file fails content-type or size validation.
        HTTPException 413  – any file exceeds the configured size limit.
        HTTPException 422  – batch exceeds ``MAX_BATCH_FILES``.
        """
        if len(files) > settings.MAX_BATCH_FILES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Batch exceeds maximum of {settings.MAX_BATCH_FILES} files.",
            )

        # ── Phase 1: Validate everything before any write ──────────────────────
        file_data: list[tuple[UploadFile, bytes]] = []
        for f in files:
            self._validate_content_type(f.content_type)
            data = await f.read()
            self._validate_file_size(len(data))
            file_data.append((f, data))

        # ── Phase 2: Upload with rollback on failure ───────────────────────────
        successful: list[UploadResponse] = []
        failed_count = 0

        for f, data in file_data:
            # Reconstruct an UploadFile-like interface by re-seeking bytes
            import io
            f.file = io.BytesIO(data)  # type: ignore[assignment]
            f._size = len(data)  # type: ignore[attr-defined]

            try:
                response = await self.upload(
                    file=f,
                    uploaded_by=uploaded_by,
                    tenant_id=tenant_id,
                    doc_type="raw",
                    background_tasks=background_tasks,
                )
                successful.append(response)
            except HTTPException:
                failed_count += 1
                # Rollback all successful uploads from this batch
                logger.warning(
                    "Batch upload failure at file '%s'; rolling back %d already-uploaded files.",
                    f.filename, len(successful),
                )
                for prev in successful:
                    try:
                        await self.delete_blob(
                            prev.blob_id, tenant_id, uploaded_by=uploaded_by, permanent=True
                        )
                    except Exception as rb_exc:  # noqa: BLE001
                        logger.error("Rollback failed for blob %s: %s", prev.blob_id, rb_exc)
                raise  # Re-raise so router returns 4xx/5xx to caller

        return BatchUploadResponse(uploads=successful, failed=failed_count)

    # ── Download ────────────────────────────────────────────────────────────────

    async def get_blob_metadata(
        self, blob_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> Blob:
        """
        Fetch blob metadata scoped to *tenant_id* (active blobs only).

        Raises
        ------
        HTTPException 404 – no active record with *blob_id* exists for this tenant.
        """
        blob = await self._repo.get_by_id(blob_id, tenant_id)
        if blob is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Blob {blob_id} not found.",
            )
        return blob

    def stream_blob(self, blob: Blob):
        """
        Return a generator that yields raw bytes from MinIO.

        Raises
        ------
        HTTPException 500 – if the MinIO retrieval fails.
        """
        try:
            return minio.download_object_stream(
                object_name=blob.object_key,
                bucket_name=blob.bucket_name,
            )
        except Exception as exc:
            logger.exception(
                "Failed to stream object '%s' from MinIO: %s", blob.object_key, exc
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve object from storage.",
            ) from exc

    # ── List ────────────────────────────────────────────────────────────────────

    async def list_blobs(
        self,
        *,
        tenant_id: uuid.UUID,
        limit: int = 20,
        cursor: str | None = None,
        content_type: str | None = None,
        uploaded_by: uuid.UUID | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> tuple[Sequence[Blob], str | None]:
        """
        Return a keyset-paginated, filtered page of active blobs for *tenant_id*.

        Returns ``(items, next_cursor)``; *next_cursor* is ``None`` on the last page.
        """
        decoded = _decode_cursor(cursor)
        # Fetch one extra row to detect whether another page exists.
        items = list(
            await self._repo.list_keyset(
                tenant_id=tenant_id,
                limit=limit + 1,
                cursor=decoded,
                content_type=content_type,
                uploaded_by=uploaded_by,
                created_after=created_after,
                created_before=created_before,
            )
        )
        next_cursor: str | None = None
        if len(items) > limit:
            items = items[:limit]
            last = items[-1]
            next_cursor = _encode_cursor(last.uploaded_at, last.id)
        return items, next_cursor

    # ── Delete ──────────────────────────────────────────────────────────────────

    async def delete_blob(
        self,
        blob_id: uuid.UUID,
        tenant_id: uuid.UUID,
        *,
        uploaded_by: uuid.UUID | None = None,
        permanent: bool = False,
        background_tasks: BackgroundTasks | None = None,
    ) -> None:
        """
        Delete a blob.

        Parameters
        ----------
        permanent
            ``False`` (default) — soft delete: set ``is_deleted=True``, keep MinIO object.
            ``True``            — hard delete: remove from MinIO **and** delete the DB row.

        Raises
        ------
        HTTPException 404 – blob not found or already active (for restore logic).
        HTTPException 500 – MinIO deletion fails (hard delete only).
        """
        blob = await self.get_blob_metadata(blob_id, tenant_id)
        performer = uploaded_by or blob.uploaded_by

        if permanent:
            try:
                minio.delete_object(
                    object_name=blob.object_key,
                    bucket_name=blob.bucket_name,
                )
            except Exception as exc:
                logger.exception(
                    "Failed to delete object '%s' from MinIO: %s", blob.object_key, exc
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to delete object from storage.",
                ) from exc

            await self._repo.delete(blob)
            logger.info("Blob %s permanently deleted (storage + metadata).", blob_id)
            action = "blob_hard_deleted"
        else:
            await self._repo.soft_delete(blob)
            logger.info("Blob %s soft-deleted (metadata only; MinIO object retained).", blob_id)
            action = "blob_soft_deleted"

        await outbox.enqueue(
            self._session,
            event_type="blob.deleted.v1",
            tenant_id=blob.tenant_id,
            payload={
                "blob_id": str(blob_id),
                "permanent": permanent,
                "object_key": blob.object_key,
                "performed_by": str(performer),
            },
        )
        if background_tasks is not None:
            background_tasks.add_task(
                _emit_audit_event, action, blob_id, blob.tenant_id, performer
            )

    # ── Restore ─────────────────────────────────────────────────────────────────

    async def restore_blob(
        self,
        blob_id: uuid.UUID,
        tenant_id: uuid.UUID,
        *,
        performed_by: uuid.UUID | None = None,
        background_tasks: BackgroundTasks | None = None,
    ) -> Blob:
        """
        Restore a soft-deleted blob owned by *tenant_id* by clearing its deleted flags.

        Raises
        ------
        HTTPException 404 – blob not found for this tenant.
        """
        blob = await self._repo.restore(blob_id, tenant_id)
        if blob is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Blob {blob_id} not found.",
            )
        performer = performed_by or blob.uploaded_by
        await outbox.enqueue(
            self._session,
            event_type="blob.restored.v1",
            tenant_id=blob.tenant_id,
            payload={"blob_id": str(blob_id), "performed_by": str(performer)},
        )
        if background_tasks is not None:
            background_tasks.add_task(
                _emit_audit_event, "blob_restored", blob_id, blob.tenant_id, performer
            )
        logger.info("Blob %s restored.", blob_id)
        return blob

    # ── Pre-signed URL ──────────────────────────────────────────────────────────

    async def get_presigned_url(
        self,
        blob_id: uuid.UUID,
        tenant_id: uuid.UUID,
        expires_in_seconds: int | None = None,
        inline: bool = False,
    ) -> PresignedUrlResponse:
        """
        Generate a temporary pre-signed download URL for *blob_id*.

        The ``expires_in_seconds`` is capped at ``PRESIGNED_URL_MAX_EXPIRY_SECONDS``
        to prevent indefinitely valid links being shared.

        Raises
        ------
        HTTPException 404 – blob not found.
        HTTPException 500 – URL generation fails.
        """
        blob = await self.get_blob_metadata(blob_id, tenant_id)

        # Cap expiry
        requested = expires_in_seconds or settings.PRESIGNED_URL_EXPIRY_SECONDS
        expiry = min(requested, settings.PRESIGNED_URL_MAX_EXPIRY_SECONDS)
        if expiry != requested:
            logger.info(
                "Presigned URL expiry capped from %ds to %ds for blob %s",
                requested, expiry, blob_id,
            )

        try:
            url = minio.generate_presigned_url(
                object_name=blob.object_key,
                bucket_name=blob.bucket_name,
                expiry_seconds=expiry,
                inline=inline,
            )
        except Exception as exc:
            logger.exception("Presigned URL generation failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not generate a download URL.",
            ) from exc

        return PresignedUrlResponse(
            blob_id=blob_id,
            url=url,
            expires_in_seconds=expiry,
        )

    # ── Tags ─────────────────────────────────────────────────────────────────────

    async def update_tags(
        self,
        blob_id: uuid.UUID,
        new_tags: dict,
        tenant_id: uuid.UUID,
        *,
        replace: bool = False,
    ) -> Blob:
        """
        Update tags for a blob owned by *tenant_id* using a server-side
        PostgreSQL JSONB merge (no read-modify-write).

        Raises
        ------
        HTTPException 404 – blob not found for this tenant.
        """
        blob = await self._repo.update_tags(blob_id, new_tags, tenant_id, replace=replace)
        if blob is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Blob {blob_id} not found.",
            )
        await outbox.enqueue(
            self._session,
            event_type="blob.updated.v1",
            tenant_id=tenant_id,
            payload={"blob_id": str(blob_id), "tags": blob.tags, "replace": replace},
        )
        return blob

    # ── Versions ─────────────────────────────────────────────────────────────────

    async def get_blob_versions(
        self, blob_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> list[dict]:
        """Return the MinIO version history for a tenant's blob."""
        blob = await self.get_blob_metadata(blob_id, tenant_id)
        try:
            return await asyncio.to_thread(
                minio.list_object_versions, blob.bucket_name, blob.object_key
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to list versions for blob %s: %s", blob_id, exc)
            return []

    # ── Download audit event ─────────────────────────────────────────────────────

    async def record_download(self, blob: Blob) -> None:
        """Emit a durable ``blob.downloaded.v1`` event for audit purposes."""
        await outbox.enqueue(
            self._session,
            event_type="blob.downloaded.v1",
            tenant_id=blob.tenant_id,
            payload={
                "blob_id": str(blob.id),
                "object_key": blob.object_key,
                "document_type": blob.document_type,
            },
        )

    # ── Scheduled Purge ──────────────────────────────────────────────────────────

    async def purge_expired_blobs(self) -> int:
        """
        Hard-delete blobs that have been soft-deleted for longer than
        ``SOFT_DELETE_RETENTION_DAYS``.  Called by the APScheduler daily job.

        Returns the number of blobs purged.
        """
        expired = await self._repo.get_expired_soft_deleted(
            settings.SOFT_DELETE_RETENTION_DAYS
        )
        if not expired:
            logger.info("Purge job: no expired blobs to clean up.")
            return 0

        minio_errors = 0
        for blob in expired:
            try:
                minio.delete_object(
                    object_name=blob.object_key,
                    bucket_name=blob.bucket_name,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Purge: failed to delete MinIO object '%s': %s", blob.object_key, exc
                )
                minio_errors += 1

        ids = [b.id for b in expired]
        purged = await self._repo.hard_delete_by_ids(ids)
        logger.info(
            "Purge job complete: %d rows deleted, %d MinIO errors.", purged, minio_errors
        )
        return purged

    # ── Private helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _validate_content_type(content_type: str | None) -> None:
        if not content_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Content-Type header is required.",
            )
        if content_type not in settings.ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Content type '{content_type}' is not allowed. "
                    f"Accepted types: {', '.join(settings.ALLOWED_CONTENT_TYPES)}"
                ),
            )

    @staticmethod
    def _validate_file_size(file_size: int) -> None:
        if file_size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty.",
            )
        if file_size > settings.MAX_FILE_SIZE_BYTES:
            max_mb = settings.MAX_FILE_SIZE_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds the maximum allowed size of {max_mb} MB.",
            )
