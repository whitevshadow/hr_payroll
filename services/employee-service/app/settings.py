from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "employee-service"
    db_schema: str = "employee_schema"


settings = Settings()
