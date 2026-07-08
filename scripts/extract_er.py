import re

with open('schema.sql', 'r', encoding='utf-16') as f:
    content = f.read()

# Extract tables
table_pattern = re.compile(r'CREATE TABLE ([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+) \((.*?)\);', re.DOTALL)
tables = table_pattern.findall(content)

# Extract FKs
fk_pattern = re.compile(r'ALTER TABLE ONLY ([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)\s+ADD CONSTRAINT [^\s]+ FOREIGN KEY \(([^\)]+)\) REFERENCES ([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)\(([^\)]+)\)', re.DOTALL)
fks = fk_pattern.findall(content)

mermaid = ['erDiagram']
for tname, cols in tables:
    safe = tname.replace('.', '_')
    mermaid.append(f'  {safe} {{')
    for line in cols.split('\n'):
        line = line.strip()
        if not line or line.startswith('CONSTRAINT') or line.startswith('PRIMARY KEY') or line.startswith('UNIQUE'):
            continue
        parts = line.split()
        if len(parts) >= 2:
            cname = parts[0].strip('"').replace(',', '')
            ctype = parts[1].split('(')[0].replace('"', '').replace(',', '')
            mermaid.append(f'    {ctype} {cname}')
    mermaid.append('  }')

for st, sc, tt, tc in fks:
    ss = st.replace('.', '_')
    ts = tt.replace('.', '_')
    sc_clean = sc.strip().replace('"', '')
    tc_clean = tc.strip().replace('"', '')
    mermaid.append(f'  {ts} ||--o{{ {ss} : "{sc_clean}=>{tc_clean}"')

with open('db_schemas.md', 'w', encoding='utf-8') as f:
    f.write('# Database Schemas & ER Diagram\n\n```mermaid\n' + '\n'.join(mermaid) + '\n```\n')
print(f'Extracted {len(tables)} tables and {len(fks)} fks')
