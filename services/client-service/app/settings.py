from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "client-service"


settings = Settings()
