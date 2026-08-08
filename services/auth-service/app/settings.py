from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "auth-service"
    db_schema: str = "auth_schema"

    # Optional first-run admin provisioning — see bootstrap.py. Both the email
    # and the password must be set for anything to happen; there is
    # intentionally no default password.
    bootstrap_admin_email: str = ""
    bootstrap_admin_password: str = ""
    bootstrap_admin_tenant: str = "Default Organization"


settings = Settings()
