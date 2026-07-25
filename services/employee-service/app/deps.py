from hr_shared import AuditBase, TenantAwareBase
from hr_shared.service import ServiceRuntime
from .settings import settings
from . import models  # noqa: F401 — registers tables with TenantAwareBase.metadata

from hr_shared.auth import build_client_context_dependency

runtime = ServiceRuntime(settings, TenantAwareBase.metadata, AuditBase.metadata)
get_session = runtime.get_session
get_context = runtime.get_context
get_client_context = build_client_context_dependency(get_context)
