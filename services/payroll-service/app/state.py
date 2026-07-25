"""Payroll cycle state machine.

DRAFT -> LOCKED -> COMPUTING -> COMPUTED -> APPROVED -> DISBURSED
Transitions are one-directional; a DISBURSED cycle can never be reopened.
FAILED is reachable from COMPUTING. A FAILED or COMPUTED cycle may be re-run
(idempotent recompute) which returns it to LOCKED/COMPUTING.
"""

from __future__ import annotations

from fastapi import HTTPException

DRAFT = "DRAFT"
LOCKED = "LOCKED"
COMPUTING = "COMPUTING"
COMPUTED = "COMPUTED"
APPROVED = "APPROVED"
DISBURSED = "DISBURSED"
FAILED = "FAILED"

# Allowed forward transitions.
_ALLOWED: dict[str, set[str]] = {
    DRAFT: {LOCKED},
    LOCKED: {COMPUTING},
    COMPUTING: {COMPUTED, FAILED},
    COMPUTED: {APPROVED, LOCKED},  # LOCKED = re-run
    APPROVED: {DISBURSED},
    DISBURSED: set(),
    FAILED: {LOCKED},  # re-run after failure
}

# States from which a run may (re)start.
RUNNABLE = {DRAFT, COMPUTED, FAILED}


def assert_transition(current: str, target: str) -> None:
    if target not in _ALLOWED.get(current, set()):
        raise HTTPException(
            status_code=409,
            detail=f"Invalid transition {current} -> {target}",
        )
