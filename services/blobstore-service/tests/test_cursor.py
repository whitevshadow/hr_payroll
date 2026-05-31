from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.services.blob_service import _decode_cursor, _encode_cursor


def test_cursor_round_trip():
    ts = datetime(2026, 5, 30, 12, 0, 0, tzinfo=timezone.utc)
    bid = uuid.uuid4()
    cursor = _encode_cursor(ts, bid)
    decoded_ts, decoded_id = _decode_cursor(cursor)
    assert decoded_ts == ts
    assert decoded_id == bid


def test_decode_none_returns_none():
    assert _decode_cursor(None) is None
    assert _decode_cursor("") is None


def test_decode_garbage_raises_400():
    with pytest.raises(HTTPException) as exc:
        _decode_cursor("not-a-valid-cursor!!!")
    assert exc.value.status_code == 400
