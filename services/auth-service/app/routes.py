from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from hr_shared import RequestContext, create_access_token
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .models import Role, Tenant, User
from .schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    SetPasswordRequest,
    TokenResponse,
)
from .security import hash_password, verify_password
from .settings import settings

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# First registered admin gets the full admin role set for V1.
BOOTSTRAP_ROLES = ["ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN"]
VALID_ROLES = {"SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "EMPLOYEE", "CLIENT_ADMIN", "COMPLIANCE_OFFICER", "CLIENT_MANAGER"}
ADMIN_ROLES = {"SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN"}


def _issue_token(user: User, roles: list[str]) -> str:
    return create_access_token(
        user_id=user.id,
        tenant_id=user.tenant_id,
        roles=roles,
        secret=settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
        minutes=settings.access_token_minutes,
        email=user.email,
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    body: RegisterRequest, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    """Bootstrap a tenant + its first admin user."""
    email = body.email.lower()

    # Gate before touching the email, so a closed instance cannot be used to
    # probe which addresses are registered.
    if not settings.allow_public_registration:
        if await session.scalar(select(Tenant.id).limit(1)) is not None:
            raise HTTPException(
                status_code=403,
                detail="Registration is closed. Ask an administrator for an account.",
            )

    # Scan every tenant, and do it before the tenant row is created. This check
    # previously filtered on the freshly generated tenant_id, which by
    # construction has no rows, so it never fired: a repeat registration
    # silently created a second tenant for the same address. login() rejects an
    # email that resolves to more than one tenant rather than matching an
    # arbitrary row, so that second registration locked the address out of
    # password login permanently.
    existing = await session.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # A tenant row is scoped to itself: tenant_id == its own id.
    tenant_id = uuid.uuid4()
    tenant = Tenant(id=tenant_id, tenant_id=tenant_id, name=body.tenant_name)
    session.add(tenant)

    user = User(
        tenant_id=tenant_id,
        email=email,
        password_hash=hash_password(body.password),
        is_active=True,
    )
    session.add(user)
    await session.flush()

    for role_name in BOOTSTRAP_ROLES:
        session.add(Role(tenant_id=tenant_id, user_id=user.id, role_name=role_name))

    await session.commit()
    return TokenResponse(access_token=_issue_token(user, BOOTSTRAP_ROLES))


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    # Resolve the user within a single tenant. When a tenant_id is supplied the
    # (tenant_id, email) pair is unique, so at most one row matches. Without a
    # tenant_id we must not fall back to "first match wins": an email shared
    # across tenants would otherwise authenticate against an arbitrary tenant.
    stmt = select(User).where(User.email == body.email.lower())
    if body.tenant_id is not None:
        stmt = stmt.where(User.tenant_id == body.tenant_id)
    matches = (await session.scalars(stmt)).all()

    # Generic message throughout: never reveal whether the email exists, in how
    # many tenants, or whether the tenant_id/password was the wrong part.
    if len(matches) != 1:
        # Zero matches, or an ambiguous email that needs an explicit tenant_id.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    user = matches[0]
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User disabled")
    roles = [r.role_name for r in user.roles]
    return TokenResponse(access_token=_issue_token(user, roles))


@router.get("/me", response_model=MeResponse)
async def me(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    user = await session.get(User, ctx.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return MeResponse(
        user_id=user.id,
        tenant_id=user.tenant_id,
        email=user.email,
        roles=[r.role_name for r in user.roles],
    )


@router.post("/users/me/password", status_code=204)
async def change_own_password(
    body: ChangePasswordRequest,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Change your own password, proving the current one first.

    Note the token caveat: JWTs here are stateless and carry no revocation
    list, so sessions issued before the change keep working until they expire
    (ACCESS_TOKEN_MINUTES). Changing the password stops *new* logins with the
    old one; it does not boot out an existing session.
    """
    user = await session.get(User, ctx.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(body.current_password, user.password_hash):
        # Same wording as login: never confirm which half was wrong.
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(
            status_code=422, detail="New password must differ from the current one"
        )
    user.password_hash = hash_password(body.new_password)
    await session.commit()
    return Response(status_code=204)


@router.post("/users/{user_id}/password", status_code=204)
async def admin_set_password(
    user_id: uuid.UUID,
    body: SetPasswordRequest,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Admin-only reset of another user's password within the caller's tenant.

    The recovery path when someone is locked out — previously the only remedy
    was creating a replacement user, because nothing could rewrite a hash.
    """
    if not any(r in ADMIN_ROLES for r in ctx.roles):
        raise HTTPException(status_code=403, detail="Requires admin role")
    user = await session.get(User, user_id)
    # Tenant check folded into the 404 so an admin cannot probe for user ids
    # belonging to other tenants.
    if not user or user.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(body.new_password)
    await session.commit()
    return Response(status_code=204)


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    roles: list[str]


@router.post("/users", status_code=201)
async def create_user(
    body: CreateUserRequest,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    """Admin-only: create a user with specific roles within the caller's tenant."""
    if not any(r in ADMIN_ROLES for r in ctx.roles):
        raise HTTPException(status_code=403, detail="Requires admin role")
    bad = [r for r in body.roles if r not in VALID_ROLES]
    if bad:
        raise HTTPException(status_code=422, detail=f"Invalid roles: {bad}")

    existing = await session.scalar(
        select(User).where(
            User.tenant_id == ctx.tenant_id, User.email == body.email.lower()
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        tenant_id=ctx.tenant_id,
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        is_active=True,
    )
    session.add(user)
    await session.flush()
    for role_name in body.roles:
        session.add(Role(tenant_id=ctx.tenant_id, user_id=user.id, role_name=role_name))
    await session.commit()
    return {"user_id": str(user.id), "email": user.email, "roles": body.roles}


@router.get("/users")
async def list_users(
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    if not any(r in ADMIN_ROLES for r in ctx.roles):
        raise HTTPException(status_code=403, detail="Requires admin role")
    rows = await session.scalars(select(User).where(User.tenant_id == ctx.tenant_id))
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "is_active": u.is_active,
            "roles": [r.role_name for r in u.roles]
        }
        for u in rows
    ]


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: uuid.UUID,
    ctx: RequestContext = Depends(get_context),
    session: AsyncSession = Depends(get_session),
):
    if not any(r in ADMIN_ROLES for r in ctx.roles):
        raise HTTPException(status_code=403, detail="Requires admin role")
    user = await session.get(User, user_id)
    if not user or user.tenant_id != ctx.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    await session.commit()
    return {"detail": "User deactivated"}
