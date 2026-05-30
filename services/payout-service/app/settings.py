from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "payout-service"
    db_schema: str = "payout_schema"


settings = Settings()
