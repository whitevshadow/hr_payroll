"""
app/repositories/blob_repository.py

Data-access layer for the `blobs` table.
All public methods are async and accept an `AsyncSession` injected by FastAPI.
"""

import logging
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: F401
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.blob_model import Blob
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class BlobRepository:
    """CRUD operations for :class:`Blob` ORM records."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Create ─────────────────────────────────────────────────────────────────

    async def create(
        self,
        *,
        blob_id: uuid.UUID | None = None,
        file_name: str,
        mime_type: str,
        document_type: str,
        bucket_name: str,
        object_key: str,
        folder: str,
        size: int,
        uploaded_by: uuid.UUID,
        tenant_id: uuid.UUID,
        employee_id: uuid.UUID | None = None,
        etag: str | None = None,
        version: str | None = None,
        checksum: str | None = None,
        tags: dict | None = None,
    ) -> Blob:
        """Insert a new Blob record and return the persisted object."""
        blob = Blob(
            id=blob_id or uuid.uuid4(),
            file_name=file_name,
            mime_type=mime_type,
            document_type=document_type,
            bucket_name=bucket_name,
            object_key=object_key,
            folder=folder,
            size=size,
            etag=etag,
            version=version,
            checksum=checksum,
            uploaded_by=uploaded_by,
            tenant_id=tenant_id,
            employee_id=employee_id,
            tags=tags or {},
        )
        self._session.add(blob)
        await self._session.commit()
        await self._session.refresh(blob)
        logger.info("Blob record created: id=%s file_name=%s", blob.id, blob.file_name)
        return blob

    # ── Read ───────────────────────────────────────────────────────────────────

    async def get_by_id(
        self, blob_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> Blob | None:
        """
        Return a single *active* Blob scoped to *tenant_id*, or *None* if not
        found, soft-deleted, or owned by a different tenant.

        Tenant scoping is enforced at the query level so a leaked or guessed
        blob UUID can never cross tenant boundaries.
        """
        result = await self._session.execute(
            select(Blob).where(
                Blob.id == blob_id,
                Blob.tenant_id == tenant_id,
                Blob.is_deleted.is_(False),
            )
        )
        return result.scalar_one_or_none()

    async def list_filtered(
        self,
        *,
        tenant_id: uuid.UUID,
        page: int = 1,
        page_size: int = 20,
        content_type: str | None = None,
        uploaded_by: uuid.UUID | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> tuple[Sequence[Blob], int]:
        """
        Return paginated active blobs for *tenant_id* matching the filters.

        Returns
        -------
        (items, total)
            ``items`` — the matching page of records.
            ``total`` — total number of matching records (for pagination math).
        """
        base_where = [Blob.tenant_id == tenant_id, Blob.is_deleted.is_(False)]

        if content_type:
            base_where.append(Blob.mime_type == content_type)
        if uploaded_by:
            base_where.append(Blob.uploaded_by == uploaded_by)
        if created_after:
            base_where.append(Blob.uploaded_at >= created_after)
        if created_before:
            base_where.append(Blob.uploaded_at <= created_before)

        # Total count
        count_result = await self._session.execute(
            select(func.count()).select_from(Blob).where(*base_where)
        )
        total: int = count_result.scalar_one()

        # Paginated items
        offset = (page - 1) * page_size
        items_result = await self._session.execute(
            select(Blob)
            .where(*base_where)
            .order_by(Blob.uploaded_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        items = items_result.scalars().all()

        return items, total

    async def list_keyset(
        self,
        *,
        tenant_id: uuid.UUID,
        limit: int = 20,
        cursor: tuple[datetime, uuid.UUID] | None = None,
        content_type: str | None = None,
        uploaded_by: uuid.UUID | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> Sequence[Blob]:
        """
        Return up to *limit* active blobs for *tenant_id*, newest first, using
        keyset (cursor) pagination on ``(uploaded_at DESC, id DESC)``.

        *cursor* is the ``(uploaded_at, id)`` of the last row from the previous
        page; only rows strictly older than the cursor are returned. This avoids
        the O(n) cost of deep OFFSET paging on large tenants.
        """
        from sqlalchemy import and_, or_, tuple_

        where = [Blob.tenant_id == tenant_id, Blob.is_deleted.is_(False)]
        if content_type:
            where.append(Blob.mime_type == content_type)
        if uploaded_by:
            where.append(Blob.uploaded_by == uploaded_by)
        if created_after:
            where.append(Blob.uploaded_at >= created_after)
        if created_before:
            where.append(Blob.uploaded_at <= created_before)
        if cursor is not None:
            c_ts, c_id = cursor
            # Row-value comparison: (uploaded_at, id) < (cursor_ts, cursor_id)
            where.append(
                or_(
                    Blob.uploaded_at < c_ts,
                    and_(Blob.uploaded_at == c_ts, Blob.id < c_id),
                )
            )

        result = await self._session.execute(
            select(Blob)
            .where(*where)
            .order_by(Blob.uploaded_at.desc(), Blob.id.desc())
            .limit(limit)
        )
        return result.scalars().all()

    # ── Soft Delete / Restore ──────────────────────────────────────────────────

    async def soft_delete(self, blob: Blob) -> Blob:
        """Mark *blob* as soft-deleted by setting ``is_deleted`` to true."""
        blob.is_deleted = True
        blob.retention_until = datetime.now(timezone.utc) + timedelta(days=settings.SOFT_DELETE_RETENTION_DAYS)
        await self._session.commit()
        await self._session.refresh(blob)
        logger.info("Blob soft-deleted: id=%s", blob.id)
        return blob

    async def restore(
        self, blob_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> Blob | None:
        """
        Clear ``is_deleted`` on a soft-deleted blob owned by *tenant_id*,
        restoring it to active.

        Returns the restored Blob or None if the id doesn't exist for this
        tenant (including never-existed rows).
        """
        # Look up including soft-deleted rows, scoped to tenant
        result = await self._session.execute(
            select(Blob).where(Blob.id == blob_id, Blob.tenant_id == tenant_id)
        )
        blob = result.scalar_one_or_none()
        if blob is None:
            return None
        blob.is_deleted = False
        blob.retention_until = None
        await self._session.commit()
        await self._session.refresh(blob)
        logger.info("Blob restored: id=%s", blob.id)
        return blob

    # ── Hard Delete ─────────────────────────────────────────────────────────────

    async def delete(self, blob: Blob) -> None:
        """Hard-delete a Blob record and commit."""
        await self._session.delete(blob)
        await self._session.commit()
        logger.info("Blob record hard-deleted: id=%s", blob.id)

    # ── Tags (server-side JSONB merge) ─────────────────────────────────────────

    async def update_tags(
        self,
        blob_id: uuid.UUID,
        new_tags: dict,
        tenant_id: uuid.UUID,
        *,
        replace: bool = False,
    ) -> Blob | None:
        """
        Update tags for *blob_id* using a server-side PostgreSQL JSONB operation.

        Parameters
        ----------
        replace
            ``False`` (default) — shallow merge: ``existing_tags || new_tags``
                New keys are added; existing keys are overwritten at the top level.
            ``True`` — full replacement: tags column is set to *new_tags* entirely.

        Uses the PostgreSQL ``||`` concatenation operator executed directly in the
        database, avoiding any read-modify-write race condition.
        """
        import json

        from sqlalchemy import cast
        from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB

        if replace:
            stmt = (
                update(Blob)
                .where(
                    Blob.id == blob_id,
                    Blob.tenant_id == tenant_id,
                    Blob.is_deleted.is_(False),
                )
                .values(tags=new_tags, updated_at=func.now())
                .returning(Blob)
            )
        else:
            stmt = (
                update(Blob)
                .where(
                    Blob.id == blob_id,
                    Blob.tenant_id == tenant_id,
                    Blob.is_deleted.is_(False),
                )
                .values(
                    tags=Blob.tags.op("||")(cast(json.dumps(new_tags), PG_JSONB)),
                    updated_at=func.now(),
                )
                .returning(Blob)
            )

        result = await self._session.execute(stmt)
        await self._session.commit()
        blob = result.scalar_one_or_none()
        if blob:
            logger.info("Blob tags updated: id=%s replace=%s", blob_id, replace)
        return blob


    # ── Scheduled Purge ────────────────────────────────────────────────────────

    async def get_expired_soft_deleted(self, retention_days: int) -> Sequence[Blob]:
        """
        Return all blobs that were soft-deleted more than *retention_days* ago.
        Used by the scheduled purge job.
        """
        cutoff = datetime.now(timezone.utc)
        result = await self._session.execute(
            select(Blob).where(
                Blob.is_deleted.is_(True),
                Blob.retention_until.is_not(None),
                Blob.retention_until < cutoff,
            )
        )
        return result.scalars().all()

    async def hard_delete_by_ids(self, blob_ids: list[uuid.UUID]) -> int:
        """Hard-delete multiple blobs by id. Returns the count deleted."""
        from sqlalchemy import delete as sa_delete
        result = await self._session.execute(
            sa_delete(Blob).where(Blob.id.in_(blob_ids))
        )
        await self._session.commit()
        count: int = result.rowcount
        logger.info("Purged %d expired blob records.", count)
        return count
