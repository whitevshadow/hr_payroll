from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.document_registry import DocumentRegistry, DocumentStatus


class RegistryService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._settings = get_settings()

    async def reconcile_stale(
        self,
        stale_minutes: int | None = None,
        max_attempts: int | None = None,
    ) -> dict:
        stale_cutoff = datetime.now(timezone.utc) - timedelta(
            minutes=stale_minutes or self._settings.REGISTRY_STALE_MINUTES
        )
        attempts_cap = max_attempts or self._settings.REGISTRY_MAX_EXTRACTION_ATTEMPTS

        query = select(DocumentRegistry).where(
            and_(
                DocumentRegistry.status == DocumentStatus.EXTRACTING,
                DocumentRegistry.updated_at < stale_cutoff,
            )
        )
        result = await self._session.execute(query)
        stale_entries = list(result.scalars().all())

        moved_to_failed = 0
        retried = 0

        for entry in stale_entries:
            if entry.extraction_attempts + 1 >= attempts_cap:
                entry.extraction_attempts += 1
                entry.status = DocumentStatus.FAILED
                entry.extraction_error = (
                    entry.extraction_error
                    or "Marked FAILED by stale extraction reconciler"
                )
                moved_to_failed += 1
            else:
                entry.extraction_attempts += 1
                retried += 1

        await self._session.commit()

        return {
            "stale_found": len(stale_entries),
            "retried": retried,
            "failed": moved_to_failed,
            "stale_cutoff_utc": stale_cutoff.isoformat(),
            "max_attempts": attempts_cap,
        }

    async def get(self, registry_id: UUID, tenant_id: UUID) -> DocumentRegistry | None:
        entry = await self._session.get(DocumentRegistry, registry_id)
        if entry is None or entry.tenant_id != tenant_id:
            return None
        return entry
