#!/usr/bin/env python3
"""
Performance Indexes Migration for HRMS V2.0.
Creates high-performance indexes CONCURRENTLY for large tables.
"""

import os
import sys
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine

# Load env file manually for standalone script
env_file = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                os.environ[k] = v

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("DATABASE_URL not found in .env")
    sys.exit(1)

# Ensure asyncpg driver
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)

async def run_migrations():
    # CONCURRENTLY requires isolation_level="AUTOCOMMIT"
    engine = create_async_engine(db_url, echo=True, isolation_level="AUTOCOMMIT")
    
    queries = [
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_tenant_client ON employees (tenant_id, client_id)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_tenant_month ON attendance (tenant_id, month)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payroll_results_cycle_tenant ON payroll_results (tenant_id, cycle_id)",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leave_requests_tenant_emp ON leave_requests (tenant_id, employee_id)"
    ]

    async with engine.connect() as conn:
        from sqlalchemy import text
        for query in queries:
            try:
                await conn.execute(text(query))
                print(f"Executed: {query}")
            except Exception as e:
                print(f"Error executing {query}: {e}")

    print("Indexes created successfully!")

if __name__ == "__main__":
    asyncio.run(run_migrations())
