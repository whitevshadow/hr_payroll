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
# "slabs" is a list of (gross_upper_limit, amount) checked in ascending order;
# gross above the last limit pays "regular" ("february" in Feb). States that
# exempt women below a gross threshold set "women_exempt_upto".
# VERIFY against current state government notification.
PT_SLABS: dict[str, dict] = {
    "Maharashtra": {
        "slabs": [(Decimal("7500"), Decimal("0")), (Decimal("10000"), Decimal("175"))],
        "regular": Decimal("200"),
        "february": Decimal("300"),
        "women_exempt_upto": Decimal("25000"),
    },
    "Karnataka": {
        "slabs": [(Decimal("24999"), Decimal("0"))],
        "regular": Decimal("200"),
        "february": Decimal("200"),
    },
    "WestBengal": {
        "slabs": [
            (Decimal("10000"), Decimal("0")),
            (Decimal("15000"), Decimal("110")),
            (Decimal("25000"), Decimal("130")),
            (Decimal("40000"), Decimal("150")),
        ],
        "regular": Decimal("200"),
        "february": Decimal("200"),
    },
}
PT_DEFAULT: dict = {"regular": Decimal("200"), "february": Decimal("200")}
