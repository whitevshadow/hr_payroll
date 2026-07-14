from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "payroll-service"
    db_schema: str = "payroll_schema"

    # Downstream service URLs (container-name addressing in compose).
    employee_url: str = "http://employee-service:4002"
    salary_url: str = "http://salary-service:4003"
    attendance_url: str = "http://attendance-service:4004"
    tds_url: str = "http://tds-service:4006"
    compliance_url: str = "http://compliance-service:4007"
    payout_url: str = "http://payout-service:4008"
    reporting_url: str = "http://reporting-service:4009"

    http_timeout_seconds: float = 15.0
    # Payslip generation renders a PDF per employee, so it is measured in
    # minutes for a large cycle — not comparable to the lookups above.
    report_timeout_seconds: float = 300.0


settings = Settings()
