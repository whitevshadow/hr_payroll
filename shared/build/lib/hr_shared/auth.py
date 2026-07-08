"""JWT helpers and the shared request-context dependency.

The gateway validates the JWT and forwards it; each service independently
decodes it to derive ``tenant_id`` (no service trusts headers blindly — it
re-validates the token signature).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

_bearer = HTTPBearer(auto_error=False)


@dataclass
class RequestContext:
    """Decoded identity for the current request."""

    user_id: uuid.UUID
    tenant_id: uuid.UUID
    roles: list[str] = field(default_factory=list)
    email: str | None = None
    client_id: uuid.UUID | None = None


def create_access_token(
    *,
    user_id: uuid.UUID | str,
    tenant_id: uuid.UUID | str,
    roles: list[str],
    secret: str,
    algorithm: str = "HS256",
    minutes: int = 120,
    email: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id),
        "roles": roles,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=algorithm)


def decode_token(token: str, secret: str, algorithm: str = "HS256") -> dict:
    try:
        return jwt.decode(token, secret, algorithms=[algorithm])
    except JWTError as exc:  # pragma: no cover - exercised via deps
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
        ) from exc


def build_context_dependency(secret: str, algorithm: str = "HS256"):
    """Return a FastAPI dependency producing a :class:`RequestContext`.

    Services call this once at startup with their settings and reuse the
    returned dependency on protected routes.
    """

    async def get_current_context(
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
        x_client_id: str | None = Header(None, alias="x-client-id"),
    ) -> RequestContext:
        if creds is None or not creds.credentials:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing bearer token",
            )
        payload = decode_token(creds.credentials, secret, algorithm)
        try:
            client_uuid = None
            if x_client_id:
                try:
                    client_uuid = uuid.UUID(x_client_id)
                except ValueError:
                    pass

            return RequestContext(
                user_id=uuid.UUID(payload["sub"]),
                tenant_id=uuid.UUID(payload["tenant_id"]),
                roles=payload.get("roles", []),
                email=payload.get("email"),
                client_id=client_uuid,
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Malformed token claims",
            ) from exc

    return get_current_context


def build_client_context_dependency(base_context_dep):
    """Return a FastAPI dependency that enforces x-client-id is present."""
    async def get_client_context(ctx: RequestContext = Depends(base_context_dep)) -> RequestContext:
        if not ctx.client_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing or invalid x-client-id header",
            )
        return ctx
    return get_client_context


# Placeholder so ``from hr_shared import get_current_context`` resolves; real
# services use build_context_dependency(secret) to bind their secret.
def get_current_context() -> RequestContext:  # pragma: no cover
    raise RuntimeError(
        "Use build_context_dependency(secret) to create a bound dependency."
    )
