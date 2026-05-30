from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "payroll-service"
    db_schema: str = "payroll_schema"

    # Downstream service URLs (container-name addressing in compose).
    employee_url: str = "http://employee-service:8003"
    salary_url: str = "http://salary-service:8004"
    attendance_url: str = "http://attendance-service:8005"
    tds_url: str = "http://tds-service:8007"
    compliance_url: str = "http://compliance-service:8008"
    payout_url: str = "http://payout-service:8009"
    reporting_url: str = "http://reporting-service:8010"

    http_timeout_seconds: float = 15.0


settings = Settings()
