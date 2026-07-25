from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "attendance-service"
    db_schema: str = "attendance_schema"


settings = Settings()
