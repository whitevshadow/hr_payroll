"""PF / ESI / PT / LWF calculators (section 5.3). Pure functions, Decimal only."""

from __future__ import annotations

from decimal import Decimal

from hr_shared import money

from .settings import PT_DEFAULT, PT_SLABS


def compute_pf(
    basic: Decimal,
    employee_rate: Decimal,
    employer_rate: Decimal,
    ceiling: Decimal,
    ceiling_on: bool = True,
) -> dict:
    basic = Decimal(basic)
    pf_wages = min(basic, ceiling) if ceiling_on else basic
    employee_pf = money(pf_wages * (employee_rate / Decimal("100")))
    # EPS is fixed at 8.33% by default, or employer_rate if it's less
    eps_rate = min(Decimal("8.33"), employer_rate)
    employer_eps = money(min(pf_wages, ceiling) * (eps_rate / Decimal("100")))
    
    # EPF is the remaining portion of employer contribution
    employer_epf_rate = employer_rate - eps_rate
    employer_epf = money(pf_wages * (employer_epf_rate / Decimal("100")))
    
    return {
        "pf_wages": money(pf_wages),
        "employee_pf": employee_pf,
        "employer_eps": employer_eps,
        "employer_epf": employer_epf,
        "is_ceiling_applied": ceiling_on,
    }


def compute_esi(
    monthly_gross: Decimal,
    employee_rate: Decimal,
    employer_rate: Decimal,
    threshold: Decimal,
) -> dict:
    gross = Decimal(monthly_gross)
    eligible = gross <= threshold
    employee_esi = money(gross * (employee_rate / Decimal("100"))) if eligible else money(0)
    employer_esi = money(gross * (employer_rate / Decimal("100"))) if eligible else money(0)
    return {
        "gross_wages": money(gross),
        "is_esi_eligible": eligible,
        "employee_esi": employee_esi,
        "employer_esi": employer_esi,
    }


def compute_pt(state: str, month: int) -> dict:
    slab = PT_SLABS.get(state, PT_DEFAULT)
    amount = slab["february"] if month == 2 else slab["regular"]
    return {"state": state, "pt_amount": money(amount)}


def compute_lwf(state: str) -> dict:
    # LWF is typically a fixed amount per state per month or six months.
    # Stubbing with a fixed amount for demonstration.
    employee_lwf = money(Decimal("10"))
    employer_lwf = money(Decimal("20"))
    return {
        "state": state,
        "employee_lwf": employee_lwf,
        "employer_lwf": employer_lwf,
    }
