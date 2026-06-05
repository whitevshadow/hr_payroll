from __future__ import annotations

from decimal import Decimal

from hr_shared import BaseServiceSettings


class Settings(BaseServiceSettings):
    service_name: str = "tds-service"
    db_schema: str = "tds_schema"

    salary_url: str = "http://salary-service:8004"
    employee_url: str = "http://employee-service:8003"


settings = Settings()

# ---- Statutory constants (V1, New regime only) ------------------------
# VERIFY against current CBDT notification before any real use.

STD_DEDUCTION = Decimal("75000")
CESS_RATE = Decimal("0.04")  # 4% health & education cess

# (lower_bound, upper_bound|None, rate). EXAMPLE defaults — VERIFY.
NEW_REGIME_SLABS: list[tuple[Decimal, Decimal | None, Decimal]] = [
    (Decimal("0"), Decimal("400000"), Decimal("0.00")),
    (Decimal("400000"), Decimal("800000"), Decimal("0.05")),
    (Decimal("800000"), Decimal("1200000"), Decimal("0.10")),
    (Decimal("1200000"), Decimal("1600000"), Decimal("0.15")),
    (Decimal("1600000"), Decimal("2000000"), Decimal("0.20")),
    (Decimal("2000000"), Decimal("2400000"), Decimal("0.25")),
    (Decimal("2400000"), None, Decimal("0.30")),
]
