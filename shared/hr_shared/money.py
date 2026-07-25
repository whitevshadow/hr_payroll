"""Deterministic money helpers.

Money is ALWAYS a ``Decimal`` quantized to 2 places with ROUND_HALF_UP.
Never use float for money. Round once, at each persisted value.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value) -> Decimal:
    """Coerce a value to a 2dp Decimal using ROUND_HALF_UP.

    Accepts int / str / Decimal. Avoid passing float; if a float sneaks in we
    route it through ``str`` to dodge binary-float artifacts.
    """
    if isinstance(value, float):
        value = str(value)
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


class Money:
    """Tiny convenience wrapper. Most code just calls ``money(x)``."""

    @staticmethod
    def of(value) -> Decimal:
        return money(value)

    @staticmethod
    def round(value) -> Decimal:
        return money(value)

    zero = ZERO
