import os
import re

tables_to_update = [
    'attendance_audit', 'attendance_months', 'attendance_records',
    'audit_logs', 'notifications',
    'esi_contributions', 'pf_contributions', 'pt_deductions',
    'departments', 'locations',
    'payout_batches', 'payout_transactions',
    'payroll_cycles', 'payroll_results',
    'generated_reports',
    'salary_components', 'salary_structures',
    'declaration_versions', 'employee_declarations', 'employee_tax_profiles',
    'form122', 'form16', 'proof_documents', 'tax_audit_log', 'tax_computations',
    'tax_projections', 'tax_regime_history', 'tax_traces', 'tds_calculations',
    'tds_declarations', 'tds_ledger', 'tds_snapshots',
    'blob_outbox', 'blobs', 'document_audit', 'document_registry', 'employee_documents'
]

# Update schema.sql
schema_path = 'schema.sql'
if os.path.exists(schema_path):
    with open(schema_path, 'r', encoding='utf-8') as f:
        content = f.read()

    for table in tables_to_update:
        pattern = r"(CREATE TABLE [a-zA-Z0-9_]+\." + table + r"\s*\(\n)"
        replacement = r"\g<1>    client_id uuid,\n"
        content = re.sub(pattern, replacement, content)

    with open(schema_path, 'w', encoding='utf-8') as f:
        f.write(content)
else:
    print("schema.sql not found")

# Update db_schemas.md
md_path = 'db_schemas.md'
if os.path.exists(md_path):
    with open(md_path, 'r', encoding='utf-8') as f:
        md_content = f.read()

    for table in tables_to_update:
        pattern = r"([a-zA-Z0-9_]+_" + table + r" \{\n)"
        replacement = r"\g<1>    uuid client_id\n"
        md_content = re.sub(pattern, replacement, md_content)

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)

# Update hr_payroll_schema_redesign.mermaid
mermaid_path = 'hr_payroll_schema_redesign.mermaid'
if os.path.exists(mermaid_path):
    with open(mermaid_path, 'r', encoding='utf-8') as f:
        mermaid_content = f.read()

    for table in tables_to_update:
        pattern = r"([a-zA-Z0-9_]+_" + table + r" \{\n)"
        replacement = r"\g<1>    uuid client_id\n"
        mermaid_content = re.sub(pattern, replacement, mermaid_content)

    with open(mermaid_path, 'w', encoding='utf-8') as f:
        f.write(mermaid_content)

print("Schemas updated.")
