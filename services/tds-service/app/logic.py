"""Simplified New-regime TDS (section 5.4). Pure functions, Decimal only.

# TODO(v2): Old regime, 80C/80D, HRA exemption, rebate u/s 87A, regime
# comparison. V1 is New regime, simplified, only.
"""

from __future__ import annotations

from decimal import Decimal

from hr_shared import money

from .settings import CESS_RATE, NEW_REGIME_SLABS, STD_DEDUCTION


def compute_tds(monthly_gross: Decimal) -> dict:
    monthly_gross = Decimal(monthly_gross)
    annual_gross = money(monthly_gross * Decimal(12))
    taxable_income = max(Decimal("0"), annual_gross - STD_DEDUCTION)

    trace: list[dict] = []
    tax_before_cess = Decimal("0")
    for lower, upper, rate in NEW_REGIME_SLABS:
        if taxable_income <= lower:
            slab_taxable = Decimal("0")
        else:
            top = taxable_income if upper is None else min(taxable_income, upper)
            slab_taxable = top - lower
        slab_tax = money(slab_taxable * rate)
        tax_before_cess += slab_tax
        trace.append(
            {
                "slab_from": str(lower),
                "slab_to": ("inf" if upper is None else str(upper)),
                "rate": str(rate),
                "taxable_in_slab": str(money(slab_taxable)),
                "tax": str(slab_tax),
            }
        )

    annual_tax = money(tax_before_cess * (Decimal("1") + CESS_RATE))
    monthly_tds = money(annual_tax / Decimal(12))
    return {
        "annual_gross": annual_gross,
        "taxable_income": money(taxable_income),
        "annual_tax_before_cess": money(tax_before_cess),
        "annual_tax": annual_tax,
        "monthly_tds": monthly_tds,
        "regime_applied": "NEW",
        "tax_trace": {
            "std_deduction": str(STD_DEDUCTION),
            "cess_rate": str(CESS_RATE),
            "slabs": trace,
        },
    }
