"""Unit tests for PF / ESI / PT money math (Decimal, ROUND_HALF_UP)."""

from decimal import Decimal

from app.logic import compute_esi, compute_pf, compute_pt


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
