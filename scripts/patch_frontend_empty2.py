import os
import re

files_to_patch = ['Leave.tsx', 'Compliance.tsx', 'Reports.tsx', 'Salary.tsx']
base_dir = r"d:\hr_payroll-develop__anish\frontend\src\pages"

empty_state_block = """
  if (!selectedClientId) {
    return (
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center mt-6">
        <Users className="h-12 w-12 text-slate-300 mb-4" />
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">No Client Selected</h2>
        <p className="text-slate-500 mt-2 max-w-sm">Please select a client from the top navigation bar to proceed.</p>
      </div>
    );
  }
"""

for fname in files_to_patch:
    path = os.path.join(base_dir, fname)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add Users import if missing
    if "import { Users" not in content and "import { Users," not in content:
        content = content.replace('import {', 'import { Users,', 1)

    component_name = fname.replace('.tsx', '')
    match = re.search(r"export function " + component_name + r"\s*\(\)\s*{", content)
    if match:
        start_idx = match.end()
        return_match = re.search(r"return\s+\(", content[start_idx:])
        if return_match:
            insert_idx = start_idx + return_match.start()
            content = content[:insert_idx] + empty_state_block + "\n  " + content[insert_idx:]

            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Patched {fname}")
