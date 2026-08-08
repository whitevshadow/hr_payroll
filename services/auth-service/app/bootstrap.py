"""First-run admin provisioning.

Creates one tenant + one admin user so a fresh deployment (Coolify, or any
`docker compose up` on an empty volume) is immediately loggable-into without
shelling in to run `scripts/seed.py`.

Driven by BOOTSTRAP_ADMIN_EMAIL; the shipped compose file supplies a default so
this works with no configuration at all. If BOOTSTRAP_ADMIN_PASSWORD is unset a
strong one is generated at first boot and printed once to the log.

There is deliberately no *fixed* default password. This repository is public, so
a committed password would be a published credential for every deployment made
from it — and this system stores PAN, Aadhaar and bank details. A generated
password costs one look at the container log and is unique per deployment.

Idempotent: re-runs on every boot and does nothing once the account exists.
"""

from __future__ import annotations

import logging
import secrets
import string
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

# Unambiguous alphabet — the generated password is read off a log and retyped,
# so O/0 and l/1/I are omitted rather than risking a transcription failure that
# is indistinguishable from a wrong password.
_PASSWORD_ALPHABET = "".join(
    c for c in string.ascii_letters + string.digits if c not in "O0lI1"
)


def _generate_password(length: int = 20) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


async def ensure_bootstrap_admin(
    session_factory: async_sessionmaker[AsyncSession], settings: Settings
) -> None:
    """Create the initial tenant + admin if configured and not already present.

    Never raises: a misconfigured bootstrap must not take auth-service down and
    lock every user out. Problems are logged and provisioning is skipped.
    """
    email = (settings.bootstrap_admin_email or "").strip().lower()
    password = settings.bootstrap_admin_password or ""

    if not email:
        log.info(
            "BOOTSTRAP_ADMIN_EMAIL not set — skipping admin provisioning. "
            "Register the first tenant via POST /api/v1/auth/register."
        )
        return

    # An unset or placeholder password is not an error: generate one and show it
    # once. Refusing to provision would leave a closed-registration deployment
    # with no way in at all.
    generated = False
    if not password or password in _PLACEHOLDER_PASSWORDS:
        password = _generate_password()
        generated = True
    elif len(password) < _MIN_PASSWORD_LENGTH:
        log.error(
            "BOOTSTRAP_ADMIN_PASSWORD is shorter than %d characters — skipping "
            "admin provisioning. Set a longer one, or leave it unset to have one "
            "generated.",
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

        if generated:
            # Printed once, only on the boot that created the account, and only
            # for a password this process generated — a supplied one is never
            # echoed. Boxed because this is the sole copy: it is not stored
            # anywhere in plaintext and cannot be recovered from the hash.
            log.warning(
                "\n"
                "  ┌─────────────────────────────────────────────────────────────┐\n"
                "  │  ADMIN ACCOUNT CREATED — copy this password now             │\n"
                "  ├─────────────────────────────────────────────────────────────┤\n"
                "  │  email    : %-47s │\n"
                "  │  password : %-47s │\n"
                "  ├─────────────────────────────────────────────────────────────┤\n"
                "  │  Shown once. Not recoverable — it is stored only as a hash. │\n"
                "  └─────────────────────────────────────────────────────────────┘",
                email,
                password,
            )
        log.info(
            "Provisioned bootstrap admin %s (tenant %r, roles %s).",
            email,
            settings.bootstrap_admin_tenant,
            ", ".join(BOOTSTRAP_ROLES),
        )
    except Exception:  # noqa: BLE001 — see docstring: must never block startup
        log.exception("Bootstrap admin provisioning failed — continuing startup.")
