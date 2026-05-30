from hr_shared import TenantAwareBase
from hr_shared.service import ServiceRuntime
from .settings import settings
from . import models  # noqa: F401 — registers tables with TenantAwareBase.metadata

runtime = ServiceRuntime(settings, TenantAwareBase.metadata)
get_session = runtime.get_session
get_context = runtime.get_context

