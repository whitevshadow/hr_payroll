"""Field-level encryption for PII columns.

All fields classified as PII under the DPDP Act 2023 (PAN, Aadhaar, bank
account numbers) MUST use EncryptedString as their column type, never String.

Key management
--------------
Set FIELD_ENCRYPTION_KEY to a comma-separated list of URL-safe base64 Fernet
keys.  The *first* key encrypts new writes; all keys decrypt (MultiFernet
enables zero-downtime rotation).

Generate a fresh key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Production: populate FIELD_ENCRYPTION_KEY from AWS Secrets Manager or
HashiCorp Vault at container start — never commit a key to source control.
"""
from __future__ import annotations

import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator


# ---------------------------------------------------------------------------
# Key management
# ---------------------------------------------------------------------------

_fernet: MultiFernet | None = None


def _build_fernet() -> MultiFernet:
    raw = os.environ.get("FIELD_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is not set. "
            "Generate: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    keys = [k.strip().encode() for k in raw.split(",") if k.strip()]
    if not keys:
        raise RuntimeError("FIELD_ENCRYPTION_KEY contains no valid keys.")
    return MultiFernet([Fernet(k) for k in keys])


def get_fernet() -> MultiFernet:
    """Return module-level MultiFernet, initialised lazily from env."""
    global _fernet
    if _fernet is None:
        _fernet = _build_fernet()
    return _fernet


def reset_fernet() -> None:
    """Force re-initialisation — call in tests after patching the env var."""
    global _fernet
    _fernet = None


# ---------------------------------------------------------------------------
# SQLAlchemy TypeDecorator
# ---------------------------------------------------------------------------

class EncryptedString(TypeDecorator):
    """Transparent Fernet encryption for string PII columns.

    DB storage type is Text (Fernet tokens are ~100+ bytes base64-encoded,
    longer than any fixed VARCHAR could safely hold).

    Usage:
        pan_number: Mapped[str | None] = mapped_column(EncryptedString)
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> str | None:
        """Encrypt on write."""
        if value is None:
            return None
        return get_fernet().encrypt(value.encode()).decode()

    def process_result_value(self, value: Any, dialect: Dialect) -> str | None:
        """Decrypt on read."""
        if value is None:
            return None
        try:
            return get_fernet().decrypt(value.encode()).decode()
        except InvalidToken as exc:
            # Raise loudly — silent corruption is far worse than a crash.
            # If this fires after a key rotation, add the old key to
            # FIELD_ENCRYPTION_KEY (comma-separated) and re-deploy.
            raise ValueError(
                "PII decryption failed. The ciphertext may be corrupt or the "
                "encryption key has been rotated without retaining the old key. "
                "See FIELD_ENCRYPTION_KEY docs."
            ) from exc


# ---------------------------------------------------------------------------
# Display masking helpers (for payslips and audit logs)
# ---------------------------------------------------------------------------

def mask_pan(pan: str | None) -> str:
    """ABCDE1234F → ABCDE####F  (statutory: first 5 chars identify taxpayer type).

    Full PAN appears on employee-facing Form 16 Part B (as required by
    Section 203 of ITA 1961), but masked in payroll JSON snapshots and
    internal audit logs that are accessible to HR admins.
    """
    if not pan:
        return "-"
    pan = pan.strip()
    if len(pan) < 6:
        return "X" * len(pan)
    return pan[:5] + "####" + pan[-1]


def mask_bank_account(account: str | None) -> str:
    """12345678901234 → XXXXXXXXXX1234  (last 4 digits visible for reconciliation)."""
    if not account:
        return "-"
    account = account.strip()
    if len(account) <= 4:
        return "X" * len(account)
    return "X" * (len(account) - 4) + account[-4:]
