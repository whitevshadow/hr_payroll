import re
from pathlib import Path

# Load DB columns
db_columns = set()
with open("d:/hr_payroll-develop__anish/scripts/db_columns.txt", "r") as f:
    for line in f:
        line = line.strip()
        if not line or '|' not in line: continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) == 3 and parts[0] != 'table_schema':
            schema, table, col = parts
            db_columns.add((schema, table, col))

# Read models.py from all services
services_dir = Path("d:/hr_payroll-develop__anish/services")
missing_in_db = []

for service_dir in services_dir.iterdir():
    if not service_dir.is_dir(): continue
    models_path = service_dir / "app" / "models.py"
    if not models_path.exists(): continue
    
    with open(models_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Find classes with __tablename__
    classes = re.findall(r'class\s+(\w+)\s*\(.*?\):[\s\S]*?__tablename__\s*=\s*"([^"]+)"([\s\S]*?)(?=\nclass|\Z)', content)
    
    for class_name, tablename, body in classes:
        # Simple heuristic to guess schema: most services use their name as schema (e.g. employee_schema)
        # Auth uses auth_schema. Client uses employee_schema (wait!). Let's just check all matching tablenames in DB.
        possible_schemas = {schema for schema, table, col in db_columns if table == tablename}
        if not possible_schemas:
            continue
            
        schema = list(possible_schemas)[0] # Just take the first matching schema
        
        # Find all Mapped columns
        columns = re.findall(r'(\w+):\s*Mapped\[', body)
        # Also find ForeignKey columns without Mapped type hinting if any
        # Also columns from TenantAwareBase: id, tenant_id, created_at, updated_at
        base_columns = {'id', 'tenant_id', 'created_at', 'updated_at'}
        
        for col in columns:
            if col not in base_columns and (schema, tablename, col) not in db_columns:
                missing_in_db.append((service_dir.name, class_name, schema, tablename, col))

with open("d:/hr_payroll-develop__anish/scripts/audit_results.txt", "w") as f:
    for item in missing_in_db:
        f.write(f"Service: {item[0]}, Class: {item[1]}, Table: {item[2]}.{item[3]}, Missing Column in DB: {item[4]}\n")
