import asyncio
import uuid
import sys
import os
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

# Setup system path to include shared and service packages
sys.path.append(os.path.abspath('shared'))
sys.path.append(os.path.abspath('services/employee-service'))

from app.settings import settings
from hr_shared.db import build_engine
from hr_shared.base import TenantAwareBase
from app.models import Employee, Location
from sqlalchemy import text

# Initialize DB connection using settings
engine = build_engine(settings.database_url, settings.db_schema)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# Known default locations based on the prompt
DEFAULT_LOCATIONS = [
    {"location_name": "Delhi", "city": "New Delhi", "state": "Delhi", "country": "India"},
    {"location_name": "Bengaluru", "city": "Bengaluru", "state": "Karnataka", "country": "India"},
    {"location_name": "Pune", "city": "Pune", "state": "Maharashtra", "country": "India"},
    {"location_name": "Chennai", "city": "Chennai", "state": "Tamil Nadu", "country": "India"},
    {"location_name": "Mumbai", "city": "Mumbai", "state": "Maharashtra", "country": "India"},
    {"location_name": "Hyderabad", "city": "Hyderabad", "state": "Telangana", "country": "India"},
    {"location_name": "Kolkata", "city": "Kolkata", "state": "West Bengal", "country": "India"},
    {"location_name": "Ahmedabad", "city": "Ahmedabad", "state": "Gujarat", "country": "India"},
]

async def migrate():
    # Ensure schema and tables exist first
    async with engine.begin() as conn:
        await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {settings.db_schema}"))
        await conn.run_sync(TenantAwareBase.metadata.create_all)
        
        # Ensure new columns exist on employees table
        for col_name, col_type in [
            ("location_id", "UUID REFERENCES locations(id)"),
            ("city", "VARCHAR(100)"),
            ("state", "VARCHAR(100)"),
            ("branch", "VARCHAR(100)"),
            ("work_location", "VARCHAR(120)")
        ]:
            check_sql = text(f"""
                SELECT EXISTS (
                    SELECT 1 
                    FROM information_schema.columns 
                    WHERE table_schema = '{settings.db_schema}' 
                      AND table_name = 'employees' 
                      AND column_name = '{col_name}'
                )
            """)
            result = await conn.execute(check_sql)
            exists = result.scalar()
            if not exists:
                print(f"Adding column '{col_name}' to 'employees' table...")
                await conn.execute(text(f"ALTER TABLE employees ADD COLUMN {col_name} {col_type}"))

    async with AsyncSessionLocal() as session:
        # 1. Ensure Locations exist
        locations_by_name = {}
        for loc_data in DEFAULT_LOCATIONS:
            # Check if exists
            result = await session.execute(
                select(Location).where(Location.location_name == loc_data["location_name"])
            )
            loc = result.scalar_one_or_none()
            if not loc:
                # We need to assign a tenant_id. Since this is a multi-tenant system, 
                # we should probably do this per-tenant. Let's find all tenants.
                # Actually, the simplest is to fetch all unique tenant_ids from employees
                # and create locations for each tenant.
                pass
            
        # Get all distinct tenant IDs from employees
        result = await session.execute(select(Employee.tenant_id).distinct())
        tenant_ids = [row[0] for row in result.all()]

        print(f"Found {len(tenant_ids)} tenants.")

        for tenant_id in tenant_ids:
            tenant_locations = {}
            for loc_data in DEFAULT_LOCATIONS:
                result = await session.execute(
                    select(Location).where(
                        Location.tenant_id == tenant_id,
                        Location.location_name == loc_data["location_name"]
                    )
                )
                loc = result.scalar_one_or_none()
                if not loc:
                    loc = Location(
                        tenant_id=tenant_id,
                        location_name=loc_data["location_name"],
                        city=loc_data["city"],
                        state=loc_data["state"],
                        country=loc_data["country"]
                    )
                    session.add(loc)
                    await session.commit()
                    await session.refresh(loc)
                    print(f"Created location {loc.location_name} for tenant {tenant_id}")
                tenant_locations[loc.location_name.lower()] = loc
            
            # Now migrate employees for this tenant
            result = await session.execute(
                select(Employee).where(Employee.tenant_id == tenant_id)
            )
            employees = result.scalars().all()
            
            updated = 0
            # Mapping of known legacy aliases or nearby towns to master locations
            LOCATION_ALIASES = {
                "bangalore": "bengaluru",
                "chakan": "pune",
                "moshi": "pune",
            }
            
            for emp in employees:
                if emp.work_location and not emp.location_id:
                    # Match work_location to location_name
                    wl_lower = emp.work_location.lower().strip()
                    if wl_lower in LOCATION_ALIASES:
                        wl_lower = LOCATION_ALIASES[wl_lower]
                    matched_loc = tenant_locations.get(wl_lower)
                    
                    if matched_loc:
                        emp.location_id = matched_loc.id
                        emp.city = matched_loc.city
                        emp.state = matched_loc.state
                        updated += 1
                    else:
                        print(f"Warning: Employee {emp.emp_code} has unrecognized work_location '{emp.work_location}'.")
                elif not emp.location_id:
                    # Default to Maharashtra/Mumbai if no location
                    default_loc = tenant_locations.get("mumbai")
                    if default_loc:
                        emp.location_id = default_loc.id
                        emp.city = default_loc.city
                        emp.state = default_loc.state
                        emp.work_location = default_loc.location_name
                        updated += 1
            
            if updated > 0:
                await session.commit()
                print(f"Updated {updated} employees for tenant {tenant_id}.")

    print("Migration complete.")

if __name__ == "__main__":
    asyncio.run(migrate())
