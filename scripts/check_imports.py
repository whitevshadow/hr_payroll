"""
Definitive check: find files where lucide-react closing brace appears 
WITHOUT a matching 'import {' opener in the same block.
"""
import os
import re

base = r'd:\hr_payroll-develop__anish\frontend\src\pages'

for fname in sorted(os.listdir(base)):
    if not fname.endswith('.tsx'):
        continue
    path = os.path.join(base, fname)
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()

    # Find all lucide-react imports
    # Valid: import { ... } from "lucide-react";  (single or multi-line)
    # Invalid: } from "lucide-react"; appearing without its matching import {
    
    # Remove all valid lucide-react import blocks first
    cleaned = re.sub(r'import\s*\{[^}]*\}\s*from\s*"lucide-react";', '', content, flags=re.DOTALL)
    
    # Now check if there's any remaining '} from "lucide-react"' 
    if re.search(r'\}\s*from\s*"lucide-react"', cleaned):
        print(f"BROKEN: {fname} - has orphaned '}} from lucide-react'")
    # Also check for 'import {' that never closes before 'import ' on next line
    elif re.search(r'import\s*\{[^}]*\nimport\s', content):
        print(f"BROKEN: {fname} - import block interrupted by another import")
    else:
        print(f"OK: {fname}")
