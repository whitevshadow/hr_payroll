"""
app/storage/virus_scan.py

Optional antivirus hook. When ``VIRUS_SCAN_ENABLED`` is set, uploaded bytes are
streamed to a ClamAV daemon (clamd) over TCP before the object is persisted.

- A clean result lets the upload proceed.
- An infected result raises ``HTTPException 422`` and the upload is rejected.
- If the scanner is unreachable, behaviour depends on
  ``VIRUS_SCAN_FAIL_CLOSED``: when true the upload is rejected (503), when false
  it is allowed through with a warning.
"""

from __future__ import annotations

import io
import logging

from fastapi import HTTPException, status

from app.config import get_settings

logger = logging.getLogger(__name__)


async def scan_or_raise(data: bytes) -> None:
    """Scan *data*; raise on infection or (when fail-closed) on scanner errors."""
    settings = get_settings()
    if not settings.VIRUS_SCAN_ENABLED:
        return

    import asyncio

    def _scan() -> tuple[str, str | None]:
        import clamd

        client = clamd.ClamdNetworkSocket(
            host=settings.CLAMAV_HOST, port=settings.CLAMAV_PORT, timeout=30
        )
        result = client.instream(io.BytesIO(data))
        # clamd returns {"stream": ("OK"|"FOUND", signature_or_None)}
        verdict, signature = result.get("stream", ("OK", None))
        return verdict, signature

    try:
        verdict, signature = await asyncio.to_thread(_scan)
    except Exception as exc:  # noqa: BLE001
        logger.error("Virus scan unavailable: %s", exc)
        if settings.VIRUS_SCAN_FAIL_CLOSED:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Virus scanner unavailable; upload rejected.",
            ) from exc
        logger.warning("Virus scan skipped (fail-open) for a %d byte upload", len(data))
        return

    if verdict == "FOUND":
        logger.warning("Rejected infected upload: %s", signature)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File failed virus scan: {signature}",
        )
