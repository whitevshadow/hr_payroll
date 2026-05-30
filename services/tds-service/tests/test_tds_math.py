"""Unit tests for simplified New-regime TDS slab math."""

from decimal import Decimal

from app.logic import compute_tds


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
