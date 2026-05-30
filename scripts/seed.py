#!/usr/bin/env python3
"""Seed demo data through the gateway.

Creates: 1 tenant, 1 admin (admin@demo.com / Admin@123), 2 departments,
5 employees (metro/non-metro mix, one ESI-eligible), an active salary
structure each, and attendance for the current month (one with 2 LOP days).

Run AFTER `docker compose up`:  python scripts/seed.py
Uses only the Python standard library.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import date

BASE = os.environ.get("GATEWAY_URL", "http://localhost:8000") + "/api/v1"

ADMIN_EMAIL = "admin@demo.com"
ADMIN_PASSWORD = "Admin@123"


def http(method: str, path: str, token: str | None = None, body: dict | None = None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw)
        except Exception:
            payload = raw
        return exc.code, payload


def get_token() -> str:
    status, data = http("POST", "/auth/login",
                        body={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if status == 200:
        print("Logged in as existing admin.")
        return data["access_token"]
    status, data = http("POST", "/auth/register", body={
        "tenant_name": "Demo Corp",
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    })
    if status not in (200, 201):
        raise SystemExit(f"Register failed: {status} {data}")
    print("Registered new tenant + admin.")
    return data["access_token"]


EMPLOYEES = [
    # emp_code, first, last, location, ctc, lop_days
    ("E001", "Asha", "Mehta", "Mumbai", 1200000, 2),     # metro, high, 2 LOP
    ("E002", "Ravi", "Kumar", "Pune", 600000, 0),        # non-metro
    ("E003", "Neha", "Singh", "Delhi", 240000, 0),       # metro, ESI-eligible
    ("E004", "Imran", "Khan", "Bangalore", 900000, 0),   # non-metro
    ("E005", "Divya", "Rao", "Chennai", 360000, 0),      # metro
]


def main() -> None:
    token = get_token()

    # Departments
    dept_ids = []
    for name, cc in [("Engineering", "CC-ENG"), ("Operations", "CC-OPS")]:
        status, data = http("POST", "/departments", token,
                            {"name": name, "cost_center": cc})
        if status in (200, 201):
            dept_ids.append(data["id"])
            print(f"Department created: {name}")
    default_dept = dept_ids[0] if dept_ids else None

    # Employees
    today = date.today()
    joining = date(today.year - 1, 1, 1).isoformat()
    for code, first, last, loc, _ctc, _lop in EMPLOYEES:
        status, data = http("POST", "/employees", token, {
            "emp_code": code,
            "first_name": first,
            "last_name": last,
            "email": f"{code.lower()}@demo.com",
            "pan_number": f"ABCDE{code[1:]}F",
            "bank_account": f"00112233{code[1:]}",
            "bank_ifsc": "HDFC0000001",
            "uan_number": f"100000000{code[1:]}",
            "status": "ACTIVE",
            "joining_date": joining,
            "department_id": default_dept,
            "designation": "Staff",
            "work_location": loc,
        })
        if status in (200, 201):
            print(f"Employee created: {code} {first} {last} ({loc})")
        elif status == 409:
            print(f"Employee {code} already exists — skipping.")
        else:
            print(f"Employee {code} failed: {status} {data}")

    # Map emp_code -> employee record
    status, data = http("GET", "/employees?page_size=200", token)
    by_code = {e["emp_code"]: e for e in data["items"]}

    # Salary structures + attendance
    month_first = date(today.year, today.month, 1).isoformat()
    eff_from = date(today.year, 1, 1).isoformat()
    for code, _f, _l, loc, ctc, lop in EMPLOYEES:
        emp = by_code.get(code)
        if not emp:
            continue
        s, _ = http("POST", "/salary/structures", token, {
            "employee_id": emp["id"],
            "ctc": ctc,
            "effective_from": eff_from,
            "work_location": loc,
        })
        print(f"Salary structure for {code}: {'ok' if s in (200,201) else s}")

        total_days = 30
        present = total_days - lop
        s, _ = http("POST", "/attendance/manual", token, {
            "employee_id": emp["id"],
            "month": month_first,
            "total_days": total_days,
            "present_days": present,
        })
        print(f"Attendance for {code} ({present}/{total_days}, LOP {lop}): "
              f"{'ok' if s in (200,201) else s}")

    # Additional role-scoped users for testing role gating (V1.1).
    extra_users = [
        ("hr@demo.com", "Hr@12345", ["HR_MANAGER"], "HR Manager"),
        # EMPLOYEE user linked to E001 by matching email.
        ("e001@demo.com", "Emp@12345", ["EMPLOYEE"], "Employee (E001 self-service)"),
    ]
    for email, pwd, roles, label in extra_users:
        s, d = http("POST", "/auth/users", token, {
            "email": email, "password": pwd, "roles": roles,
        })
        if s in (200, 201):
            print(f"User created: {label} — {email} / {pwd}")
        elif s == 409:
            print(f"User {email} already exists — skipping.")
        else:
            print(f"User {email} failed: {s} {d}")

    print("\nSeed complete.")
    print(f"Admin login:       {ADMIN_EMAIL} / {ADMIN_PASSWORD}  (full access)")
    print("HR Manager login:  hr@demo.com / Hr@12345  (no approve, no audit)")
    print("Employee login:    e001@demo.com / Emp@12345  (self-service only)")
    print(f"Target month for the payroll run: {month_first}")


if __name__ == "__main__":
    main()
