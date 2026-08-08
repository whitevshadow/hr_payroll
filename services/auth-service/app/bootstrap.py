"""Optional first-run admin provisioning.

Creates one tenant + one admin user from environment variables so a fresh
deployment (Coolify, or any `docker compose up` on an empty volume) is
immediately loggable-into without shelling in to run `scripts/seed.py`.

Deliberately opt-in: with BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
unset nothing happens at all. There is no default password — a payroll system
that ships a known-credentials admin account is a far worse problem than one
that needs an extra deploy-time env var.

Idempotent: re-runs on every boot and does nothing once the account exists.
"""

from __future__ import annotations

import logging
import uuid

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .models import Role, Tenant, User
from .routes import BOOTSTRAP_ROLES
from .security import hash_password
from .settings import Settings

# Child of uvicorn's own logger: uvicorn configures handlers only for its
# namespace, so a top-level logger's INFO records would be dropped and the
# operator would never see whether provisioning ran.
log = logging.getLogger("uvicorn.error.bootstrap")

# Mirrors RegisterRequest.password (schemas.py) so the bootstrap path can't
# create an account weaker than the public /register endpoint would allow.
_MIN_PASSWORD_LENGTH = 8

# Placeholders from .env.example. Reaching a real deployment means the operator
# copied the template without editing it.
_PLACEHOLDER_PASSWORDS = {
    "CHANGE_ME",
    "CHANGE_ME_set_a_strong_admin_password",
}

# LoginRequest.email is an EmailStr, so an address this rejects could be stored
# here but never used to log in — reserved TLDs like `.local` are the trap.
# Validating with the same type keeps bootstrap and login in agreement.
_email_adapter = TypeAdapter(EmailStr)


async def ensure_bootstrap_admin(
    session_factory: async_sessionmaker[AsyncSession], settings: Settings
) -> None:
    """Create the initial tenant + admin if configured and not already present.

    Never raises: a misconfigured bootstrap must not take auth-service down and
    lock every user out. Problems are logged and provisioning is skipped.
    """
    email = (settings.bootstrap_admin_email or "").strip().lower()
    password = settings.bootstrap_admin_password or ""

    if not email or not password:
        log.info(
            "BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set — skipping admin provisioning. "
            "Register the first tenant via POST /api/v1/auth/register."
        )
        return

    if password in _PLACEHOLDER_PASSWORDS or len(password) < _MIN_PASSWORD_LENGTH:
        log.error(
            "BOOTSTRAP_ADMIN_PASSWORD is a placeholder or shorter than %d characters "
            "— skipping admin provisioning. Set a real password and redeploy.",
            _MIN_PASSWORD_LENGTH,
        )
        return

    try:
        _email_adapter.validate_python(email)
    except ValidationError as exc:
        reason = exc.errors()[0]["msg"] if exc.errors() else "invalid address"
        log.error(
            "BOOTSTRAP_ADMIN_EMAIL %r is not a valid login address (%s) — skipping "
            "admin provisioning. Reserved domains such as .local are rejected; "
            "use a real domain.",
            email,
            reason,
        )
        return

    try:
        async with session_factory() as session:
            # Scan across every tenant, not just the one we would create. Login
            # without an explicit tenant_id rejects an email that resolves to
            # more than one tenant (see routes.login), so provisioning a second
            # tenant for an existing address would make that address unusable.
            existing = (
                await session.scalars(select(User).where(User.email == email))
            ).all()
            if existing:
                log.info(
                    "Bootstrap admin %s already exists — nothing to do.", email
                )
                return

            # A tenant row is scoped to itself: tenant_id == its own id
            # (see routes.register).
            tenant_id = uuid.uuid4()
            session.add(
                Tenant(
                    id=tenant_id,
                    tenant_id=tenant_id,
                    name=settings.bootstrap_admin_tenant,
                )
            )
            user = User(
                tenant_id=tenant_id,
                email=email,
                password_hash=hash_password(password),
                is_active=True,
            )
            session.add(user)
            await session.flush()
            for role_name in BOOTSTRAP_ROLES:
                session.add(
                    Role(tenant_id=tenant_id, user_id=user.id, role_name=role_name)
                )
            await session.commit()

        log.info(
            "Provisioned bootstrap admin %s (tenant %r, roles %s).",
            email,
            settings.bootstrap_admin_tenant,
            ", ".join(BOOTSTRAP_ROLES),
        )
    except Exception:  # noqa: BLE001 — see docstring: must never block startup
        log.exception("Bootstrap admin provisioning failed — continuing startup.")
