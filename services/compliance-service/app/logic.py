"""PF / ESI / PT / LWF calculators (section 5.3). Pure functions, Decimal only."""

from __future__ import annotations

from decimal import Decimal

from hr_shared import money

from .settings import LWF_RULES, PT_DEFAULT, PT_SLABS


def compute_pf(
    basic: Decimal,
    # Statutory defaults. VERIFY against current government notification.
    employee_rate: Decimal = Decimal("12"),
    employer_rate: Decimal = Decimal("12"),
    ceiling: Decimal = Decimal("15000"),
    ceiling_on: bool = True,
    eps_eligible: bool = True,
) -> dict:
    """eps_eligible=False sends the employer's whole share to EPF.

    A member who first joined the scheme on or after 1 September 2014 earning
    above the ceiling never becomes an EPS member, and the exclusion is
    permanent — it does not lapse if their wages later fall below it. For those
    members the 8.33% pension column is zero and EPF takes the full employer
    rate, which is why this is a stored fact about the person rather than
    something derivable from this month's wage.
    """
    basic = Decimal(basic)
    pf_wages = min(basic, ceiling) if ceiling_on else basic
    employee_pf = money(pf_wages * (employee_rate / Decimal("100")))
    # EPS (pension) is 8.33% (or employer_rate if lower) and is always capped at
    # the statutory ceiling, even when the employer opts out of the PF ceiling.
    eps_rate = min(Decimal("8.33"), employer_rate)
    employer_eps = (
        money(min(pf_wages, ceiling) * (eps_rate / Decimal("100")))
        if eps_eligible
        else money(0)
    )

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
    covered_override: bool | None = None,
) -> dict:
    """covered_override, when not None, replaces the threshold check — the
    caller has already resolved eligibility (ESI contribution-period lock:
    coverage persists to period end even if wages cross the ceiling)."""
    gross = Decimal(monthly_gross)
    eligible = covered_override if covered_override is not None else gross <= threshold
    employee_esi = money(gross * (employee_rate / Decimal("100"))) if eligible else money(0)
    employer_esi = money(gross * (employer_rate / Decimal("100"))) if eligible else money(0)
    return {
        "gross_wages": money(gross),
        "is_esi_eligible": eligible,
        "employee_esi": employee_esi,
        "employer_esi": employer_esi,
    }


def compute_pt(
    state: str,
    month: int,
    monthly_gross: Decimal | None = None,
    gender: str | None = None,
) -> dict:
    """PT by state slab. Without monthly_gross (legacy callers) the top-slab
    amount applies; with it, the income slabs and any women's exemption do."""
    slab = PT_SLABS.get(state, PT_DEFAULT)
    amount = slab["february"] if month == 2 else slab["regular"]
    if monthly_gross is not None:
        gross = Decimal(monthly_gross)
        exempt_upto = slab.get("women_exempt_upto")
        is_female = (gender or "").strip().lower() in ("f", "female")
        if exempt_upto is not None and is_female and gross <= exempt_upto:
            amount = Decimal("0")
        else:
            for limit, slab_amount in slab.get("slabs", []):
                if gross <= limit:
                    amount = slab_amount
                    break
    return {"state": state, "pt_amount": money(amount)}


def compute_lwf(
    state: str,
    month: int | None = None,
    monthly_gross: Decimal | None = None,
) -> dict:
    """Labour Welfare Fund for the given wage month.

    LWF is a half-yearly contribution, not a monthly one: the full amount is
    deducted only in the contribution months for the state (June and December
    in Maharashtra) and is nil in every other month. The share is picked from
    the state's wage slabs; the employer's share is a separate figure (3x the
    employee's in Maharashtra), not a rate.

    Callers that pass no month (legacy) get the above-slab amount so behaviour
    stays deterministic rather than silently nil.
    """
    rules = LWF_RULES.get(state)
    if rules is None:
        return {"state": state, "employee_lwf": money(0), "employer_lwf": money(0)}

    if month is not None and month not in rules["months"]:
        # Not a contribution month for this state.
        return {"state": state, "employee_lwf": money(0), "employer_lwf": money(0)}

    employee, employer = rules["default"]
    if monthly_gross is not None:
        gross = Decimal(monthly_gross)
        for limit, emp_share, empr_share in rules.get("slabs", []):
            if gross <= limit:
                employee, employer = emp_share, empr_share
                break

    return {
        "state": state,
        "employee_lwf": money(employee),
        "employer_lwf": money(employer),
    }
