from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "reporting-service"
    db_schema: str = "reporting_schema"

    payroll_url: str = "http://payroll-service:4005"
    blobstore_url: str = "http://blobstore-service:4010"
    reports_dir: str = "/app/reports"


settings = Settings()
