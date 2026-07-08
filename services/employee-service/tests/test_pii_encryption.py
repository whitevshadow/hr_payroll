"""
PII field-level encryption tests.

Verifies that:
1. EncryptedString stores ciphertext, not plaintext, in the DB column.
2. ORM round-trip (write then read) returns the original value.
3. The same plaintext produces different ciphertexts each call (Fernet IV).
4. A missing FIELD_ENCRYPTION_KEY raises RuntimeError, not a silent pass.
5. Key rotation: a value encrypted with the old key decrypts after rotation.
6. mask_pan and mask_bank_account produce the correct masked output.
7. Payroll breakdown_json never contains a raw PAN or bank account.
"""
from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import hr_shared.crypto as crypto_module
from hr_shared import EncryptedString, TenantAwareBase, mask_bank_account, mask_pan
from hr_shared.crypto import EncryptedString as _ES, reset_fernet

# ---------------------------------------------------------------------------
# Test key fixture
# ---------------------------------------------------------------------------

TEST_KEY = Fernet.generate_key().decode()
OLD_KEY = Fernet.generate_key().decode()


@pytest.fixture(autouse=True)
def _patch_key(monkeypatch):
    """Inject a test key and reset the module-level singleton before each test."""
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", TEST_KEY)
    reset_fernet()
    yield
    reset_fernet()


# ---------------------------------------------------------------------------
# In-memory SQLite engine for model round-trip tests
# ---------------------------------------------------------------------------

from app.models import Employee  # noqa: E402 (import after key patch fixture)

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True, scope="function")
async def _schema():
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(TenantAwareBase.metadata.drop_all)


@pytest_asyncio.fixture
async def session() -> AsyncSession:
    async with _session_factory() as s:
        yield s


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _make_employee(tenant_id: uuid.UUID, **overrides) -> Employee:
    defaults = dict(
        tenant_id=tenant_id,
        emp_code="E001",
        first_name="Alice",
        last_name="Sharma",
        pan_number="ABCDE1234F",
        bank_account="123456789012",
        bank_ifsc="SBIN0001234",
        uan_number="100123456789",
    )
    defaults.update(overrides)
    return Employee(**defaults)


# ---------------------------------------------------------------------------
# Tests: round-trip
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encrypted_fields_round_trip(session: AsyncSession):
    """ORM transparently encrypts on write and decrypts on read."""
    tid = uuid.uuid4()
    emp = _make_employee(tid)
    session.add(emp)
    await session.commit()
    await session.refresh(emp)

    assert emp.pan_number == "ABCDE1234F"
    assert emp.bank_account == "123456789012"
    assert emp.bank_ifsc == "SBIN0001234"
    assert emp.uan_number == "100123456789"


@pytest.mark.asyncio
async def test_ciphertext_stored_not_plaintext(session: AsyncSession):
    """Raw DB value must be Fernet ciphertext, never the original string."""
    tid = uuid.uuid4()
    emp = _make_employee(tid)
    session.add(emp)
    await session.commit()

    # Bypass ORM — read raw bytes from the DB.
    row = await session.execute(
        text("SELECT pan_number, bank_account FROM employees WHERE id = :id"),
        {"id": str(emp.id)},
    )
    raw = row.mappings().one()

    assert raw["pan_number"] != "ABCDE1234F", "PAN stored as plaintext — encryption not applied"
    assert raw["bank_account"] != "123456789012", "Bank account stored as plaintext"
    # Fernet tokens start with "gAAAAA" (URL-safe base64 of the version byte).
    assert raw["pan_number"].startswith("gAAAAA"), f"Unexpected ciphertext format: {raw['pan_number'][:10]}"


@pytest.mark.asyncio
async def test_none_roundtrips_as_none(session: AsyncSession):
    """Null PII fields must remain NULL, not encrypted NULL strings."""
    tid = uuid.uuid4()
    emp = _make_employee(tid, pan_number=None, bank_account=None)
    session.add(emp)
    await session.commit()
    await session.refresh(emp)

    assert emp.pan_number is None
    assert emp.bank_account is None


@pytest.mark.asyncio
async def test_same_plaintext_produces_different_ciphertext(session: AsyncSession):
    """Fernet uses a random IV — two employees with the same PAN must have different ciphertext."""
    tid = uuid.uuid4()
    emp1 = _make_employee(tid, emp_code="E001")
    emp2 = _make_employee(tid, emp_code="E002")
    session.add_all([emp1, emp2])
    await session.commit()

    row = await session.execute(
        text("SELECT pan_number FROM employees WHERE tenant_id = :tid"),
        {"tid": str(tid)},
    )
    ciphertexts = [r["pan_number"] for r in row.mappings()]
    assert len(set(ciphertexts)) == 2, "Same plaintext produced identical ciphertext — IV reuse detected"


# ---------------------------------------------------------------------------
# Tests: key management
# ---------------------------------------------------------------------------

def test_missing_key_raises_at_first_use(monkeypatch):
    """Service must fail loudly, not silently, when encryption key is absent."""
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    reset_fernet()

    type_dec = _ES()
    with pytest.raises(RuntimeError, match="FIELD_ENCRYPTION_KEY"):
        type_dec.process_bind_param("ABCDE1234F", dialect=None)


def test_key_rotation(monkeypatch):
    """Value encrypted with OLD_KEY decrypts after adding NEW_KEY as primary."""
    from cryptography.fernet import Fernet as _Fernet

    # Encrypt with the old key alone.
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", OLD_KEY)
    reset_fernet()
    dec = _ES()
    ciphertext = dec.process_bind_param("ABCDE1234F", dialect=None)

    # Rotate: new key is primary, old key retained for decryption.
    new_key = _Fernet.generate_key().decode()
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", f"{new_key},{OLD_KEY}")
    reset_fernet()
    dec2 = _ES()
    plaintext = dec2.process_result_value(ciphertext, dialect=None)

    assert plaintext == "ABCDE1234F"


# ---------------------------------------------------------------------------
# Tests: masking helpers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("pan,expected", [
    ("ABCDE1234F", "ABCDE####F"),
    ("XXXXX9999X", "XXXXX####X"),
    (None, "-"),
    ("", "-"),
    ("AB", "XX"),
])
def test_mask_pan(pan, expected):
    assert mask_pan(pan) == expected


@pytest.mark.parametrize("account,expected", [
    ("123456789012", "XXXXXXXX9012"),
    ("1234", "1234"),
    ("123", "XXX"),
    (None, "-"),
    ("", "-"),
])
def test_mask_bank_account(account, expected):
    assert mask_bank_account(account) == expected


# ---------------------------------------------------------------------------
# Tests: breakdown_json masking (payroll orchestrator contract)
# ---------------------------------------------------------------------------

def test_breakdown_json_masks_pan_and_bank():
    """
    Simulate the breakdown dict that orchestrator builds and assert it never
    contains a raw PAN or bank account.
    """
    from hr_shared import mask_bank_account as mba, mask_pan as mp

    raw_pan = "ABCDE1234F"
    raw_bank = "123456789012"

    breakdown_employee = {
        "pan": mp(raw_pan),
        "bank_account": mba(raw_bank),
    }

    assert breakdown_employee["pan"] != raw_pan, "Raw PAN leaked into breakdown"
    assert breakdown_employee["bank_account"] != raw_bank, "Raw bank account leaked"
    assert "1234F" not in breakdown_employee["pan"]
    assert breakdown_employee["bank_account"].endswith("9012")
    assert breakdown_employee["bank_account"].startswith("XXXX")
