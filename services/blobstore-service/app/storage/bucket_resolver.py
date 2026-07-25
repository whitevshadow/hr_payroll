"""
bucket_resolver.py

Single source of truth for bucket naming and doc_type → folder routing.

Naming convention: tenant-{tenant_id}

Auto-creates the bucket in MinIO if it doesn't exist yet, enabling versioning
and proper tenant isolation.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)


class BucketResolver:
    """Resolves and auto-creates MinIO buckets."""

    def __init__(self, minio_client: Minio, boto_client: Any | None = None):
        self._minio = minio_client
        self._boto = boto_client
        self._created: set[str] = set()

    def resolve(self, tenant_id: str) -> str:
        """Return the bucket name for a tenant. Auto-creates if missing."""
        bucket_name = f"tenant-{tenant_id}"
        self._ensure_exists(bucket_name)
        return bucket_name

    def provision_tenant(self, tenant_id: str) -> list[str]:
        """Explicitly provision a tenant bucket (called by events)."""
        bucket_name = f"tenant-{tenant_id}"
        self._ensure_exists(bucket_name)
        logger.info("Provisioned bucket %s for tenant %s", bucket_name, tenant_id)
        return [bucket_name]

    def archive_tenant(self, tenant_id: str) -> str | None:
        """
        Archive a deleted organization's bucket instead of removing it.

        The bucket is tagged ``status=archived`` (with a deletion timestamp) and
        retained for compliance — never deleted here. A separate, deliberate
        compliance job is responsible for eventual cleanup after the statutory
        retention window (default 7 years).
        """
        from datetime import datetime, timezone

        bucket_name = f"tenant-{tenant_id}"
        if not self._boto:
            return None
        try:
            if not self._minio.bucket_exists(bucket_name):
                logger.info("Archive requested for missing bucket %s — skipping", bucket_name)
                return None
            self._boto.put_bucket_tagging(
                Bucket=bucket_name,
                Tagging={
                    "TagSet": [
                        {"Key": "status", "Value": "archived"},
                        {
                            "Key": "archived_at",
                            "Value": datetime.now(timezone.utc).isoformat(),
                        },
                    ]
                },
            )
            logger.info("Archived bucket %s for deleted tenant %s", bucket_name, tenant_id)
            return bucket_name
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to archive bucket %s: %s", bucket_name, exc)
            return None

    def object_key(
        self,
        doc_type: str,
        blob_id: str,
        file_ext: str,
        employee_id: str | None = None,
        year: str = "2026",
        month: str = "01",
    ) -> tuple[str, str]:
        """
        Return (folder, full_object_key) based on document type.
        """
        normalized_doc_type = (doc_type or "CUSTOM").strip().upper()

        employee_docs = {
            "AADHAAR": "aadhaar",
            "PAN": "pan",
            "BANK_PROOF": "bank",
            "PHOTO": "photo",
            "OFFER_LETTER": "offer_letter",
            "SALARY_REVISION": "salary_docs",
            "PF_DOCUMENT": "compliance_docs",
            "ESI_DOCUMENT": "compliance_docs",
            "CONTRACT": "contracts"
        }

        payroll_docs = {
            "PAYSLIP": "payslips",
            "PAYROLL_REGISTER": "reports",
            "SALARY_REPORT": "reports",
            "PAYROLL_EXPORT": "exports"
        }

        compliance_docs = {
            "PF_ECR": "pf",
            "ESI_REPORT": "esi",
            "PT_RETURN": "pt",
            "TDS_FILE": "tds",
            "FORM16": "tds",
            "FORM24Q": "tds",
            "GOVT_EXPORT": "exports"
        }

        audit_docs = {
            "AUDIT_EXPORT": "exports",
            "LEGAL_REPORT": "investigations",
            "INVESTIGATION": "investigations",
            "IMMUTABLE_ARCHIVE": "snapshots"
        }

        org_docs = {
            "LOGO": "logo",
            "BRANDING": "branding",
            "POLICY": "policies",
            "HOLIDAY_CALENDAR": "holiday_calendars",
            "TAX_CONFIG": "tax_configuration",
            "COMPLIANCE_CONFIG": "compliance_configuration"
        }

        if normalized_doc_type in employee_docs and employee_id:
            subfolder = employee_docs[normalized_doc_type]
            folder = f"employees/{employee_id}/{subfolder}"
        elif normalized_doc_type in payroll_docs:
            subfolder = payroll_docs[normalized_doc_type]
            month_pad = month.zfill(2) if month.isdigit() else month
            folder = f"payroll/{year}/{month_pad}/{subfolder}"
        elif normalized_doc_type in compliance_docs:
            subfolder = compliance_docs[normalized_doc_type]
            folder = f"compliance/{subfolder}"
        elif normalized_doc_type in audit_docs:
            subfolder = audit_docs[normalized_doc_type]
            folder = f"audit/{subfolder}"
        elif normalized_doc_type in org_docs:
            subfolder = org_docs[normalized_doc_type]
            folder = f"organization/{subfolder}"
        else:
            if employee_id:
                folder = f"employees/{employee_id}/custom"
            else:
                folder = "organization/custom"

        key = f"{folder}/{blob_id}{file_ext}"
        return folder, key

    def _ensure_exists(self, bucket_name: str) -> None:
        if bucket_name in self._created:
            return
        try:
            if not self._minio.bucket_exists(bucket_name):
                self._minio.make_bucket(bucket_name)
                logger.info("Created MinIO bucket: %s", bucket_name)
                self._apply_bucket_policies(bucket_name)

            self._created.add(bucket_name)
        except S3Error as exc:
            logger.error("Failed to ensure bucket %s: %s", bucket_name, exc)
            raise

    def _apply_bucket_policies(self, bucket_name: str) -> None:
        """
        Apply the standard tenant-bucket policies (best-effort).

        - Versioning: track revisions and protect against accidental overwrite/delete.
        - SSE-S3 (AES-256): encrypt objects at rest.
        - Lifecycle: expire non-current versions after the retention window and
          abort stale multipart uploads.

        Each step is independent and failure-tolerant so an older MinIO that
        lacks one feature does not block bucket creation.
        """
        if not self._boto:
            return

        from app.config import get_settings
        retention_days = get_settings().SOFT_DELETE_RETENTION_DAYS

        try:
            self._boto.put_bucket_versioning(
                Bucket=bucket_name,
                VersioningConfiguration={"Status": "Enabled"},
            )
            logger.info("Enabled versioning on %s", bucket_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to enable versioning on %s: %s", bucket_name, exc)

        try:
            self._boto.put_bucket_encryption(
                Bucket=bucket_name,
                ServerSideEncryptionConfiguration={
                    "Rules": [
                        {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
                    ]
                },
            )
            logger.info("Enabled SSE-S3 (AES-256) on %s", bucket_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to enable encryption on %s: %s", bucket_name, exc)

        try:
            self._boto.put_bucket_lifecycle_configuration(
                Bucket=bucket_name,
                LifecycleConfiguration={
                    "Rules": [
                        {
                            "ID": "expire-noncurrent-versions",
                            "Status": "Enabled",
                            "Filter": {"Prefix": ""},
                            "NoncurrentVersionExpiration": {
                                "NoncurrentDays": retention_days
                            },
                            "AbortIncompleteMultipartUpload": {
                                "DaysAfterInitiation": 7
                            },
                        }
                    ]
                },
            )
            logger.info("Applied lifecycle rules on %s", bucket_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to apply lifecycle on %s: %s", bucket_name, exc)
