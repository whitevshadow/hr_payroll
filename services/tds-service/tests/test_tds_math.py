"""Unit tests for simplified New-regime TDS slab math."""

from decimal import Decimal
from datetime import date

from app.logic import REGISTRY, compute_annual_tds, compute_tds


def D(x):
    return Decimal(str(x))


def test_tds_for_12L_annual():
    # monthly_gross 100000 -> annual 1,200,000.
    # taxable = 1,200,000 - 75,000 = 1,125,000
    #   400000@0% = 0
    #   400000@5% = 20000   (400k..800k)
    #   325000@10% = 32500  (800k..1,125k)
    #   = 52500 before cess; *1.04 = 54600 annual; /12 = 4550 monthly
    r = compute_tds(D("100000"))
    assert r["taxable_income"] == D("1125000.00")
    assert r["annual_tax_before_cess"] == D("52500.00")
    assert r["annual_tax"] == D("54600.00")
    assert r["monthly_tds"] == D("4550.00")
    assert r["regime_applied"] == "NEW"


def test_tds_zero_below_threshold():
    # monthly 20000 -> annual 240000, taxable 165000, all in 0% slab.
    r = compute_tds(D("20000"))
    assert r["taxable_income"] == D("165000.00")
    assert r["annual_tax"] == D("0.00")
    assert r["monthly_tds"] == D("0.00")


def test_trace_has_all_slabs():
    r = compute_tds(D("100000"))
    assert len(r["tax_trace"]["slabs"]) == 7


def test_law_selection_uses_payment_date_not_payroll_month():
    old_law = REGISTRY.law_for_payment_date(date(2026, 3, 31))
    new_law = REGISTRY.law_for_payment_date(date(2026, 4, 1))

    assert old_law.version == "1961_v2025"
    assert new_law.version == "2025_v2026"


def test_annual_projection_allocates_remaining_tax_monthly():
    r = compute_annual_tds(
        salary_payment_date=date(2026, 4, 30),
        monthly_gross=D("100000"),
        previous_employer_tds=D("6000"),
        current_employer_tds=D("3000"),
        remaining_payroll_months=3,
    )

    assert r["annual_tax"] == D("54600.00")
    assert r["remaining_tax"] == D("45600.00")
    assert r["monthly_tds"] == D("15200.00")
    assert r["tax_trace"]["monthly_allocation"]["remaining_payroll_months"] == 3


def test_trace_hash_is_deterministic_for_same_inputs():
    a = compute_annual_tds(
        salary_payment_date=date(2026, 4, 30),
        monthly_gross=D("100000"),
        remaining_payroll_months=6,
    )
    b = compute_annual_tds(
        salary_payment_date=date(2026, 4, 30),
        monthly_gross=D("100000"),
        remaining_payroll_months=6,
    )

    assert a["trace_hash"] == b["trace_hash"]
    assert a["tax_trace"]["hash"] == b["tax_trace"]["hash"]
