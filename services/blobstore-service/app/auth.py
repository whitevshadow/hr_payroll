"""
app/auth.py

Authentication / authorization for the Blobstore service.

The platform issues a single shared-secret JWT (see ``hr_shared.auth``). Every
service — including Blobstore — independently re-validates the token signature
and derives the caller's identity from its claims; **no service trusts request
headers blindly.**

This module binds the shared ``build_context_dependency`` to Blobstore's own
settings and exposes:

- ``get_context``     – FastAPI dependency returning a verified ``RequestContext``
                        (``user_id``, ``tenant_id``, ``roles``, ``email``).
- ``require_tenant``  – returns the verified ``tenant_id``; if the legacy
                        ``X-Tenant-Id`` header is supplied it must match the
                        token's ``tenant_id`` claim (defence in depth).
- ``require_roles``   – role guard for privileged operations (delete/restore).
- ``require_admin``   – convenience guard bound to ``BLOB_ADMIN_ROLES``.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Callable

from fastapi import Depends, Header, HTTPException, status
from hr_shared.auth import RequestContext, build_context_dependency

from app.config import get_settings

settings = get_settings()

# Verified-identity dependency, bound to the shared JWT secret/algorithm.
get_context = build_context_dependency(settings.JWT_SECRET, settings.JWT_ALGORITHM)


async def require_tenant(
    ctx: RequestContext = Depends(get_context),
    x_tenant_id: Annotated[uuid.UUID | None, Header(alias="X-Tenant-Id")] = None,
) -> uuid.UUID:
    """
    Return the caller's tenant id, taken from the **verified JWT** claim.

    If the legacy ``X-Tenant-Id`` header is present it must equal the token's
    ``tenant_id`` — a mismatch is rejected with 403 so a caller can never act on
    a tenant other than the one they authenticated as.
    """
    if x_tenant_id is not None and x_tenant_id != ctx.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="X-Tenant-Id does not match the authenticated tenant.",
        )
    return ctx.tenant_id


def require_roles(*allowed: str) -> Callable:
    """Return a dependency that requires the caller to hold one of *allowed* roles."""

    async def _guard(ctx: RequestContext = Depends(get_context)) -> RequestContext:
        if not any(r in allowed for r in ctx.roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(allowed)}",
            )
        return ctx

    return _guard


# Guard for privileged blob operations (delete / restore / audit exports).
require_admin = require_roles(*settings.BLOB_ADMIN_ROLES)
