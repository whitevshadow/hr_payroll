"""PF / ESI / PT calculators (section 5.3). Pure functions, Decimal only."""

from __future__ import annotations

from decimal import Decimal

from hr_shared import money

from .settings import (
    ESI_EMPLOYEE_RATE,
    ESI_EMPLOYER_RATE,
    ESI_THRESHOLD,
    PF_CEILING,
    PF_EMPLOYEE_RATE,
    PF_EPS_RATE,
    PT_DEFAULT,
    PT_SLABS,
)


def compute_pf(basic: Decimal, ceiling_on: bool = True) -> dict:
    basic = Decimal(basic)
    pf_wages = min(basic, PF_CEILING) if ceiling_on else basic
    employee_pf = money(pf_wages * PF_EMPLOYEE_RATE)
    employer_eps = money(min(pf_wages, PF_CEILING) * PF_EPS_RATE)
    employer_epf = money(pf_wages * PF_EMPLOYEE_RATE - employer_eps)
    return {
        "pf_wages": money(pf_wages),
        "employee_pf": employee_pf,
        "employer_eps": employer_eps,
        "employer_epf": employer_epf,
        "is_ceiling_applied": ceiling_on,
    }


def compute_esi(monthly_gross: Decimal) -> dict:
    gross = Decimal(monthly_gross)
    eligible = gross <= ESI_THRESHOLD
    employee_esi = money(gross * ESI_EMPLOYEE_RATE) if eligible else money(0)
    employer_esi = money(gross * ESI_EMPLOYER_RATE) if eligible else money(0)
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
