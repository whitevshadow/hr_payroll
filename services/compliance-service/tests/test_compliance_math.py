"""Unit tests for PF / ESI / PT money math (Decimal, ROUND_HALF_UP)."""

from decimal import Decimal

from app.logic import compute_esi, compute_lwf, compute_pf, compute_pt


def D(x):
    return Decimal(str(x))


def test_pf_applies_ceiling():
    # basic above the 15000 ceiling -> PF computed on 15000.
    pf = compute_pf(D("40000"), ceiling_on=True)
    assert pf["pf_wages"] == D("15000.00")
    assert pf["employee_pf"] == D("1800.00")          # 15000 * 12%
    assert pf["employer_eps"] == D("1249.50")          # 15000 * 8.33%
    assert pf["employer_epf"] == D("550.50")           # 1800 - 1249.50
    assert pf["is_ceiling_applied"] is True


def test_pf_below_ceiling_without_toggle():
    pf = compute_pf(D("10000"), ceiling_on=False)
    assert pf["pf_wages"] == D("10000.00")
    assert pf["employee_pf"] == D("1200.00")


def test_pf_ceiling_off_above_ceiling_epf_eps_sum_to_total():
    # basic 30000, ceiling disabled: EPF is on the full wage, EPS stays capped.
    #   employer total = 12% * 30000        = 3600.00
    #   employer EPS   = 8.33% * 15000      = 1249.50 (capped at ceiling)
    #   employer EPF   = 3600 - 1249.50     = 2350.50   (was wrongly 1101.00)
    pf = compute_pf(D("30000"), ceiling_on=False)
    assert pf["pf_wages"] == D("30000.00")
    assert pf["employer_eps"] == D("1249.50")
    assert pf["employer_epf"] == D("2350.50")
    # EPS + EPF must equal the full 12% employer contribution.
    assert pf["employer_eps"] + pf["employer_epf"] == D("3600.00")


def test_esi_eligible_when_within_threshold():
    esi = compute_esi(D("20000"))
    assert esi["is_esi_eligible"] is True
    assert esi["employee_esi"] == D("150.00")          # 20000 * 0.75%
    assert esi["employer_esi"] == D("650.00")          # 20000 * 3.25%


def test_esi_not_eligible_above_threshold():
    esi = compute_esi(D("25000"))
    assert esi["is_esi_eligible"] is False
    assert esi["employee_esi"] == D("0.00")
    assert esi["employer_esi"] == D("0.00")


def test_pt_maharashtra_february_is_300():
    assert compute_pt("Maharashtra", 2)["pt_amount"] == D("300.00")


def test_pt_maharashtra_regular_is_200():
    assert compute_pt("Maharashtra", 5)["pt_amount"] == D("200.00")


def test_pt_maharashtra_income_slabs():
    # <= 7500 -> nil; 7501-10000 -> 175; above -> 200 (300 in Feb).
    assert compute_pt("Maharashtra", 5, D("4448"))["pt_amount"] == D("0.00")
    assert compute_pt("Maharashtra", 5, D("9000"))["pt_amount"] == D("175.00")
    assert compute_pt("Maharashtra", 5, D("12354"))["pt_amount"] == D("200.00")
    assert compute_pt("Maharashtra", 2, D("12354"))["pt_amount"] == D("300.00")


def test_pt_maharashtra_women_exempt_upto_25000():
    assert compute_pt("Maharashtra", 5, D("13343"), gender="Female")["pt_amount"] == D("0.00")
    assert compute_pt("Maharashtra", 5, D("26000"), gender="Female")["pt_amount"] == D("200.00")
    assert compute_pt("Maharashtra", 5, D("13343"), gender="Male")["pt_amount"] == D("200.00")


def test_pt_without_gross_keeps_legacy_flat_amount():
    # Callers that don't send monthly_gross still get the top-slab amount.
    assert compute_pt("Maharashtra", 5, None)["pt_amount"] == D("200.00")
    assert compute_pt("UnknownState", 5, D("5000"))["pt_amount"] == D("200.00")


def test_esi_covered_override_true_keeps_contributions_above_ceiling():
    # Contribution-period lock: covered earlier in the period, wages have
    # since crossed the ceiling — contributions must continue.
    esi = compute_esi(D("25000"), covered_override=True)
    assert esi["is_esi_eligible"] is True
    assert esi["employee_esi"] == D("187.50")          # 25000 * 0.75%
    assert esi["employer_esi"] == D("812.50")          # 25000 * 3.25%


def test_esi_covered_override_false_blocks_contributions_below_ceiling():
    esi = compute_esi(D("15000"), covered_override=False)
    assert esi["is_esi_eligible"] is False
    assert esi["employee_esi"] == D("0.00")


def test_esi_covered_override_none_falls_back_to_threshold():
    assert compute_esi(D("15000"), covered_override=None)["is_esi_eligible"] is True
    assert compute_esi(D("25000"), covered_override=None)["is_esi_eligible"] is False


def test_esi_period_start_month_boundaries():
    from app.routes import _esi_period_start_month
    assert _esi_period_start_month(2026, 4) == "2026-04"    # period opens
    assert _esi_period_start_month(2026, 9) == "2026-04"    # period closes
    assert _esi_period_start_month(2026, 10) == "2026-10"
    assert _esi_period_start_month(2026, 12) == "2026-10"
    assert _esi_period_start_month(2027, 1) == "2026-10"    # spans new year
    assert _esi_period_start_month(2027, 3) == "2026-10"


# ── MLWF (Maharashtra Labour Welfare Fund) ────────────────────────────────────

def test_mlwf_only_charged_in_june_and_december():
    # Half-yearly: nil in the other ten months.
    for month in (1, 2, 3, 4, 5, 7, 8, 9, 10, 11):
        r = compute_lwf("Maharashtra", month, D("15000"))
        assert r["employee_lwf"] == D("0.00"), f"month {month} should be nil"
    for month in (6, 12):
        r = compute_lwf("Maharashtra", month, D("15000"))
        assert r["employee_lwf"] == D("25.00"), f"month {month} should charge"


def test_mlwf_is_flat_regardless_of_wage():
    """The client's wage register charges every worker Rs 25 — the lowest paid
    (Rs 4,448 gross) and the highest (Rs 14,824) alike, with no slab."""
    for gross in ("4448", "7906", "12354", "14824", "50000"):
        r = compute_lwf("Maharashtra", 6, D(gross))
        assert r["employee_lwf"] == D("25.00"), f"gross {gross}"
        assert r["employer_lwf"] == D("0.00")


def test_mlwf_register_total_reconciles():
    # Register total row: MLWF 175 across the 7 employees.
    total = sum(compute_lwf("Maharashtra", 6, D(g))["employee_lwf"]
                for g in ("7906", "12847", "13835", "13343", "12354", "14824", "4448"))
    assert total == D("175.00")


def test_mlwf_unknown_state_is_nil():
    r = compute_lwf("Karnataka", 6, D("15000"))
    assert r["employee_lwf"] == D("0.00")
    assert r["employer_lwf"] == D("0.00")


def test_mlwf_without_month_keeps_deterministic_amount():
    # Legacy callers that pass no month still get a real figure, not silence.
    r = compute_lwf("Maharashtra")
    assert r["employee_lwf"] == D("25.00")
