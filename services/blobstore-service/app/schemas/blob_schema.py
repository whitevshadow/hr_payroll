"""
app/schemas/blob_schema.py

Pydantic V2 schemas for request validation and API response serialisation.

Consumers: reporting-service, payout-service, employee-service
MinIO bucket convention: <tenant_id>-blobs  (falls back to MINIO_BUCKET env)
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ── Upload ─────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    """Returned after a successful single-file upload."""

    blob_id: uuid.UUID = Field(..., examples=["3fa85f64-5717-4562-b3fc-2c963f66afa6"])
    file_name: str = Field(..., examples=["pf_ecr_jan26.pdf"])
    object_key: str = Field(..., examples=["tenant-abc/2026/01/pf_ecr_jan26.pdf"])

    model_config = ConfigDict(from_attributes=True)


# ── Batch Upload ──────────────────────────────────────────────────────────────

class BatchUploadResponse(BaseModel):
    """Returned after a batch upload attempt.

    If any file fails, all successfully uploaded files in the batch are
    rolled back (deleted from MinIO and the database) before this response
    is returned.
    """

    uploads: list[UploadResponse] = Field(
        ...,
        description="Results for each successfully uploaded file.",
        examples=[[
            {"blob_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
             "file_name": "pf_ecr_jan26.pdf",
             "object_key": "tenant-abc/2026/01/pf_ecr_jan26.pdf"},
        ]],
    )
    failed: int = Field(..., ge=0, description="Number of files that failed to upload.", examples=[0])


# ── Metadata ───────────────────────────────────────────────────────────────────

class BlobMetadata(BaseModel):
    """Full metadata record for a stored blob."""

    id: uuid.UUID = Field(..., examples=["3fa85f64-5717-4562-b3fc-2c963f66afa6"])
    tenant_id: uuid.UUID = Field(..., examples=["d290f1ee-6c54-4b01-90e6-d701748f0851"])
    employee_id: Optional[uuid.UUID] = Field(None, examples=["e94d6c4a-8f81-4b11-9a74-d4642ab68412"])

    bucket_name: str = Field(..., examples=["tenant-abc"])
    object_key: str = Field(..., examples=["employees/EMP0001/aadhaar/123.pdf"])
    folder: str = Field(..., examples=["employees/EMP0001/aadhaar"])

    file_name: str = Field(..., examples=["pf_ecr_jan26.pdf"])
    document_type: str = Field(..., examples=["AADHAAR"])
    mime_type: str = Field(..., examples=["application/pdf"])
    size: int = Field(..., ge=0, description="File size in bytes", examples=[204800])

    etag: Optional[str] = Field(None)
    version: Optional[str] = Field(None)
    checksum: Optional[str] = Field(None)

    uploaded_by: uuid.UUID = Field(
        ...,
        description="UUID of the calling **service** (not a user UUID).",
        examples=["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
    )

    tags: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary key/value annotations (e.g. cycle_id, type, month).",
        examples=[{"cycle_id": "cyc_jan26", "type": "pf_ecr", "month": "Jan26"}],
    )

    uploaded_at: datetime
    updated_at: datetime

    is_deleted: bool = Field(False)
    retention_until: Optional[datetime] = Field(None)

    model_config = ConfigDict(from_attributes=True)


# ── Paginated List ─────────────────────────────────────────────────────────────

class PaginatedBlobList(BaseModel):
    """Keyset-paginated envelope for blob metadata listings."""

    items: list[BlobMetadata]
    count: int = Field(..., ge=0, description="Number of records in this page.", examples=[20])
    limit: int = Field(..., ge=1, le=100, examples=[20])
    next_cursor: Optional[str] = Field(
        None,
        description=(
            "Opaque cursor for the next page. Pass it back as `cursor` to "
            "continue; `null` means there are no more records."
        ),
    )


# ── Tags Update ────────────────────────────────────────────────────────────────

class BlobTagsUpdate(BaseModel):
    """
    Request body for PATCH /blobs/{id}/tags.

    Default behaviour is a **shallow merge** — new keys are added and existing
    keys are overwritten at the key level.  Pass `?replace=true` to fully
    replace the existing tags dict.
    """

    tags: dict[str, Any] = Field(
        ...,
        description="Tags to merge into (or replace) the existing tags dict.",
        examples=[{"cycle_id": "cyc_jan26", "type": "pf_ecr", "month": "Jan26"}],
    )


# ── Health ─────────────────────────────────────────────────────────────────────

class LivenessResponse(BaseModel):
    """Kubernetes liveness probe response — always 200 while process is alive."""

    status: str = Field(..., examples=["ok"])


class ReadinessResponse(BaseModel):
    """
    Kubernetes readiness probe response.

    Returns HTTP 200 when all dependencies are healthy.
    Returns HTTP 503 when the database or MinIO is unreachable.
    """

    status: str = Field(..., examples=["healthy"])
    database: str = Field(..., examples=["ok"])
    minio: str = Field(..., examples=["ok"])
    kafka_consumer: str = Field("unknown", examples=["ok"])
    consumer_lag_seconds: int | None = Field(None, examples=[12])
    version: str = Field(..., examples=["1.0.0"])


# Keep HealthResponse as an alias so existing imports don't break
HealthResponse = ReadinessResponse


# ── Presigned URL ──────────────────────────────────────────────────────────────

class PresignedUrlResponse(BaseModel):
    """Contains a time-limited pre-signed download URL."""

    blob_id: uuid.UUID = Field(..., examples=["3fa85f64-5717-4562-b3fc-2c963f66afa6"])
    url: str = Field(..., examples=["https://minio.example.com/tenant-abc-blobs/...?X-Amz-Expires=3600"])
    expires_in_seconds: int = Field(..., examples=[3600])


class PresignedUrlRequest(BaseModel):
    """Request body for POST /blobs/{id}/url — avoids sensitive params in query string."""

    expires_in_seconds: int = Field(
        3600,
        ge=1,
        description="Desired URL lifetime in seconds. Capped by server config.",
        examples=[3600],
    )


# ── Error ──────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    """Structured error detail returned on 4xx / 5xx responses."""

    detail: str = Field(..., examples=["Request failed."])


# ── Registry ──────────────────────────────────────────────────────────────────

class CreateRegistryEntry(BaseModel):
    raw_blob_id: uuid.UUID
    doc_type: str
    employee_id: uuid.UUID | None = None
    payroll_cycle_id: uuid.UUID | None = None
    month: str | None = None


class UpdateRegistryEntry(BaseModel):
    status: str | None = None
    extracted_blob_id: uuid.UUID | None = None
    extraction_confidence: str | None = None
    extraction_error: str | None = None


# ── Employee Document Center Schemas ──────────────────────────────────────────

class EmployeeDocConfirmUpload(BaseModel):
    """Body after frontend completes a direct MinIO presigned POST upload."""
    object_key: str = Field(..., description="Object key used in the presigned POST")
    file_name: str
    mime_type: str
    file_size: int = Field(..., ge=1)
    doc_category: str
    doc_label: str
    description: Optional[str] = None
    tags: dict[str, Any] = Field(default_factory=dict)

    @field_validator("doc_category", mode="before")
    @classmethod
    def normalise_category(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("doc_label", mode="before")
    @classmethod
    def normalise_label(cls, v: str) -> str:
        return v.strip().upper()


class EmployeeDocVerifyAction(BaseModel):
    """Body for POST /employee-docs/{employee_id}/{blob_id}/verify"""
    comment: Optional[str] = None


class EmployeeDocRejectAction(BaseModel):
    """Body for POST /employee-docs/{employee_id}/{blob_id}/reject"""
    reason: str = Field(..., min_length=1)


class EmployeeDocItem(BaseModel):
    """A single document in the employee document list."""
    id: uuid.UUID
    file_name: str
    doc_category: Optional[str] = None
    doc_label: Optional[str] = None
    description: Optional[str] = None
    mime_type: str
    size: int
    version: Optional[str] = None
    checksum: Optional[str] = None
    uploaded_by: uuid.UUID
    uploaded_at: datetime
    verification_status: Optional[str] = None
    verified_by: Optional[uuid.UUID] = None
    verified_at: Optional[datetime] = None
    verification_comment: Optional[str] = None
    tags: dict[str, Any] = Field(default_factory=dict)
    is_deleted: bool = False

    model_config = ConfigDict(from_attributes=True)


class EmployeeDocCategoryGroup(BaseModel):
    """Documents grouped by category."""
    category: str
    label: str
    documents: list[EmployeeDocItem]
    count: int


class EmployeeDocListResponse(BaseModel):
    """Grouped document list for an employee."""
    employee_id: uuid.UUID
    categories: list[EmployeeDocCategoryGroup]
    total: int


class EmployeeDocStats(BaseModel):
    """KPI stats for the document center dashboard."""
    total: int
    pending: int
    verified: int
    rejected: int
    storage_bytes: int


class MissingDocItem(BaseModel):
    doc_label: str
    doc_category: str
    required: bool
    present: bool
    blob_id: Optional[uuid.UUID] = None
    verification_status: Optional[str] = None


class MissingDocsResponse(BaseModel):
    employee_id: uuid.UUID
    items: list[MissingDocItem]
    completion_pct: float
    is_activation_ready: bool


class PresignedUploadRequest(BaseModel):
    """Body for POST /employee-docs/{employee_id}/presigned-upload."""
    doc_category: str
    doc_label: str
    file_name: str
    expires_in: int = Field(300, ge=60, le=3600)

    @field_validator("doc_category", mode="before")
    @classmethod
    def normalise_category(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("doc_label", mode="before")
    @classmethod
    def normalise_label(cls, v: str) -> str:
        return v.strip().upper()
