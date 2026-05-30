from hr_shared import AuditBase, TenantAwareBase
from hr_shared.service import ServiceRuntime
from .settings import settings
from . import models  # noqa: F401 — registers all models with metadata
from .models import NotificationBase

# payroll-service owns audit_schema writes and notification_schema.
runtime = ServiceRuntime(
    settings,
    TenantAwareBase.metadata,
    AuditBase.metadata,
    NotificationBase.metadata,
)
get_session = runtime.get_session
get_context = runtime.get_context
