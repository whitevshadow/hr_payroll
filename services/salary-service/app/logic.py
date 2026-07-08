"""Salary breakdown (section 5.1). All money via Decimal + ROUND_HALF_UP."""

from __future__ import annotations

from decimal import Decimal

from hr_shared import money

from .settings import METRO_CITIES


def is_metro(work_location: str | None) -> bool:
    return (work_location or "") in METRO_CITIES


def compute_breakdown(ctc: Decimal, work_location: str | None) -> dict:
    """Return monthly breakdown for an annual CTC.

    special_allowance absorbs the rounding remainder so the three earning
    components always sum exactly to monthly_gross.
    """
    ctc = Decimal(ctc)
    monthly_gross = money(ctc / Decimal(12))
    basic = money(monthly_gross * Decimal("0.40"))
    metro = is_metro(work_location)
    hra_rate = Decimal("0.50") if metro else Decimal("0.40")
    hra = money(basic * hra_rate)
    conveyance = money(Decimal("1600.00"))
    medical = money(Decimal("1250.00"))
    
    special_allowance = money(monthly_gross - basic - hra - conveyance - medical)
    if special_allowance < Decimal("0"):
        special_allowance = Decimal("0")
        
    return {
        "monthly_gross": monthly_gross,
        "basic": basic,
        "hra": hra,
        "conveyance": conveyance,
        "medical": medical,
        "special_allowance": special_allowance,
        "is_metro": metro,
    }
