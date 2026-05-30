from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "salary-service"
    db_schema: str = "salary_schema"


settings = Settings()

# VERIFY against current government / HR policy before real use.
METRO_CITIES = {"Mumbai", "Delhi", "Kolkata", "Chennai"}
