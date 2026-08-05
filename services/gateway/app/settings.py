from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "gateway"

    # Origins allowed to call the gateway cross-origin (JSON list in the env
    # var, e.g. CORS_ALLOW_ORIGINS=["https://hr.example.com"]). The shipped
    # frontend never needs this — nginx proxies /api/ same-origin — but direct
    # gateway access (local dev without nginx, a separately hosted frontend,
    # mobile/API clients) does. Override via CORS_ALLOW_ORIGINS in production
    # instead of editing code.
    cors_allow_origins: list[str] = [
        "http://localhost:4050",
        "http://127.0.0.1:4050",
        "http://localhost:4000",
        "http://127.0.0.1:4000",
    ]

    # Downstream service base URLs (container-name addressing in compose).
    auth_url: str = "http://auth-service:4001"
    employee_url: str = "http://employee-service:4002"
    salary_url: str = "http://salary-service:4003"
    attendance_url: str = "http://attendance-service:4004"
    payroll_url: str = "http://payroll-service:4005"
    compliance_url: str = "http://compliance-service:4007"
    payout_url: str = "http://payout-service:4008"
    reporting_url: str = "http://reporting-service:4009"
    blobstore_url: str = "http://blobstore-service:4010"
    client_url: str = "http://client-service:4011"


settings = Settings()

# Path-prefix -> downstream base URL. Order matters: longest/most specific
# prefixes are matched first.
ROUTES: list[tuple[str, str]] = [
    ("/api/v1/auth", settings.auth_url),
    ("/api/v1/employees", settings.employee_url),
    ("/api/v1/departments", settings.employee_url),
    ("/api/v1/salary", settings.salary_url),
    ("/api/v1/attendance", settings.attendance_url),
    ("/api/v1/leave", settings.attendance_url),          # leave management lives in attendance-service
    ("/api/v1/compliance", settings.compliance_url),
    ("/api/v1/payroll", settings.payroll_url),
    ("/api/v1/audit", settings.payroll_url),
    ("/api/v1/notifications", settings.payroll_url),
    ("/api/v1/events", settings.payroll_url),
    ("/api/v1/payouts", settings.payout_url),
    ("/api/v1/reports", settings.reporting_url),
    ("/api/v1/blobs", settings.blobstore_url),
    ("/api/v1/bucket-config", settings.blobstore_url),
    ("/api/v1/registry", settings.blobstore_url),
    ("/api/v1/clients", settings.client_url),
    ("/api/v1/locations", settings.employee_url),
    ("/api/v1/employee-docs", settings.blobstore_url),
    ("/api/v1/financial-years", settings.employee_url),
    ("/api/v1/rate-cards", settings.employee_url),
]

# Public paths that bypass JWT validation at the gateway.
PUBLIC_PATHS = {"/api/v1/auth/login", "/api/v1/auth/register"}
