import os
import re

services = [
    'attendance-service',
    'compliance-service',
    'payout-service',
    'payroll-service',
    'reporting-service',
    'salary-service',
    'tds-service'
]

# Models per service that need client_id appended in constructor and query
service_models = {
    'attendance-service': ['AttendanceRecord', 'AttendanceMonth', 'AttendanceAudit', 'LeavePolicy', 'LeaveBalance', 'LeaveRequest', 'LeaveTransaction'],
    'compliance-service': ['EsiContribution', 'PfContribution', 'PtDeduction'],
    'payout-service': ['PayoutBatch', 'PayoutTransaction'],
    'payroll-service': ['PayrollCycle', 'PayrollResult'],
    'reporting-service': ['GeneratedReport'],
    'salary-service': ['SalaryComponent', 'SalaryStructure'],
    'tds-service': ['DeclarationVersion', 'EmployeeDeclaration', 'EmployeeTaxProfile', 'Form122', 'Form16', 'ProofDocument', 'TaxAuditLog', 'TaxComputation', 'TaxProjection', 'TaxRegimeHistory', 'TaxTrace', 'TdsCalculation', 'TdsDeclaration', 'TdsLedger', 'TdsSnapshot']
}

for svc in services:
    deps_path = f"services/{svc}/app/deps.py"
    if os.path.exists(deps_path):
        with open(deps_path, 'r', encoding='utf-8') as f:
            content = f.read()
        if "get_client_context =" not in content:
            content = content.replace(
                "from .settings import settings",
                "from hr_shared.auth import build_client_context_dependency\nfrom .settings import settings"
            )
            content = content.replace(
                "get_context = runtime.get_context",
                "get_context = runtime.get_context\nget_client_context = build_client_context_dependency(get_context)"
            )
            with open(deps_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Patched {deps_path}")

    routes_path = f"services/{svc}/app/routes.py"
    if os.path.exists(routes_path):
        with open(routes_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Add get_client_context to imports
        content = re.sub(
            r"from \.deps import (.*?)get_context(.*?)",
            r"from .deps import \1get_context, get_client_context\2",
            content
        )
        
        content = content.replace("Depends(get_context)", "Depends(get_client_context)")
        content = content.replace("get_ctx=get_context", "get_ctx=get_client_context")
        
        # _admin require_roles fix
        content = re.sub(
            r"_admin = runtime\.require_roles\((.*?)\)",
            r"_admin = runtime.require_roles(\1, get_ctx=get_client_context)",
            content
        )
        
        models = service_models.get(svc, [])
        for m in models:
            # Query filter
            content = content.replace(
                f"{m}.tenant_id == ctx.tenant_id",
                f"{m}.tenant_id == ctx.tenant_id, {m}.client_id == ctx.client_id"
            )
            # Constructor
            content = content.replace(
                f"{m}(tenant_id=ctx.tenant_id,",
                f"{m}(tenant_id=ctx.tenant_id, client_id=ctx.client_id,"
            )
        
        with open(routes_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Patched {routes_path}")

print("All backend services patched.")
