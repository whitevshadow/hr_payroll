"""Unit tests for simplified New-regime TDS slab math."""

from decimal import Decimal
from datetime import date

from app.logic import REGISTRY, compute_annual_tds, compute_overview, compute_tds


def D(x):
    return Decimal(str(x))


def test_tds_zero_up_to_12L_taxable_via_rebate():
    # 2025 Act new regime: s.87A rebate makes tax nil up to Rs.12,00,000 taxable.
    # monthly_gross 100000 -> annual 1,200,000; taxable = 1,200,000 - 75,000 =
    # 1,125,000 (<= 12L). Slab tax 52,500 is fully cancelled by the rebate.
    r = compute_tds(D("100000"))
    assert r["taxable_income"] == D("1125000.00")
    assert r["annual_tax_before_cess"] == D("0.00")
    assert r["annual_tax"] == D("0.00")
    assert r["monthly_tds"] == D("0.00")
    assert r["regime_applied"] == "NEW"


def test_tds_above_rebate_threshold_is_taxed():
    # monthly_gross 200000 -> annual 2,400,000; taxable = 2,325,000 (> 12L, no
    # rebate).
    #   400000@0%  = 0
    #   400000@5%  = 20000   (400k..800k)
    #   400000@10% = 40000   (800k..1200k)
    #   400000@15% = 60000   (1200k..1600k)
    #   400000@20% = 80000   (1600k..2000k)
    #   325000@25% = 81250   (2000k..2325k)
    #   = 281250 before cess; *1.04 = 292500 annual; /12 = 24375 monthly
    r = compute_tds(D("200000"))
    assert r["taxable_income"] == D("2325000.00")
    assert r["annual_tax_before_cess"] == D("281250.00")
    assert r["annual_tax"] == D("292500.00")
    assert r["monthly_tds"] == D("24375.00")
    assert r["regime_applied"] == "NEW"


def test_surcharge_applied_above_50L():
    # monthly_gross 600000 -> annual 7,200,000; taxable 7,125,000 (50L-1cr band
    # -> 10% surcharge).
    #   slab tax                              = 1,717,500
    #   surcharge = 10% * 1,717,500           =   171,750
    #   cess      = 4% * (1,717,500+171,750)  =    75,570
    #   annual_tax                            = 1,964,820
    r = compute_tds(D("600000"))
    assert r["taxable_income"] == D("7125000.00")
    assert r["tax_trace"]["surcharge"]["amount"] == "171750.00"
    assert r["tax_trace"]["surcharge"]["rate"] == "0.10"
    assert r["annual_tax"] == D("1964820.00")


def test_no_surcharge_at_or_below_50L():
    # taxable exactly 50L -> no surcharge (applies only ABOVE the threshold).
    r = compute_annual_tds(
        salary_payment_date=date(2026, 4, 30),
        monthly_gross=D("0"),
        fixed_pay=D("5075000"),  # taxable = 5,075,000 - 75,000 = 5,000,000
        tax_regime="NEW",
    )
    assert r["taxable_income"] == D("5000000.00")
    assert r["tax_trace"]["surcharge"]["amount"] == "0.00"


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
    # monthly_gross 200000 -> annual_tax 292500 (above the rebate threshold, so
    # non-zero). Remaining tax after already-deducted TDS is spread over the
    # remaining payroll months.
    r = compute_annual_tds(
        salary_payment_date=date(2026, 4, 30),
        monthly_gross=D("200000"),
        previous_employer_tds=D("6000"),
        current_employer_tds=D("3000"),
        remaining_payroll_months=3,
    )

    assert r["annual_tax"] == D("292500.00")
    assert r["remaining_tax"] == D("283500.00")
    assert r["monthly_tds"] == D("94500.00")
    assert r["tax_trace"]["monthly_allocation"]["remaining_payroll_months"] == 3


def test_overview_only_deducts_approved_proofs():
    # Old regime, 80C declared at the 150000 cap.
    common = dict(
        ctc=D("1200000"),
        basic_monthly=D("40000"),
        hra_monthly=D("0"),
        declarations={"80C": D("150000")},
        salary_payment_date=date(2026, 4, 30),
    )
    # Unapproved: the declared 80C must NOT reduce taxable income.
    unapproved = compute_overview(**common)
    assert unapproved["old_regime"]["taxable_income"] == "1150000.00"

    # Approved: the same 80C now reduces taxable income by 150000.
    approved = compute_overview(**common, approved_proofs={"80C": True})
    assert approved["old_regime"]["taxable_income"] == "1000000.00"


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
