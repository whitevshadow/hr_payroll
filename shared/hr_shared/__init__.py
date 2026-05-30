"""Shared cross-cutting library for the HR & Payroll SaaS V1 platform."""

from .base import TenantAwareBase
from .config import BaseServiceSettings
from .db import build_engine, build_session_factory, get_session_dependency
from .auth import (
    RequestContext,
    build_context_dependency,
    create_access_token,
    decode_token,
)
from .money import Money, money, ZERO
from .audit import AuditBase, AuditLog, audit_log, ensure_audit_schema

__all__ = [
    "TenantAwareBase",
    "BaseServiceSettings",
    "build_engine",
    "build_session_factory",
    "get_session_dependency",
    "RequestContext",
    "build_context_dependency",
    "create_access_token",
    "decode_token",
    "Money",
    "money",
    "ZERO",
    "AuditBase",
    "AuditLog",
    "audit_log",
    "ensure_audit_schema",
]
