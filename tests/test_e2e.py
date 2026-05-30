"""End-to-end integration test: run a full payroll cycle through the gateway.

Requires the stack to be up (`docker compose up`). The test is skipped
automatically if the gateway is unreachable, so it is safe in CI without infra.

    python -m pytest tests/test_e2e.py -v
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal

import pytest

BASE = os.environ.get("GATEWAY_URL", "http://localhost:8000") + "/api/v1"


def _http(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw
    except urllib.error.URLError as exc:
        pytest.skip(f"Gateway not reachable at {BASE}: {exc}")


def _token():
    s, d = _http("POST", "/auth/login",
                 body={"email": "admin@demo.com", "password": "Admin@123"})
    if s == 200:
        return d["access_token"]
    s, d = _http("POST", "/auth/register", body={
        "tenant_name": "E2E Corp", "email": "admin@demo.com", "password": "Admin@123"})
    assert s in (200, 201), d
    return d["access_token"]


def D(x):
    return Decimal(str(x))


def test_full_cycle():
    token = _token()
    today = date.today()
    month_first = date(today.year, today.month, 1).isoformat()

    # Employee (idempotent on emp_code)
    s, emp = _http("POST", "/employees", token, {
        "emp_code": "E2E-TEST", "first_name": "Test", "last_name": "User",
        "work_location": "Mumbai", "status": "ACTIVE",
        "bank_account": "9999999999",
    })
    if s == 409:
        _, page = _http("GET", "/employees?search=E2E-TEST", token)
        emp = next(e for e in page["items"] if e["emp_code"] == "E2E-TEST")
    else:
        assert s in (200, 201), emp
    emp_id = emp["id"]

    # Salary: CTC 1,200,000 -> gross 100000, basic 40000, hra 20000 (metro)
    s, _ = _http("POST", "/salary/structures", token, {
        "employee_id": emp_id, "ctc": 1200000,
        "effective_from": date(today.year, 1, 1).isoformat(),
        "work_location": "Mumbai",
    })
    assert s in (200, 201)

    # Attendance: full month, no LOP
    s, _ = _http("POST", "/attendance/manual", token, {
        "employee_id": emp_id, "month": month_first,
        "total_days": 30, "present_days": 30,
    })
    assert s in (200, 201)

    # Create + run cycle
    s, cycle = _http("POST", "/payroll/cycles", token, {
        "name": f"E2E {month_first}", "period_start": month_first,
        "period_end": date(today.year, today.month, 28).isoformat(),
    })
    assert s in (200, 201), cycle
    cid = cycle["id"]

    s, summary = _http("POST", f"/payroll/cycles/{cid}/run", token)
    assert s == 200, summary
    assert summary["status"] == "COMPUTED"
    assert summary["computed"] >= 1

    # Verify the math for our employee
    s, result = _http("GET", f"/payroll/results/{cid}/{emp_id}", token)
    assert s == 200, result
    bd = result["breakdown_json"]
    gross = D(result["gross_earnings"])
    assert gross == D("100000.00")
    assert D(bd["earnings"]["basic"]) == D("40000.00")            # 40% of gross
    assert D(bd["earnings"]["hra"]) == D("20000.00")              # metro 50% of basic
    assert D(bd["deductions"]["employee_pf"]) == D("1800.00")     # 12% of 15000
    assert D(bd["deductions"]["employee_esi"]) == D("0.00")       # gross > 21000
    assert D(bd["deductions"]["tds"]) == D("4550.00")
    assert D(bd["deductions"]["pt"]) in (D("200.00"), D("300.00"))
    assert D(bd["deductions"]["lop"]) == D("0.00")

    net = D(result["net_pay"])
    total_ded = D(result["total_deductions"])
    assert net == gross - total_ded

    # Idempotent re-run: result count must not grow
    _, before = _http("GET", f"/payroll/cycles/{cid}/summary", token)
    n_before = len(before["results"])
    _http("POST", f"/payroll/cycles/{cid}/run", token)
    _, after = _http("GET", f"/payroll/cycles/{cid}/summary", token)
    assert len(after["results"]) == n_before

    # Approve & disburse
    s, disb = _http("POST", f"/payroll/cycles/{cid}/approve", token)
    assert s == 200, disb
    assert disb["status"] == "DISBURSED"

    # Payout transactions SUCCESS
    _, batches = _http("GET", f"/payouts/batches/{cid}", token)
    assert len(batches) >= 1
    _, txns = _http("GET", f"/payouts/transactions/{batches[0]['id']}", token)
    assert any(t["status"] == "SUCCESS" and t["bank_reference"] for t in txns)
