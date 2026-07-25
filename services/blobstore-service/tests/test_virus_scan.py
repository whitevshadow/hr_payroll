from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.config import get_settings
from app.storage import virus_scan


def _install_fake_clamd(monkeypatch, verdict, signature=None, raise_exc=None):
    fake = types.ModuleType("clamd")

    class _Client:
        def __init__(self, *a, **k):
            pass

        def instream(self, _stream):
            if raise_exc:
                raise raise_exc
            return {"stream": (verdict, signature)}

    fake.ClamdNetworkSocket = _Client
    monkeypatch.setitem(sys.modules, "clamd", fake)


@pytest.mark.asyncio
async def test_disabled_is_noop(monkeypatch):
    monkeypatch.setattr(get_settings(), "VIRUS_SCAN_ENABLED", False)
    await virus_scan.scan_or_raise(b"anything")  # no exception


@pytest.mark.asyncio
async def test_clean_passes(monkeypatch):
    monkeypatch.setattr(get_settings(), "VIRUS_SCAN_ENABLED", True)
    _install_fake_clamd(monkeypatch, "OK")
    await virus_scan.scan_or_raise(b"clean")


@pytest.mark.asyncio
async def test_infected_rejected(monkeypatch):
    monkeypatch.setattr(get_settings(), "VIRUS_SCAN_ENABLED", True)
    _install_fake_clamd(monkeypatch, "FOUND", "Eicar-Test-Signature")
    with pytest.raises(HTTPException) as exc:
        await virus_scan.scan_or_raise(b"evil")
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_fail_open_allows_when_scanner_down(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "VIRUS_SCAN_ENABLED", True)
    monkeypatch.setattr(s, "VIRUS_SCAN_FAIL_CLOSED", False)
    _install_fake_clamd(monkeypatch, "OK", raise_exc=ConnectionError("down"))
    await virus_scan.scan_or_raise(b"data")  # allowed through


@pytest.mark.asyncio
async def test_fail_closed_rejects_when_scanner_down(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "VIRUS_SCAN_ENABLED", True)
    monkeypatch.setattr(s, "VIRUS_SCAN_FAIL_CLOSED", True)
    _install_fake_clamd(monkeypatch, "OK", raise_exc=ConnectionError("down"))
    with pytest.raises(HTTPException) as exc:
        await virus_scan.scan_or_raise(b"data")
    assert exc.value.status_code == 503
