"""Registry-driven deterministic TDS engine.

TDS is projected annually; monthly deduction is only the remaining liability
allocated over remaining payroll periods. All calculations use Decimal and
return an auditable trace that can be replayed years later.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from decimal import ROUND_HALF_UP


def money(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


Regime = Literal["DEFAULT", "OLD", "NEW"]


TRANSITION_DATE = date(2026, 3, 31)


@dataclass(frozen=True)
class Slab:
    lower: Decimal
    upper: Decimal | None
    rate: Decimal


@dataclass(frozen=True)
class RebateRule:
    threshold: Decimal
    amount: Decimal


@dataclass(frozen=True)
class TaxRegimeSpec:
    name: str
    slabs: tuple[Slab, ...]
    standard_deduction: Decimal
    cess_rate: Decimal
    rebate: RebateRule | None = None
    chapter_via_allowed: bool = False
    professional_tax_allowed: bool = False
    hra_allowed: bool = False


@dataclass(frozen=True)
class TaxLaw:
    law_id: str
    law_name: str
    version: str
    effective_from: date
    effective_to: date | None
    regimes: dict[str, TaxRegimeSpec]
    forms: tuple[str, ...]
    section_mappings: dict[str, str]


def D(value: str) -> Decimal:
    return Decimal(value)


class TaxLawRegistry:
    """Versioned law registry.

    Slabs/deductions live here, not inside the slab engine. Future statutory
    changes should add a new TaxLaw version and leave old versions immutable.
    """

    def __init__(self) -> None:
        self._laws = {
            "1961_v2025": TaxLaw(
                law_id="ITA_1961",
                law_name="Income-tax Act 1961",
                version="1961_v2025",
                effective_from=date(2025, 4, 1),
                effective_to=TRANSITION_DATE,
                forms=("FORM_16",),
                section_mappings={
                    "STANDARD_DEDUCTION": "16(ia)",
                    "HRA": "10(13A)",
                    "80C": "80C",
                    "80CCD_1B": "80CCD(1B)",
                    "80D": "80D",
                    "REBATE": "87A",
                    "RELIEF": "89",
                },
                regimes={
                    "NEW": TaxRegimeSpec(
                        name="NEW",
                        standard_deduction=D("75000"),
                        cess_rate=D("0.04"),
                        rebate=RebateRule(threshold=D("700000"), amount=D("25000")),
                        slabs=(
                            Slab(D("0"), D("300000"), D("0.00")),
                            Slab(D("300000"), D("700000"), D("0.05")),
                            Slab(D("700000"), D("1000000"), D("0.10")),
                            Slab(D("1000000"), D("1200000"), D("0.15")),
                            Slab(D("1200000"), D("1500000"), D("0.20")),
                            Slab(D("1500000"), None, D("0.30")),
                        ),
                    ),
                    "OLD": TaxRegimeSpec(
                        name="OLD",
                        standard_deduction=D("50000"),
                        cess_rate=D("0.04"),
                        rebate=RebateRule(threshold=D("500000"), amount=D("12500")),
                        chapter_via_allowed=True,
                        professional_tax_allowed=True,
                        hra_allowed=True,
                        slabs=(
                            Slab(D("0"), D("250000"), D("0.00")),
                            Slab(D("250000"), D("500000"), D("0.05")),
                            Slab(D("500000"), D("1000000"), D("0.20")),
                            Slab(D("1000000"), None, D("0.30")),
                        ),
                    ),
                },
            ),
            "2025_v2026": TaxLaw(
                law_id="ITA_2025",
                law_name="Income-tax Act 2025",
                version="2025_v2026",
                effective_from=date(2026, 4, 1),
                effective_to=None,
                forms=("FORM_16", "FORM_122"),
                section_mappings={
                    "STANDARD_DEDUCTION": "2025:salary_standard_deduction",
                    "HRA": "2025:housing_rent_relief",
                    "80C": "1961:80C_TRANSITIONAL",
                    "REBATE": "2025:rebate",
                    "RELIEF": "2025:arrears_relief",
                },
                regimes={
                    "NEW": TaxRegimeSpec(
                        name="NEW",
                        standard_deduction=D("75000"),
                        cess_rate=D("0.04"),
                        # s.87A rebate: no tax up to Rs.12,00,000 taxable income
                        # under the new regime. Tax on Rs.12L = 5%*4L + 10%*4L =
                        # 60,000, which the rebate cancels exactly.
                        # VERIFY against current government notification.
                        rebate=RebateRule(threshold=D("1200000"), amount=D("60000")),
                        slabs=(
                            Slab(D("0"), D("400000"), D("0.00")),
                            Slab(D("400000"), D("800000"), D("0.05")),
                            Slab(D("800000"), D("1200000"), D("0.10")),
                            Slab(D("1200000"), D("1600000"), D("0.15")),
                            Slab(D("1600000"), D("2000000"), D("0.20")),
                            Slab(D("2000000"), D("2400000"), D("0.25")),
                            Slab(D("2400000"), None, D("0.30")),
                        ),
                    ),
                    "OLD": TaxRegimeSpec(
                        name="OLD",
                        standard_deduction=D("50000"),
                        cess_rate=D("0.04"),
                        rebate=RebateRule(threshold=D("500000"), amount=D("12500")),
                        chapter_via_allowed=True,
                        professional_tax_allowed=True,
                        hra_allowed=True,
                        slabs=(
                            Slab(D("0"), D("250000"), D("0.00")),
                            Slab(D("250000"), D("500000"), D("0.05")),
                            Slab(D("500000"), D("1000000"), D("0.20")),
                            Slab(D("1000000"), None, D("0.30")),
                        ),
                    ),
                },
            ),
        }

    def law_for_payment_date(self, salary_payment_date: date) -> TaxLaw:
        return self._laws["1961_v2025"] if salary_payment_date <= TRANSITION_DATE else self._laws["2025_v2026"]

    def get(self, version: str) -> TaxLaw:
        return self._laws[version]

    def versions(self) -> list[str]:
        return sorted(self._laws)


REGISTRY = TaxLawRegistry()


def canonical_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def resolve_regime(regime: Regime, law: TaxLaw) -> str:
    if regime == "DEFAULT":
        return "NEW"
    if regime not in law.regimes:
        raise ValueError(f"Unsupported tax regime {regime} for {law.version}")
    return regime


def slab_tax(taxable_income: Decimal, regime_spec: TaxRegimeSpec) -> tuple[Decimal, list[dict[str, str]]]:
    trace: list[dict[str, str]] = []
    tax_before_cess = Decimal("0")
    for slab in regime_spec.slabs:
        if taxable_income <= slab.lower:
            slab_taxable = Decimal("0")
        else:
            top = taxable_income if slab.upper is None else min(taxable_income, slab.upper)
            slab_taxable = max(Decimal("0"), top - slab.lower)
        generated = money(slab_taxable * slab.rate)
        tax_before_cess += generated
        trace.append(
            {
                "slab_from": str(money(slab.lower)),
                "slab_to": "inf" if slab.upper is None else str(money(slab.upper)),
                "rate": str(slab.rate),
                "income_portion": str(money(slab_taxable)),
                "tax_generated": str(generated),
            }
        )
    return money(tax_before_cess), trace


def cap(value: Decimal, limit: Decimal) -> Decimal:
    return money(min(max(value, Decimal("0")), limit))


# Surcharge on the income tax, keyed by taxable income. Applies above Rs.50L.
# The new regime caps the top rate at 25% (the 37% band was withdrawn for it).
# Marginal relief is not modelled. VERIFY against current government notification.
_SURCHARGE_BANDS: tuple[tuple[Decimal, Decimal], ...] = (
    (D("5000000"), D("0.00")),
    (D("10000000"), D("0.10")),
    (D("20000000"), D("0.15")),
    (D("50000000"), D("0.25")),
)


def surcharge_rate(taxable_income: Decimal, regime_name: str) -> Decimal:
    for upper, rate in _SURCHARGE_BANDS:
        if taxable_income <= upper:
            return rate
    # Above Rs.5 crore.
    return D("0.25") if regime_name == "NEW" else D("0.37")


def compute_annual_tds(
    *,
    salary_payment_date: date,
    monthly_gross: Decimal,
    fixed_pay: Decimal | None = None,
    variable_pay: Decimal = Decimal("0"),
    bonus: Decimal = Decimal("0"),
    incentives: Decimal = Decimal("0"),
    arrears: Decimal = Decimal("0"),
    perquisites: Decimal = Decimal("0"),
    employer_contributions: Decimal = Decimal("0"),
    other_taxable_income: Decimal = Decimal("0"),
    previous_employer_income: Decimal = Decimal("0"),
    previous_employer_tds: Decimal = Decimal("0"),
    current_employer_tds: Decimal = Decimal("0"),
    remaining_payroll_months: int = 12,
    tax_regime: Regime = "DEFAULT",
    declaration_version_id: str | None = None,
    declarations: dict[str, Decimal] | None = None,
    approved_proofs: dict[str, bool] | None = None,
    relief_89: Decimal = Decimal("0"),
) -> dict[str, Any]:
    law = REGISTRY.law_for_payment_date(salary_payment_date)
    regime_name = resolve_regime(tax_regime, law)
    regime = law.regimes[regime_name]
    declarations = declarations or {}
    approved_proofs = approved_proofs or {}
    remaining = max(int(remaining_payroll_months), 1)

    annual_fixed = money((fixed_pay if fixed_pay is not None else monthly_gross * Decimal(12)))
    projected_income_parts = {
        "fixed_pay": annual_fixed,
        "variable_pay": money(variable_pay),
        "bonus": money(bonus),
        "incentives": money(incentives),
        "arrears": money(arrears),
        "perquisites": money(perquisites),
        "taxable_employer_contributions": money(employer_contributions),
        "other_taxable_income": money(other_taxable_income),
        "previous_employer_income": money(previous_employer_income),
    }
    projected_annual_income = money(sum(projected_income_parts.values(), Decimal("0")))

    exemptions: dict[str, Decimal] = {}
    if regime.hra_allowed and approved_proofs.get("HRA", False):
        exemptions["HRA"] = cap(declarations.get("HRA", Decimal("0")), D("999999999"))
    total_exemptions = money(sum(exemptions.values(), Decimal("0")))

    deductions: dict[str, Decimal] = {"STANDARD_DEDUCTION": regime.standard_deduction}
    if regime.chapter_via_allowed:
        if approved_proofs.get("80C", False):
            deductions["80C"] = cap(declarations.get("80C", Decimal("0")), D("150000"))
        if approved_proofs.get("80CCD_1B", False):
            deductions["80CCD_1B"] = cap(declarations.get("80CCD_1B", Decimal("0")), D("50000"))
        if approved_proofs.get("80D", False):
            deductions["80D"] = cap(declarations.get("80D", Decimal("0")), D("100000"))
    if regime.professional_tax_allowed:
        deductions["PROFESSIONAL_TAX"] = cap(declarations.get("PROFESSIONAL_TAX", Decimal("0")), D("2500"))
    total_deductions = money(sum(deductions.values(), Decimal("0")))

    taxable_income = money(max(Decimal("0"), projected_annual_income - total_exemptions - total_deductions))
    tax_before_rebate, slab_trace = slab_tax(taxable_income, regime)

    rebate = Decimal("0")
    if regime.rebate and taxable_income <= regime.rebate.threshold:
        rebate = min(tax_before_rebate, regime.rebate.amount)
    tax_after_rebate = money(max(Decimal("0"), tax_before_rebate - rebate))

    relief = min(tax_after_rebate, money(relief_89))
    tax_after_relief = money(max(Decimal("0"), tax_after_rebate - relief))
    sc_rate = surcharge_rate(taxable_income, regime_name)
    surcharge = money(tax_after_relief * sc_rate)
    cess = money((tax_after_relief + surcharge) * regime.cess_rate)
    annual_tax = money(tax_after_relief + surcharge + cess)

    remaining_tax = money(max(Decimal("0"), annual_tax - money(current_employer_tds) - money(previous_employer_tds)))
    monthly_tds = money(remaining_tax / Decimal(remaining))

    trace = {
        "law": {
            "law_id": law.law_id,
            "law_name": law.law_name,
            "version": law.version,
            "forms": list(law.forms),
            "section_mappings": law.section_mappings,
            "selection_basis": "salary_payment_date",
            "salary_payment_date": salary_payment_date.isoformat(),
        },
        "regime": regime_name,
        "declaration_version_id": declaration_version_id,
        "projected_income": {k: str(v) for k, v in projected_income_parts.items()},
        "projected_annual_income": str(projected_annual_income),
        "exemptions": {k: str(v) for k, v in exemptions.items()},
        "deductions": {k: str(v) for k, v in deductions.items()},
        "taxable_income": str(taxable_income),
        "slab_breakdown": slab_trace,
        "slabs": slab_trace,
        "tax_before_rebate": str(tax_before_rebate),
        "rebate": {
            "amount": str(money(rebate)),
            "threshold": str(regime.rebate.threshold) if regime.rebate else None,
        },
        "surcharge": {"amount": str(money(surcharge)), "rate": str(sc_rate), "trace": []},
        "relief": {"section_89": str(money(relief))},
        "cess": {"rate": str(regime.cess_rate), "amount": str(cess)},
        "annual_tax": str(annual_tax),
        "monthly_allocation": {
            "annual_tax_liability": str(annual_tax),
            "current_employer_tds": str(money(current_employer_tds)),
            "previous_employer_tds": str(money(previous_employer_tds)),
            "remaining_tax": str(remaining_tax),
            "remaining_payroll_months": remaining,
            "monthly_tds": str(monthly_tds),
        },
    }
    trace["hash"] = canonical_hash(trace)

    return {
        "law_version": law.version,
        "law_name": law.law_name,
        "regime_applied": regime_name,
        "annual_gross": projected_annual_income,
        "taxable_income": taxable_income,
        "annual_tax_before_cess": tax_after_relief,
        "annual_tax": annual_tax,
        "remaining_tax": remaining_tax,
        "monthly_tds": monthly_tds,
        "tax_trace": trace,
        "trace_hash": trace["hash"],
    }


def compute_tds(monthly_gross: Decimal) -> dict[str, Any]:
    """Backward-compatible V1 entrypoint used by existing tests/routes."""

    return compute_annual_tds(
        salary_payment_date=date(2026, 4, 1),
        monthly_gross=monthly_gross,
        tax_regime="NEW",
        remaining_payroll_months=12,
    )


def compare_regimes(
    *,
    salary_payment_date: date,
    monthly_gross: Decimal,
    fixed_pay: Decimal | None = None,
    variable_pay: Decimal = Decimal("0"),
    bonus: Decimal = Decimal("0"),
    remaining_payroll_months: int = 12,
    declarations: dict[str, Decimal] | None = None,
    approved_proofs: dict[str, bool] | None = None,
    current_employer_tds: Decimal = Decimal("0"),
) -> dict[str, Any]:
    """Compute TDS under both OLD and NEW regimes, return comparison."""

    common = dict(
        salary_payment_date=salary_payment_date,
        monthly_gross=monthly_gross,
        fixed_pay=fixed_pay,
        variable_pay=variable_pay,
        bonus=bonus,
        remaining_payroll_months=remaining_payroll_months,
        current_employer_tds=current_employer_tds,
    )

    new_result = compute_annual_tds(
        **common,
        tax_regime="NEW",
        declarations=None,
        approved_proofs=None,
    )

    old_result = compute_annual_tds(
        **common,
        tax_regime="OLD",
        declarations=declarations or {},
        approved_proofs=approved_proofs or {},
    )

    new_tax = new_result["annual_tax"]
    old_tax = old_result["annual_tax"]
    recommended = "OLD" if old_tax <= new_tax else "NEW"
    savings = abs(new_tax - old_tax)

    return {
        "new_regime": new_result,
        "old_regime": old_result,
        "recommended": recommended,
        "savings": money(savings),
        "savings_description": f"{'Old' if recommended == 'OLD' else 'New'} Regime saves ₹{savings:,.0f} annually",
    }


def _remaining_fy_months(payment_date: date | None = None) -> int:
    """How many months remain in the FY from Apr to Mar."""
    d = payment_date or date.today()
    mo = d.month
    fy_month = mo - 3 if mo >= 4 else mo + 9  # 1=Apr .. 12=Mar
    return max(1, 12 - fy_month)


def compute_overview(
    *,
    ctc: Decimal,
    basic_monthly: Decimal,
    hra_monthly: Decimal,
    is_metro: bool = False,
    declarations: dict[str, Decimal] | None = None,
    approved_proofs: dict[str, bool] | None = None,
    salary_payment_date: date | None = None,
) -> dict[str, Any]:
    """Full employee tax overview for the UI dashboard.

    Called by the /tds/overview endpoint. Produces both-regime comparison,
    recommendation, alerts, and effective rates — everything the frontend
    KPI cards need.
    """
    payment_date = salary_payment_date or date.today()
    remaining = _remaining_fy_months(payment_date)
    monthly_gross = money(ctc / Decimal("12"))
    decl = declarations or {}

    # A deduction is granted only where an approved proof exists. Previously
    # every declared section was auto-approved, so the old-regime projection
    # counted unverified investments and understated the tax (and thus the
    # monthly TDS) shown on the dashboard.
    proofs: dict[str, bool] = dict(approved_proofs) if approved_proofs else {}

    comparison = compare_regimes(
        salary_payment_date=payment_date,
        monthly_gross=monthly_gross,
        fixed_pay=ctc,
        remaining_payroll_months=remaining,
        declarations=decl,
        approved_proofs=proofs,
    )

    new_r = comparison["new_regime"]
    old_r = comparison["old_regime"]
    recommended = comparison["recommended"]
    active = old_r if recommended == "OLD" else new_r

    annual_gross = active["annual_gross"]
    effective_rate = (
        (active["annual_tax"] / annual_gross * 100) if annual_gross > 0 else Decimal("0")
    )

    # Generate smart alerts
    alerts: list[dict[str, str]] = []
    c80c_used = decl.get("80C", Decimal("0"))
    if c80c_used < Decimal("150000"):
        remaining_80c = Decimal("150000") - c80c_used
        alerts.append({
            "type": "warning",
            "section": "80C",
            "message": f"₹{remaining_80c:,.0f} remaining under Section 80C. Invest in PPF, ELSS, or LIC to reduce tax.",
        })

    if decl.get("80D", Decimal("0")) == 0:
        alerts.append({
            "type": "warning",
            "section": "80D",
            "message": "Medical insurance deduction (80D) not utilized. Self cover gives up to ₹25,000 deduction.",
        })

    if decl.get("HRA", Decimal("0")) == 0 and hra_monthly > 0:
        alerts.append({
            "type": "info",
            "section": "HRA",
            "message": "HRA exemption not declared. If you pay rent, submit HRA details to save tax.",
        })

    if comparison["savings"] > 0:
        alerts.append({
            "type": "success",
            "section": "REGIME",
            "message": comparison["savings_description"],
        })

    if effective_rate > 20:
        alerts.append({
            "type": "info",
            "section": "RATE",
            "message": f"Effective tax rate is {effective_rate:.1f}%. Consider maximising all deductions.",
        })

    return {
        "employee_overview": {
            "annual_gross": str(annual_gross),
            "total_deductions": str(money(
                annual_gross - active["taxable_income"]
            )),
            "taxable_income": str(active["taxable_income"]),
            "annual_tax": str(active["annual_tax"]),
            "remaining_tax": str(active["remaining_tax"]),
            "monthly_tds": str(active["monthly_tds"]),
            "effective_rate": str(money(effective_rate)),
            "recommended_regime": recommended,
        },
        "new_regime": {
            "annual_tax": str(new_r["annual_tax"]),
            "monthly_tds": str(new_r["monthly_tds"]),
            "taxable_income": str(new_r["taxable_income"]),
            "effective_rate": str(
                money(new_r["annual_tax"] / new_r["annual_gross"] * 100)
                if new_r["annual_gross"] > 0 else "0.00"
            ),
            "tax_trace": new_r["tax_trace"],
        },
        "old_regime": {
            "annual_tax": str(old_r["annual_tax"]),
            "monthly_tds": str(old_r["monthly_tds"]),
            "taxable_income": str(old_r["taxable_income"]),
            "effective_rate": str(
                money(old_r["annual_tax"] / old_r["annual_gross"] * 100)
                if old_r["annual_gross"] > 0 else "0.00"
            ),
            "tax_trace": old_r["tax_trace"],
        },
        "savings": str(comparison["savings"]),
        "recommended": recommended,
        "remaining_months": remaining,
        "alerts": alerts,
    }

