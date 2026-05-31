from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from minio.error import S3Error

from app.storage.bucket_resolver import BucketResolver


@pytest.fixture
def minio_mock():
    mock = MagicMock()
    mock.bucket_exists.return_value = False
    mock.make_bucket.return_value = None
    return mock


@pytest.fixture
def resolver(minio_mock):
    return BucketResolver(minio_client=minio_mock, boto_client=MagicMock())


class TestBucketNaming:
    def test_resolve_returns_tenant_bucket(self, resolver, minio_mock):
        minio_mock.bucket_exists.return_value = True
        assert resolver.resolve("abc-123") == "tenant-abc-123"

    def test_creates_bucket_when_missing(self, resolver, minio_mock):
        minio_mock.bucket_exists.return_value = False
        resolver.resolve("new-co")
        minio_mock.make_bucket.assert_called_once_with("tenant-new-co")

    def test_caches_to_avoid_repeat_stat(self, resolver, minio_mock):
        minio_mock.bucket_exists.return_value = False
        resolver.resolve("t")
        resolver.resolve("t")
        assert minio_mock.bucket_exists.call_count == 1
        assert minio_mock.make_bucket.call_count == 1

    def test_applies_policies_on_create(self, resolver, minio_mock):
        boto = resolver._boto
        minio_mock.bucket_exists.return_value = False
        resolver.resolve("t")
        boto.put_bucket_versioning.assert_called_once()
        boto.put_bucket_encryption.assert_called_once()
        boto.put_bucket_lifecycle_configuration.assert_called_once()

    def test_raises_on_minio_error(self, resolver, minio_mock):
        minio_mock.bucket_exists.side_effect = S3Error(
            code="InternalError", message="down", resource="",
            request_id="", host_id="", response=None,
        )
        with pytest.raises(S3Error):
            resolver.resolve("bad")


class TestObjectKeyRouting:
    def test_employee_doc_routes_to_employee_folder(self, resolver):
        folder, key = resolver.object_key(
            doc_type="AADHAAR", blob_id="b1", file_ext=".jpg",
            employee_id="EMP1", year="2026", month="01",
        )
        assert folder == "employees/EMP1/aadhaar"
        assert key == "employees/EMP1/aadhaar/b1.jpg"

    def test_payroll_doc_routes_with_year_month(self, resolver):
        folder, key = resolver.object_key(
            doc_type="PAYSLIP", blob_id="b2", file_ext=".pdf",
            year="2026", month="1",
        )
        assert folder == "payroll/2026/01/payslips"
        assert key.endswith("/b2.pdf")

    def test_compliance_doc_routes(self, resolver):
        folder, _ = resolver.object_key(doc_type="PF_ECR", blob_id="b3", file_ext=".txt")
        assert folder == "compliance/pf"

    def test_audit_doc_routes(self, resolver):
        folder, _ = resolver.object_key(doc_type="AUDIT_EXPORT", blob_id="b4", file_ext=".zip")
        assert folder == "audit/exports"

    def test_org_doc_routes(self, resolver):
        folder, _ = resolver.object_key(doc_type="LOGO", blob_id="b5", file_ext=".png")
        assert folder == "organization/logo"

    def test_unknown_with_employee_falls_back_to_custom(self, resolver):
        folder, _ = resolver.object_key(
            doc_type="WHATEVER", blob_id="b6", file_ext=".bin", employee_id="EMP9"
        )
        assert folder == "employees/EMP9/custom"

    def test_unknown_without_employee_falls_back_to_org_custom(self, resolver):
        folder, _ = resolver.object_key(doc_type="WHATEVER", blob_id="b7", file_ext=".bin")
        assert folder == "organization/custom"


class TestArchive:
    def test_archive_tags_existing_bucket(self):
        minio_mock = MagicMock()
        minio_mock.bucket_exists.return_value = True
        boto = MagicMock()
        resolver = BucketResolver(minio_client=minio_mock, boto_client=boto)
        result = resolver.archive_tenant("gone")
        assert result == "tenant-gone"
        boto.put_bucket_tagging.assert_called_once()

    def test_archive_skips_missing_bucket(self):
        minio_mock = MagicMock()
        minio_mock.bucket_exists.return_value = False
        resolver = BucketResolver(minio_client=minio_mock, boto_client=MagicMock())
        assert resolver.archive_tenant("never") is None
