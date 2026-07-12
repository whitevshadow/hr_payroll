#!/usr/bin/env python3
"""Seed the default admin account through the gateway.

Creates: 1 tenant (Demo Corp) + 1 admin user (admin@demo.com / Admin@123).

Run AFTER `docker compose up`:  python scripts/seed.py
Uses only the Python standard library.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

BASE = os.environ.get("GATEWAY_URL", "http://localhost:4000") + "/api/v1"

ADMIN_EMAIL = "admin@demo.com"
ADMIN_PASSWORD = "Admin@123"


def http(method: str, path: str, body: dict | None = None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
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


def main() -> None:
    # Try logging in first (idempotent — works on re-deploys)
    status, data = http("POST", "/auth/login",
                        body={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if status == 200:
        print("Admin already exists — logged in successfully.")
        print(f"\n  Email:    {ADMIN_EMAIL}")
        print(f"  Password: {ADMIN_PASSWORD}")
        return

    # First run — register the tenant + admin
    status, data = http("POST", "/auth/register", body={
        "tenant_name": "Demo Corp",
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    })
    if status not in (200, 201):
        raise SystemExit(f"Register failed: {status} {data}")

    print("Registered new tenant + admin.")
    print(f"\n  Email:    {ADMIN_EMAIL}")
    print(f"  Password: {ADMIN_PASSWORD}")


if __name__ == "__main__":
    main()
