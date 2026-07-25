from __future__ import annotations

import pytest

from tests.conftest import (
    EMPLOYEE_ID,
    OTHER_TENANT_ID,
    TENANT_ID,
    auth_headers,
    upload_files,
)


async def _upload(client, doc_type="AADHAAR", employee_id=EMPLOYEE_ID,
                  filename="a.pdf", content=b"x", content_type="application/pdf",
                  tenant_id=TENANT_ID):
    data = {"doc_type": doc_type}
    if employee_id:
        data["employee_id"] = employee_id
    resp = await client.post(
        "/api/v1/blobs/upload",
        headers=auth_headers(tenant_id),
        files=upload_files(filename, content, content_type),
        data=data,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestAuth:
    @pytest.mark.asyncio
    async def test_upload_requires_token(self, client):
        resp = await client.post(
            "/api/v1/blobs/upload",
            files=upload_files(),
            data={"doc_type": "AADHAAR"},
        )
        assert resp.status_code == 401


class TestUploadRouting:
    @pytest.mark.asyncio
    async def test_upload_uses_tenant_bucket(self, client, mock_minio):
        await _upload(client)
        bucket = mock_minio["minio"].put_object.call_args.kwargs["bucket_name"]
        assert bucket == f"tenant-{TENANT_ID}"

    @pytest.mark.asyncio
    async def test_employee_doc_object_key(self, client, mock_minio):
        await _upload(client, doc_type="AADHAAR")
        key = mock_minio["minio"].put_object.call_args.kwargs["object_name"]
        assert key.startswith(f"employees/{EMPLOYEE_ID}/aadhaar/")

    @pytest.mark.asyncio
    async def test_metadata_persists_etag_and_checksum(self, client):
        data = await _upload(client)
        meta = await client.get(
            f"/api/v1/blobs/{data['blob_id']}/metadata", headers=auth_headers()
        )
        assert meta.status_code == 200
        body = meta.json()
        assert body["etag"] == "test-etag"
        assert body["checksum"].startswith("sha256:")


class TestTenantIsolation:
    @pytest.mark.asyncio
    async def test_other_tenant_cannot_read(self, client):
        data = await _upload(client, tenant_id=TENANT_ID)
        resp = await client.get(
            f"/api/v1/blobs/{data['blob_id']}/metadata",
            headers=auth_headers(OTHER_TENANT_ID),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_list_only_returns_own_tenant(self, client):
        await _upload(client, tenant_id=TENANT_ID)
        resp = await client.get("/api/v1/blobs", headers=auth_headers(OTHER_TENANT_ID))
        assert resp.status_code == 200
        assert resp.json()["count"] == 0


class TestDeleteRestore:
    @pytest.mark.asyncio
    async def test_soft_delete_then_restore(self, client, mock_minio):
        data = await _upload(client)
        bid = data["blob_id"]

        d = await client.delete(f"/api/v1/blobs/{bid}", headers=auth_headers())
        assert d.status_code == 204
        mock_minio["minio"].remove_object.assert_not_called()

        # Hidden from reads while soft-deleted.
        assert (await client.get(f"/api/v1/blobs/{bid}/metadata", headers=auth_headers())).status_code == 404

        r = await client.post(f"/api/v1/blobs/{bid}/restore", headers=auth_headers())
        assert r.status_code == 200
        assert (await client.get(f"/api/v1/blobs/{bid}/metadata", headers=auth_headers())).status_code == 200

    @pytest.mark.asyncio
    async def test_hard_delete_removes_object(self, client, mock_minio):
        data = await _upload(client)
        resp = await client.delete(
            f"/api/v1/blobs/{data['blob_id']}?permanent=true", headers=auth_headers()
        )
        assert resp.status_code == 204
        mock_minio["minio"].remove_object.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_requires_admin_role(self, client):
        data = await _upload(client)
        resp = await client.delete(
            f"/api/v1/blobs/{data['blob_id']}",
            headers=auth_headers(roles=["EMPLOYEE"]),
        )
        assert resp.status_code == 403


class TestListingPagination:
    @pytest.mark.asyncio
    async def test_keyset_pagination(self, client):
        for i in range(3):
            await _upload(client, filename=f"f{i}.pdf")

        page1 = await client.get("/api/v1/blobs?limit=2", headers=auth_headers())
        body1 = page1.json()
        assert body1["count"] == 2
        assert body1["next_cursor"] is not None

        page2 = await client.get(
            f"/api/v1/blobs?limit=2&cursor={body1['next_cursor']}", headers=auth_headers()
        )
        body2 = page2.json()
        assert body2["count"] == 1
        assert body2["next_cursor"] is None


class TestOutbox:
    @pytest.mark.asyncio
    async def test_upload_writes_outbox_event(self, client, db_session):
        from sqlalchemy import text

        await _upload(client)
        rows = await db_session.execute(
            text("SELECT event_type FROM blob_outbox WHERE event_type = 'blob.created.v1'")
        )
        assert rows.first() is not None
