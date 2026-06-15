from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from hr_shared import RequestContext, audit_log
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session, runtime
from .models import Client, ClientPortalCredential
from .schemas import (
    ClientCreate,
    ClientOut,
    ClientPage,
    ClientUpdate,
    CredentialCreate,
    CredentialOut,
    CredentialReveal,
)

router = APIRouter(prefix="/api/v1", tags=["clients"])

_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


# ── Client CRUD ──────────────────────────────────────────────────────────────

@router.post("/clients", response_model=ClientOut, status_code=201)
async def create_client(
    body: ClientCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    dup = await session.scalar(
        select(Client).where(
            Client.tenant_id == ctx.tenant_id,
            Client.client_code == body.client_code,
        )
    )
    if dup:
        raise HTTPException(status_code=409, detail="client_code already exists")

    client = Client(tenant_id=ctx.tenant_id, **body.model_dump())
    session.add(client)
    await session.flush()
    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="CLIENT_CREATED",
        entity_type="client",
        entity_id=str(client.id),
        payload={"client_code": client.client_code, "client_name": client.client_name},
        actor_id=ctx.user_id,
    )
    await session.commit()
    await session.refresh(client)
    return client


@router.get("/clients", response_model=ClientPage)
async def list_clients(
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str | None = None,
    status: str | None = None,
):
    base = select(Client).where(Client.tenant_id == ctx.tenant_id)
    if search:
        like = f"%{search}%"
        base = base.where(
            or_(
                Client.client_name.ilike(like),
                Client.client_code.ilike(like),
                Client.city.ilike(like),
            )
        )
    if status:
        base = base.where(Client.status == status)

    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    rows = await session.scalars(
        base.order_by(Client.client_name).offset((page - 1) * page_size).limit(page_size)
    )
    return ClientPage(items=list(rows), total=total or 0, page=page, page_size=page_size)


@router.get("/clients/{client_id}", response_model=ClientOut)
async def get_client(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.put("/clients/{client_id}", response_model=ClientOut)
async def update_client(
    client_id: uuid.UUID,
    body: ClientUpdate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(client, k, v)

    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="CLIENT_UPDATED",
        entity_type="client",
        entity_id=str(client_id),
        payload=body.model_dump(exclude_unset=True),
        actor_id=ctx.user_id,
    )
    await session.commit()
    await session.refresh(client)
    return client


@router.post("/clients/{client_id}/archive", response_model=ClientOut)
async def archive_client(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """
    Soft-delete: mark client ARCHIVED.
    Hard deletion is blocked if employees are linked (checked by employee-service
    via FK; we surface a friendly message here based on a count query).
    """
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    client.status = "ARCHIVED"
    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="CLIENT_ARCHIVED",
        entity_type="client",
        entity_id=str(client_id),
        payload={"client_name": client.client_name},
        actor_id=ctx.user_id,
    )
    await session.commit()
    await session.refresh(client)
    return client


@router.delete("/clients/{client_id}", status_code=204)
async def delete_client(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """
    Hard delete — blocked if employee rows reference this client.
    Raises 409 with a user-friendly message.
    """
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    # Import Employee here to avoid circular dep at module level.
    # client-service shares the employee_schema so the employees table is visible.
    from sqlalchemy import text

    count = await session.scalar(
        text(
            "SELECT COUNT(*) FROM employees WHERE client_id = :cid AND tenant_id = :tid"
        ).bindparams(cid=client_id, tid=ctx.tenant_id)
    )
    if count and count > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot delete client. {count} employee(s) are linked to this client. "
                "Please reassign or archive instead."
            ),
        )

    await session.delete(client)
    await session.commit()


# ── Portal Credentials ────────────────────────────────────────────────────────

@router.get("/clients/{client_id}/credentials", response_model=list[CredentialOut])
async def list_credentials(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    rows = await session.scalars(
        select(ClientPortalCredential).where(
            ClientPortalCredential.client_id == client_id
        )
    )
    return [CredentialOut.from_orm_safe(r) for r in rows]


@router.post("/clients/{client_id}/credentials", response_model=CredentialOut, status_code=201)
async def upsert_credential(
    client_id: uuid.UUID,
    body: CredentialCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Create or update a portal credential. Password is encrypted at rest."""
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    existing = await session.scalar(
        select(ClientPortalCredential).where(
            ClientPortalCredential.client_id == client_id,
            ClientPortalCredential.portal_type == body.portal_type,
        )
    )

    if existing:
        existing.portal_name = body.portal_name
        existing.username = body.username
        if body.password is not None:
            existing.password_encrypted = body.password
            existing.last_rotated_at = datetime.now(tz=timezone.utc)
        cred = existing
    else:
        cred = ClientPortalCredential(
            tenant_id=ctx.tenant_id,
            client_id=client_id,
            portal_type=body.portal_type,
            portal_name=body.portal_name,
            username=body.username,
            password_encrypted=body.password,
            last_rotated_at=datetime.now(tz=timezone.utc) if body.password else None,
        )
        session.add(cred)

    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="CREDENTIAL_UPDATED",
        entity_type="client_credential",
        entity_id=str(client_id),
        payload={"portal_type": body.portal_type, "username": body.username},
        actor_id=ctx.user_id,
    )
    await session.commit()
    await session.refresh(cred)
    return CredentialOut.from_orm_safe(cred)


@router.post(
    "/clients/{client_id}/credentials/{cred_id}/reveal",
    response_model=CredentialReveal,
)
async def reveal_credential(
    client_id: uuid.UUID,
    cred_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """
    Decrypt and return the password once (visible to admin only).
    Writes a CREDENTIAL_REVEALED audit event for compliance tracking.
    """
    cred = await session.get(ClientPortalCredential, cred_id)
    if not cred or cred.client_id != client_id:
        raise HTTPException(status_code=404, detail="Credential not found")

    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="CREDENTIAL_REVEALED",
        entity_type="client_credential",
        entity_id=str(cred_id),
        payload={"portal_type": cred.portal_type, "client_id": str(client_id)},
        actor_id=ctx.user_id,
    )
    await session.commit()

    return CredentialReveal(
        id=cred.id,
        portal_type=cred.portal_type,
        username=cred.username,
        # password_encrypted stores the Fernet ciphertext; SQLAlchemy
        # EncryptedString auto-decrypts on read via process_result_value.
        password=cred.password_encrypted,
    )


@router.post(
    "/clients/{client_id}/credentials/{cred_id}/rotate",
    response_model=CredentialOut,
)
async def rotate_credential(
    client_id: uuid.UUID,
    cred_id: uuid.UUID,
    body: CredentialCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Rotate (replace) a stored credential's password."""
    cred = await session.get(ClientPortalCredential, cred_id)
    if not cred or cred.client_id != client_id:
        raise HTTPException(status_code=404, detail="Credential not found")

    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=403, detail="Access denied")

    if body.password is not None:
        cred.password_encrypted = body.password
        cred.last_rotated_at = datetime.now(tz=timezone.utc)
    if body.username is not None:
        cred.username = body.username
    if body.portal_name is not None:
        cred.portal_name = body.portal_name

    await audit_log(
        session,
        tenant_id=ctx.tenant_id,
        event_type="CREDENTIAL_ROTATED",
        entity_type="client_credential",
        entity_id=str(cred_id),
        payload={"portal_type": cred.portal_type},
        actor_id=ctx.user_id,
    )
    await session.commit()
    await session.refresh(cred)
    return CredentialOut.from_orm_safe(cred)
