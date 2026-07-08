import sys
import importlib.util
from pathlib import Path
import psycopg2

def get_db_schema(service_path):
    settings_file = service_path / "app" / "settings.py"
    if not settings_file.exists():
        return "public"
    
    spec = importlib.util.spec_from_file_location("settings", str(settings_file))
    module = importlib.util.module_from_spec(spec)
    sys.modules["settings"] = module
    try:
        spec.loader.exec_module(module)
        return module.settings.db_schema
    except Exception as e:
        print(f"Error reading schema from {settings_file}: {e}")
        return "public"

def main():
    root = Path("/workspace")
    services_dir = root / "services"
    conn = psycopg2.connect("postgresql://hr:hr@postgres:5432/hr_payroll")
    cursor = conn.cursor()

    for service_path in services_dir.glob("*"):
        if not service_path.is_dir(): continue
        models_path = service_path / "app" / "models.py"
        if not models_path.exists(): continue
        
        db_schema = get_db_schema(service_path)
        print(f"\n--- Checking {service_path.name} (Schema: {db_schema}) ---")

        spec = importlib.util.spec_from_file_location("models", str(models_path))
        module = importlib.util.module_from_spec(spec)
        sys.modules["models"] = module
        try:
            spec.loader.exec_module(module)
        except Exception as e:
            print(f"Error loading {models_path}: {e}")
            continue

        for name in dir(module):
            attr = getattr(module, name)
            if hasattr(attr, "__tablename__") and hasattr(attr, "__table__"):
                table_name = attr.__tablename__
                
                try:
                    cursor.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '{db_schema}' AND table_name = '{table_name}';")
                    db_columns = {row[0] for row in cursor.fetchall()}
                except Exception as e:
                    print(f"Error fetching DB columns for {db_schema}.{table_name}: {e}")
                    conn.rollback()
                    continue
                
                if not db_columns:
                    print(f"Table {db_schema}.{table_name} NOT FOUND in DB!")
                    continue
                
                model_columns = {c.name for c in attr.__table__.columns}
                missing = model_columns - db_columns
                
                if missing:
                    print(f"Table {db_schema}.{table_name} missing columns: {missing}")

if __name__ == "__main__":
    main()
