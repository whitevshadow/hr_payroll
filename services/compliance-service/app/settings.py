from decimal import Decimal

from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "compliance-service"
    db_schema: str = "compliance_schema"


settings = Settings()

# ---- Statutory constants (V1 defaults) --------------------------------
# VERIFY against current government notification before any real use.

PF_CEILING = Decimal("15000")
PF_EMPLOYEE_RATE = Decimal("0.12")
PF_EPS_RATE = Decimal("0.0833")

ESI_THRESHOLD = Decimal("21000")
ESI_EMPLOYEE_RATE = Decimal("0.0075")
ESI_EMPLOYER_RATE = Decimal("0.0325")

# PT slab table keyed by state. February differs in some states.
# VERIFY against current state government notification.
PT_SLABS: dict[str, dict[str, Decimal]] = {
    "Maharashtra": {"regular": Decimal("200"), "february": Decimal("300")},
    "Karnataka": {"regular": Decimal("200"), "february": Decimal("200")},
    "WestBengal": {"regular": Decimal("200"), "february": Decimal("200")},
}
PT_DEFAULT = {"regular": Decimal("200"), "february": Decimal("200")}
