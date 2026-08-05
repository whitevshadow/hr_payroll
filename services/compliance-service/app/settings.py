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


# ── Labour Welfare Fund ───────────────────────────────────────────────────────
# LWF is contributed half-yearly (not monthly) in most states: the whole
# amount is deducted in the salary of the months listed in "months".
#   slabs: (monthly_wage_upto, employee_share, employer_share) — first match wins
#   default: (employee, employer) applied above the last slab
# Statutory defaults. VERIFY against current state notification — LWF rates and
# slabs are revised periodically and differ per state.
LWF_RULES: dict[str, dict] = {
    # Maharashtra Labour Welfare Fund Act 1953: deducted in the June and
    # December payroll, remitted by 15 July / 15 January.
    #
    # Flat Rs 25 per employee with no wage slab, matching the client's wage
    # register: every worker on it is charged 25 regardless of gross (Rs 4,448
    # and Rs 14,824 both pay 25). The employer share is not tracked because the
    # register does not carry one; it does not affect net pay either way.
    "Maharashtra": {
        "months": (6, 12),
        "slabs": [],
        "default": (Decimal("25"), Decimal("0")),
    },
}
