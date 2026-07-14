"""PF / ESI / PT / LWF calculators (section 5.3). Pure functions, Decimal only."""

from __future__ import annotations

from decimal import Decimal

from hr_shared import money

from .settings import PT_DEFAULT, PT_SLABS


def compute_pf(
    basic: Decimal,
    # Statutory defaults. VERIFY against current government notification.
    employee_rate: Decimal = Decimal("12"),
    employer_rate: Decimal = Decimal("12"),
    ceiling: Decimal = Decimal("15000"),
    ceiling_on: bool = True,
) -> dict:
    basic = Decimal(basic)
    pf_wages = min(basic, ceiling) if ceiling_on else basic
    employee_pf = money(pf_wages * (employee_rate / Decimal("100")))
    # EPS (pension) is 8.33% (or employer_rate if lower) and is always capped at
    # the statutory ceiling, even when the employer opts out of the PF ceiling.
    eps_rate = min(Decimal("8.33"), employer_rate)
    employer_eps = money(min(pf_wages, ceiling) * (eps_rate / Decimal("100")))

    # Total employer contribution is employer_rate% of pf_wages; EPF is whatever
    # remains after EPS. Deriving EPF as (employer_rate - eps_rate)% of pf_wages
    # is only correct when EPS shares the same base — it understates EPF once
    # pf_wages exceeds the ceiling with the ceiling disabled (EPS stays capped
    # while the residual rate wrongly applies to the full wage).
    employer_total = money(pf_wages * (employer_rate / Decimal("100")))
    employer_epf = money(employer_total - employer_eps)

    return {
        "pf_wages": money(pf_wages),
        "employee_pf": employee_pf,
        "employer_eps": employer_eps,
        "employer_epf": employer_epf,
        "is_ceiling_applied": ceiling_on,
    }


def compute_esi(
    monthly_gross: Decimal,
    # Statutory defaults. VERIFY against current government notification.
    employee_rate: Decimal = Decimal("0.75"),
    employer_rate: Decimal = Decimal("3.25"),
    threshold: Decimal = Decimal("21000"),
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
