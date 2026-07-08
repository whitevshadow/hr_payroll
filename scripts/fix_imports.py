import os

files_to_fix = ['Leave.tsx', 'Compliance.tsx', 'Reports.tsx', 'Salary.tsx']
base_dir = r"d:\hr_payroll-develop__anish\frontend\src\pages"

for fname in files_to_fix:
    path = os.path.join(base_dir, fname)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Remove Users from React import
    if "import { Users, useState } from \"react\";" in content:
        content = content.replace("import { Users, useState } from \"react\";", "import { useState } from \"react\";")
    elif "import { Users, useMemo" in content:
        content = content.replace("import { Users, useMemo", "import { useMemo")
        
    # 2. Add Users to lucide-react import
    # Look for import { ... } from "lucide-react";
    import_lucide_str = 'from "lucide-react";'
    if import_lucide_str in content and "Users" not in content.split(import_lucide_str)[0].split("import {")[-1]:
        # Need to insert Users into lucide-react
        # Let's just find "lucide-react" line and prepend Users
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if "lucide-react" in line:
                lines[i] = line.replace('import {', 'import { Users,')
                break
        content = '\n'.join(lines)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Fixed {fname}")
