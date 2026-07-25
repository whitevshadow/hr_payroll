"""
app/api/bucket_router.py

Bucket management endpoints — backed by boto3's S3-compatible API against MinIO.

Provides:
  GET   /bucket-config/buckets/list             — list all visible buckets
  POST  /bucket-config/buckets/create           — create a named bucket
  POST  /bucket-config/auto-configure/{bucket}  — create + apply default CORS
  POST  /bucket-config/cors/{bucket}            — set custom CORS rules
  GET   /bucket-config/status/{bucket}          — CORS config + existence status
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import require_admin
from app.schemas.blob_schema import ErrorResponse
from app.storage.minio_client import _boto_client, blob_store

logger = logging.getLogger(__name__)

# Bucket management is an administrative / infrastructure surface: every route
# requires a verified token carrying one of the blob-admin roles.
router = APIRouter(
    prefix="/bucket-config",
    tags=["Bucket Config"],
    dependencies=[Depends(require_admin)],
)


# ── Request schemas ────────────────────────────────────────────────────────────

class CORSConfig(BaseModel):
    """CORS rules to apply to a bucket."""

    allowed_origins: list[str] = ["*"]
    allowed_methods: list[str] = ["GET", "POST", "PUT", "DELETE"]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get(
    "/buckets/list",
    summary="List all buckets",
    description="Return the names of all MinIO buckets visible to the configured credentials.",
)
async def list_buckets():
    buckets = await blob_store.list_buckets()
    return {"buckets": buckets, "count": len(buckets)}


@router.post(
    "/buckets/create",
    status_code=status.HTTP_201_CREATED,
    summary="Create a bucket",
    description="Create a new MinIO bucket. No-op if the bucket already exists.",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid bucket name"},
    },
)
async def create_bucket(bucket_name: str):
    try:
        await blob_store.create_bucket(bucket_name)
    except Exception as exc:
        logger.error("Bucket creation failed for '%s': %s", bucket_name, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create bucket '{bucket_name}': {exc}",
        ) from exc
    return {"success": True, "bucket": bucket_name}


@router.post(
    "/cors/{bucket_name}",
    summary="Set bucket CORS",
    description=(
        "Apply CORS rules to a MinIO bucket.\n\n"
        "Uses boto3's `put_bucket_cors` via the S3-compatible MinIO API."
    ),
    responses={
        404: {"model": ErrorResponse, "description": "Bucket not found"},
    },
)
async def set_cors(bucket_name: str, config: CORSConfig):
    try:
        await blob_store.set_bucket_cors(
            bucket_name, config.allowed_origins, config.allowed_methods
        )
    except Exception as exc:
        logger.error("CORS config failed for '%s': %s", bucket_name, exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bucket '{bucket_name}' not found or CORS update failed: {exc}",
        ) from exc
    return {"success": True, "bucket": bucket_name}


@router.get(
    "/status/{bucket_name}",
    summary="Get bucket CORS status",
    description="Return the current CORS configuration for a bucket, or indicate that no CORS is configured.",
)
async def bucket_status(bucket_name: str):
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        cors = await loop.run_in_executor(
            None, lambda: _boto_client.get_bucket_cors(Bucket=bucket_name)
        )
        return {
            "bucket": bucket_name,
            "cors_configured": True,
            "cors": cors.get("CORSRules", []),
        }
    except Exception:
        return {"bucket": bucket_name, "cors_configured": False}


@router.post(
    "/auto-configure/{bucket_name}",
    summary="Auto-configure bucket",
    description=(
        "Create the bucket if it does not exist, then apply a permissive default CORS "
        "configuration (`AllowedOrigins: [*]`, all HTTP methods). "
        "Idempotent — safe to call on existing buckets."
    ),
)
async def auto_configure(bucket_name: str):
    await blob_store.create_bucket(bucket_name)
    await blob_store.set_bucket_cors(
        bucket_name,
        allowed_origins=["*"],
        allowed_methods=["GET", "POST", "PUT", "DELETE"],
    )
    logger.info("Auto-configured bucket '%s'.", bucket_name)
    return {
        "success": True,
        "message": f"Bucket '{bucket_name}' is ready with default CORS.",
    }


@router.post(
    "/provision-tenant/{tenant_id}",
    summary="Provision tenant buckets",
    description="Pre-create all routed buckets for a tenant during onboarding.",
)
async def provision_tenant(tenant_id: str):
    created = blob_store._resolver.provision_tenant(tenant_id)
    return {
        "success": True,
        "tenant_id": tenant_id,
        "buckets_created": created,
    }
