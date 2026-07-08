"""Synchronous (httpx) clients for downstream services.

The incoming user JWT is forwarded on every outbound call so each service
derives the same tenant from it.

# TODO(v2): replace synchronous orchestration with Kafka events + SAGA;
# add a transactional outbox so partial failures are recoverable.
"""

from __future__ import annotations

import httpx

from .settings import settings


class ServiceCallError(Exception):
    def __init__(self, service: str, detail: str):
        self.service = service
        self.detail = detail
        super().__init__(f"{service}: {detail}")


def _headers(token: str, client_id: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {token}"}
    if client_id:
        h["x-client-id"] = client_id
    return h


async def _get(client: httpx.AsyncClient, service: str, url: str, token: str, client_id: str | None = None):
    try:
        resp = await client.get(url, headers=_headers(token, client_id))
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        raise ServiceCallError(service, f"{exc.response.status_code} {exc.response.text}")
    except httpx.RequestError as exc:
        raise ServiceCallError(service, f"unreachable: {exc}")


async def _post(client: httpx.AsyncClient, service: str, url: str, token: str, json: dict, client_id: str | None = None):
    try:
        resp = await client.post(url, headers=_headers(token, client_id), json=json)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        raise ServiceCallError(service, f"{exc.response.status_code} {exc.response.text}")
    except httpx.RequestError as exc:
        raise ServiceCallError(service, f"unreachable: {exc}")


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=settings.http_timeout_seconds)


async def list_active_employees(client, token: str, client_id: str | None = None) -> list[dict]:
    data = await _get(
        client,
        "employee-service",
        f"{settings.employee_url}/api/v1/employees?status=ACTIVE&page_size=200",
        token,
        client_id,
    )
    return data["items"]


async def get_my_employee(client, token: str, client_id: str | None = None) -> dict:
    """Resolve the caller's own employee record via employee-service."""
    return await _get(
        client,
        "employee-service",
        f"{settings.employee_url}/api/v1/employees/me",
        token,
        client_id,
    )


async def get_salary_breakdown(client, token: str, employee_id: str, client_id: str | None = None) -> dict:
    return await _get(
        client,
        "salary-service",
        f"{settings.salary_url}/api/v1/salary/structures/{employee_id}",
        token,
        client_id,
    )


async def get_attendance(client, token: str, employee_id: str, month: str, client_id: str | None = None) -> dict | None:
    try:
        return await _get(
            client,
            "attendance-service",
            f"{settings.attendance_url}/api/v1/attendance/{employee_id}/{month}",
            token,
            client_id,
        )
    except ServiceCallError as exc:
        if "404" in exc.detail:
            return None
        raise


async def compute_compliance(client, token: str, payload: dict, client_id: str | None = None) -> dict:
    return await _post(
        client,
        "compliance-service",
        f"{settings.compliance_url}/api/v1/compliance/compute",
        token,
        payload,
        client_id,
    )


async def compute_tds(client, token: str, payload: dict, client_id: str | None = None) -> dict:
    return await _post(
        client,
        "tds-service",
        f"{settings.tds_url}/api/v1/tds/compute",
        token,
        payload,
        client_id,
    )


async def create_payout_batch(client, token: str, payload: dict, client_id: str | None = None) -> dict:
    return await _post(
        client,
        "payout-service",
        f"{settings.payout_url}/api/v1/payouts/batches",
        token,
        payload,
        client_id,
    )


async def generate_payslips(client, token: str, payload: dict, client_id: str | None = None) -> dict:
    return await _post(
        client,
        "reporting-service",
        f"{settings.reporting_url}/api/v1/reports/payslips/generate",
        token,
        payload,
        client_id,
    )
