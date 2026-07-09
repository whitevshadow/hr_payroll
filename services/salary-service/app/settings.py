from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "salary-service"
    db_schema: str = "salary_schema"

    # TDS service base URL for the fire-and-forget auto-compute call.
    # Overridable via TDS_URL; defaults to the compose container address.
    tds_url: str = "http://tds-service:8007"


settings = Settings()

# VERIFY against current government / HR policy before real use.
METRO_CITIES = {"Mumbai", "Delhi", "Kolkata", "Chennai"}
