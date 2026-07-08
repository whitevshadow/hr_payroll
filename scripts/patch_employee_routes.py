import re

file_path = 'services/employee-service/app/routes.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update imports
content = content.replace(
    "from .deps import get_context, get_session, runtime",
    "from .deps import get_context, get_client_context, get_session, runtime"
)

# 2. Replace Depends(get_context) with Depends(get_client_context) in route signatures
# Except for some global admin routes if any. For now let's replace all.
content = content.replace("Depends(get_context)", "Depends(get_client_context)")
content = content.replace("ctx: RequestContext = Depends(_admin)", "ctx: RequestContext = Depends(_admin)\n    # TODO: _admin should also enforce client context if needed, but _admin wraps get_context")

# Actually, _admin in routes.py:
# _admin = runtime.require_roles("ORG_ADMIN", ...)
# It relies on get_context. I should change the queries directly.

# 3. Add client_id to queries
models = ["Location", "Department", "Employee", "FinancialYear", "WorkflowDefinition", "WorkflowInstance", "WorkflowStepAction"]
for m in models:
    content = content.replace(
        f"{m}.tenant_id == ctx.tenant_id",
        f"{m}.tenant_id == ctx.tenant_id, {m}.client_id == ctx.client_id"
    )
    content = content.replace(
        f"{m}(tenant_id=ctx.tenant_id,",
        f"{m}(tenant_id=ctx.tenant_id, client_id=ctx.client_id,"
    )

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated employee routes.py")
