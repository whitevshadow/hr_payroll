import os
import re

files_to_patch = [
    'Cycles.tsx', 'Leave.tsx', 'LeaveBalance.tsx', 'Compliance.tsx', 
    'TDS.tsx', 'Reports.tsx', 'Salary.tsx', 'Departments.tsx', 
    'Locations.tsx', 'Payouts.tsx'
]

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
    if not os.path.exists(path):
        print(f"File {fname} not found!")
        continue
        
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    if "useClientContext" in content:
        print(f"Skipping {fname}, already patched.")
        continue
        
    # 1. Add imports
    imports = """import { useClientContext } from "../lib/ClientContext";
import { Users } from "lucide-react";"""
    if "EmptyState" not in content:
        imports += '\nimport { EmptyState } from "../components/EmptyState";'
        
    # We'll just insert imports after the first line (which is usually an import)
    lines = content.split('\n')
    lines.insert(1, imports)
    content = '\n'.join(lines)
    
    # 2. Inject context hook
    component_name = fname.replace('.tsx', '')
    match = re.search(r"export function " + component_name + r"\s*\(\)\s*{", content)
    if match:
        start_idx = match.end()
        injection = '\n  const { selectedClientId } = useClientContext();\n'
        content = content[:start_idx] + injection + content[start_idx:]
        
    # 3. Inject empty state before the first main return (
    # We will search for 'return (' after the component definition
    if match:
        # Find the first 'return (' after the function start
        return_match = re.search(r"return\s+\(", content[start_idx:])
        if return_match:
            insert_idx = start_idx + return_match.start()
            content = content[:insert_idx] + empty_state_block + "\n  " + content[insert_idx:]
            
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Patched {fname}")

