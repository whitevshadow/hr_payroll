import sys
import importlib.util
from pathlib import Path
from sqlalchemy import create_engine, inspect

DB_URL = "postgresql://hr:hr@postgres:5432/hr_payroll"

def main():
    engine = create_engine(DB_URL)
    insp = inspect(engine)

    # Let's iterate over all services
    base_dir = Path(__file__).parent.parent
    if True:
        engine = create_engine("postgresql://hr:hr@postgres:5432/hr_payroll")
        insp = inspect(engine)

    services_dir = base_dir / "services"
    
    missing_in_db = []
    
    for service_path in services_dir.glob("*"):
        if not service_path.is_dir(): continue
        models_path = service_path / "app" / "models.py"
        print(f"Checking {models_path}")
        if not models_path.exists(): continue
        
        # Load the module
        spec = importlib.util.spec_from_file_location(f"models_{service_path.name}", str(models_path))
        mod = importlib.util.module_from_spec(spec)
        
        # We need to add shared to sys.path so it can import hr_shared
        sys.path.insert(0, str(base_dir))
        try:
            spec.loader.exec_module(mod)
        except Exception as e:
            # print(f"Error loading {service_path.name}: {e}")
            continue
            
        # Find all SQLAlchemy models
        for attr_name in dir(mod):
            attr = getattr(mod, attr_name)
            if hasattr(attr, "__tablename__") and hasattr(attr, "__table__"):
                schema = attr.__table__.schema or "public"
                table_name = attr.__tablename__
                
                # Get DB columns
                try:
                    db_columns = {c["name"] for c in insp.get_columns(table_name, schema=schema)}
                except Exception as e:
                    print(f"Table {schema}.{table_name} not found in DB!")
                    continue
                    
                model_columns = {c.name for c in attr.__table__.columns}
                
                missing = model_columns - db_columns
                if missing:
                    print(f"[{service_path.name}] {schema}.{table_name} missing in DB: {missing}")
                    missing_in_db.append((schema, table_name, missing))

if __name__ == "__main__":
    main()
