from __future__ import annotations

import uuid
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from hr_shared import RequestContext, audit_log
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session, runtime
from .models import Client, ClientDocument, ClientPortalCredential
from .schemas import (
    ClientCreate,
    ClientDashboardOut,
    ClientDocumentCreate,
    ClientDocumentOut,
    ClientDocumentVerify,
    ClientOut,
    ClientPage,
    ClientUpdate,
    CredentialCreate,
    CredentialOut,
    CredentialReveal,
)

router = APIRouter(prefix="/api/v1", tags=["clients"])

_admin = runtime.require_roles("ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "SUPER_ADMIN")


# ── Client CRUD ───────────────────────────────────────────────────────────────

@router.post("/clients", response_model=ClientOut, status_code=201)
async def create_client(
    body: ClientCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    if not body.client_code:
        body.client_code = f"CLI-{uuid.uuid4().hex[:6].upper()}"

    dup = await session.scalar(
        select(Client).where(Client.tenant_id == ctx.tenant_id, Client.client_code == body.client_code)
    )
    if dup:
        raise HTTPException(status_code=409, detail="client_code already exists")

    client = Client(
        tenant_id=ctx.tenant_id,
        client_code=body.client_code,
        client_name=body.client_name,
        legal_name=body.legal_name,
        industry=body.industry,
        status=body.status,
        address=body.address.model_dump() if body.address else None,
        contact=body.contact.model_dump() if body.contact else None,
        statutory_ids=body.statutory_ids.model_dump() if body.statutory_ids else None,
        payroll_start_date=body.payroll_info.payroll_start_date if body.payroll_info else None,
        payroll_frequency=body.payroll_info.payroll_frequency if body.payroll_info else "MONTHLY",
        payroll_calendar=body.payroll_info.payroll_calendar if body.payroll_info else None,
        financial_year=body.payroll_info.financial_year if body.payroll_info else None,
        salary_template_id=body.payroll_info.salary_template_id if body.payroll_info else None,
    )
    session.add(client)
    await session.flush()
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CLIENT_CREATED",
                    entity_type="client", entity_id=str(client.id),
                    payload={"client_code": client.client_code, "client_name": client.client_name},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(client)
    return ClientOut.from_orm_v2(client)


@router.get("/clients", response_model=ClientPage)
async def list_clients(
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: str | None = None,
    status: str | None = None,
    industry: str | None = None,
):
    base = select(Client).where(Client.tenant_id == ctx.tenant_id)
    if search:
        like = f"%{search}%"
        base = base.where(or_(
            Client.client_name.ilike(like),
            Client.client_code.ilike(like),
            Client.city.ilike(like),
            Client.legal_name.ilike(like),
        ))
    if status:
        base = base.where(Client.status == status)
    if industry:
        base = base.where(Client.industry == industry)
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    rows = await session.scalars(
        base.order_by(Client.client_name).offset((page - 1) * page_size).limit(page_size)
    )
    items = [ClientOut.from_orm_v2(c) for c in rows]
    return ClientPage(items=items, total=total or 0, page=page, page_size=page_size)


@router.get("/clients/{client_id}", response_model=ClientOut)
async def get_client(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientOut.from_orm_v2(client)


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

    dump = body.model_dump(exclude_unset=True)
    # Convert nested Pydantic objects to dicts for JSONB storage
    if "address" in dump and dump["address"] is not None:
        client.address = body.address.model_dump()
    if "contact" in dump and dump["contact"] is not None:
        client.contact = body.contact.model_dump()
    if "statutory_ids" in dump and dump["statutory_ids"] is not None:
        client.statutory_ids = body.statutory_ids.model_dump()
    if "payroll_info" in dump and dump["payroll_info"] is not None:
        pi = body.payroll_info
        if pi.payroll_start_date is not None: client.payroll_start_date = pi.payroll_start_date
        if pi.payroll_frequency is not None:  client.payroll_frequency = pi.payroll_frequency
        if pi.payroll_calendar is not None:   client.payroll_calendar = pi.payroll_calendar
        if pi.financial_year is not None:     client.financial_year = pi.financial_year
        if pi.salary_template_id is not None: client.salary_template_id = pi.salary_template_id

    for k in ("client_name", "legal_name", "industry", "status"):
        if k in dump and dump[k] is not None:
            setattr(client, k, dump[k])

    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CLIENT_UPDATED",
                    entity_type="client", entity_id=str(client_id),
                    payload={"client_code": client.client_code, **{k: v for k, v in dump.items() if k not in ("address","contact","statutory_ids","payroll_info")}},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(client)
    return ClientOut.from_orm_v2(client)


@router.post("/clients/{client_id}/archive", response_model=ClientOut)
async def archive_client(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Soft-delete: mark client ARCHIVED."""
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")
    client.status = "ARCHIVED"
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CLIENT_ARCHIVED",
                    entity_type="client", entity_id=str(client_id),
                    payload={"client_name": client.client_name}, actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(client)
    return ClientOut.from_orm_v2(client)


@router.delete("/clients/{client_id}", status_code=204)
async def delete_client(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Hard delete — blocked if employee rows reference this client."""
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")
    count = await session.scalar(
        text("SELECT COUNT(*) FROM employees WHERE client_id = :cid AND tenant_id = :tid")
        .bindparams(cid=client_id, tid=ctx.tenant_id)
    )
    if count and count > 0:
        raise HTTPException(status_code=409,
                            detail=f"Cannot delete client. {count} employee(s) are linked. Reassign or archive instead.")
    await session.delete(client)
    await session.commit()


# ── Client Dashboard ──────────────────────────────────────────────────────────

@router.get("/clients/{client_id}/dashboard", response_model=ClientDashboardOut)
async def client_dashboard(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Return operational summary for a client."""
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    # Employee counts (cross-schema via raw SQL)
    emp_result = await session.execute(
        text("SELECT COUNT(*), SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) FROM employees WHERE client_id=:cid AND tenant_id=:tid")
        .bindparams(cid=client_id, tid=ctx.tenant_id)
    )
    row = emp_result.fetchone()
    total_emp = row[0] or 0
    active_emp = row[1] or 0

    # Documents expiring within 30 days
    expiry_threshold = date.today() + timedelta(days=30)
    expiring_docs = await session.scalar(
        select(func.count(ClientDocument.id)).where(
            ClientDocument.client_id == client_id,
            ClientDocument.expiry_date <= expiry_threshold,
            ClientDocument.expiry_date >= date.today(),
        )
    )

    # Missing portal credentials
    existing_portals = {c.portal_type for c in client.credentials}
    required_portals = {"PF", "ESIC", "GST"}
    missing = list(required_portals - existing_portals)

    return ClientDashboardOut(
        client_id=client.id,
        client_name=client.client_name,
        employee_count=total_emp,
        active_employees=active_emp,
        compliance_alerts=missing,
        documents_expiring_soon=expiring_docs or 0,
        pending_credentials=missing,
    )


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
        select(ClientPortalCredential).where(ClientPortalCredential.client_id == client_id)
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
        existing.portal_url = body.portal_url
        existing.username = body.username
        if body.metadata_json is not None:
            existing.metadata_json = body.metadata_json
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
            portal_url=body.portal_url,
            username=body.username,
            password_encrypted=body.password,
            metadata_json=body.metadata_json,
            last_rotated_at=datetime.now(tz=timezone.utc) if body.password else None,
        )
        session.add(cred)

    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CREDENTIAL_UPDATED",
                    entity_type="client_credential", entity_id=str(client_id),
                    payload={"portal_type": body.portal_type, "username": body.username},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(cred)
    return CredentialOut.from_orm_safe(cred)


@router.post("/clients/{client_id}/credentials/{cred_id}/reveal", response_model=CredentialReveal)
async def reveal_credential(
    client_id: uuid.UUID,
    cred_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    """Decrypt and return the password once (visible to admin only)."""
    cred = await session.get(ClientPortalCredential, cred_id)
    if not cred or cred.client_id != client_id:
        raise HTTPException(status_code=404, detail="Credential not found")
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=403, detail="Access denied")

    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CREDENTIAL_REVEALED",
                    entity_type="client_credential", entity_id=str(cred_id),
                    payload={"portal_type": cred.portal_type, "client_id": str(client_id)},
                    actor_id=ctx.user_id)
    await session.commit()
    return CredentialReveal(id=cred.id, portal_type=cred.portal_type,
                            username=cred.username, password=cred.password_encrypted)


@router.post("/clients/{client_id}/credentials/{cred_id}/rotate", response_model=CredentialOut)
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
    if body.portal_url is not None:
        cred.portal_url = body.portal_url
    if body.metadata_json is not None:
        cred.metadata_json = body.metadata_json

    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CREDENTIAL_ROTATED",
                    entity_type="client_credential", entity_id=str(cred_id),
                    payload={"portal_type": cred.portal_type}, actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(cred)
    return CredentialOut.from_orm_safe(cred)


# ── Client Documents ──────────────────────────────────────────────────────────

@router.get("/clients/{client_id}/documents", response_model=list[ClientDocumentOut])
async def list_client_documents(
    client_id: uuid.UUID,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
    doc_category: str | None = None,
):
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")
    q = select(ClientDocument).where(ClientDocument.client_id == client_id)
    if doc_category:
        q = q.where(ClientDocument.doc_category == doc_category)
    rows = await session.scalars(q.order_by(ClientDocument.created_at.desc()))
    return list(rows)


@router.post("/clients/{client_id}/documents", response_model=ClientDocumentOut, status_code=201)
async def upload_client_document(
    client_id: uuid.UUID,
    body: ClientDocumentCreate,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="Client not found")

    doc = ClientDocument(
        tenant_id=ctx.tenant_id,
        client_id=client_id,
        blob_id=body.blob_id,
        doc_category=body.doc_category,
        doc_label=body.doc_label,
        description=body.description,
        expiry_date=body.expiry_date,
    )
    session.add(doc)
    await audit_log(session, tenant_id=ctx.tenant_id, event_type="CLIENT_DOCUMENT_UPLOADED",
                    entity_type="client_document", entity_id=str(client_id),
                    payload={"doc_category": body.doc_category, "doc_label": body.doc_label},
                    actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(doc)
    return doc


@router.patch("/clients/{client_id}/documents/{doc_id}/verify", response_model=ClientDocumentOut)
async def verify_client_document(
    client_id: uuid.UUID,
    doc_id: uuid.UUID,
    body: ClientDocumentVerify,
    ctx: RequestContext = Depends(_admin),
    session: AsyncSession = Depends(get_session),
):
    doc = await session.get(ClientDocument, doc_id)
    if not doc or doc.client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found")
    client = await session.get(Client, client_id)
    if not client or client.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=403, detail="Access denied")

    doc.verification_status = body.status
    doc.verified_by = ctx.user_id
    doc.verified_at = datetime.now(tz=timezone.utc)
    doc.verification_comment = body.comment

    await audit_log(session, tenant_id=ctx.tenant_id,
                    event_type="CLIENT_DOCUMENT_VERIFIED" if body.status == "APPROVED" else "CLIENT_DOCUMENT_REJECTED",
                    entity_type="client_document", entity_id=str(doc_id),
                    payload={"status": body.status, "comment": body.comment}, actor_id=ctx.user_id)
    await session.commit()
    await session.refresh(doc)
    return doc
