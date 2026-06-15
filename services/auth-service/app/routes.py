from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from hr_shared import RequestContext, create_access_token
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .deps import get_context, get_session
from .models import Role, Tenant, User
from .schemas import LoginRequest, MeResponse, RegisterRequest, TokenResponse
from .security import hash_password, verify_password
from .settings import settings

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# First registered admin gets the full admin role set for V1.
BOOTSTRAP_ROLES = ["ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN"]
VALID_ROLES = {"SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN", "EMPLOYEE"}
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
    # A tenant row is scoped to itself: tenant_id == its own id.
    tenant_id = uuid.uuid4()
    tenant = Tenant(id=tenant_id, tenant_id=tenant_id, name=body.tenant_name)
    session.add(tenant)

    existing = await session.scalar(
        select(User).where(
            User.tenant_id == tenant_id, User.email == body.email.lower()
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        tenant_id=tenant_id,
        email=body.email.lower(),
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
    # Login using email only, grabbing the first match if cross-tenant emails exist.
    user = (
        await session.scalars(
            select(User).where(
                User.email == body.email.lower(),
            )
        )
    ).first()
    if not user or not verify_password(body.password, user.password_hash):
        # Generic message: do not reveal whether tenant_id or password was wrong.
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
