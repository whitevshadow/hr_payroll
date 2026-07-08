import os
import re

base_dir = r"d:\hr_payroll-develop__anish\frontend\src\pages"

for fname in os.listdir(base_dir):
    if not fname.endswith('.tsx'): continue
    path = os.path.join(base_dir, fname)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    
    # Let's find all occurrences of imports from "lucide-react"
    # We want to consolidate them if there are multiple.
    lines = content.split('\n')
    lucide_imports = []
    lucide_indices = []
    
    for i, line in enumerate(lines):
        if 'from "lucide-react"' in line:
            lucide_indices.append(i)
            # Extract what's inside { ... }
            match = re.search(r'import\s+\{([^}]+)\}\s+from\s+"lucide-react"', line)
            if match:
                imports = [x.strip() for x in match.group(1).split(',')]
                lucide_imports.extend([x for x in imports if x])
    
    if len(lucide_indices) > 1:
        # We have multiple imports from lucide-react! Consolidate them.
        unique_imports = sorted(list(set(lucide_imports)))
        consolidated_line = f'import {{ {", ".join(unique_imports)} }} from "lucide-react";'
        
        # Replace the first one with the consolidated line
        first_idx = lucide_indices[0]
        lines[first_idx] = consolidated_line
        
        # Remove the rest
        for idx in sorted(lucide_indices[1:], reverse=True):
            lines.pop(idx)
            
        content = '\n'.join(lines)
        
    if content != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed duplicate lucide-react imports in {fname}")

