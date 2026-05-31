"""
app/storage/minio_client.py

MinIO storage layer — implements BlobStoreInterface.

Two clients run side by side:
  _minio  – official MinIO Python SDK (streaming upload/download, stat, delete)
  _boto   – boto3 S3-compatible client (presigned POST, CORS, bucket management)

Import the ``blob_store`` singleton everywhere; module-level helper functions
are preserved for backward compatibility with existing service/router code.
"""

import asyncio
import io
import logging
import time
import uuid
from collections.abc import AsyncGenerator, Iterator
from datetime import datetime, timezone

import boto3
from botocore.config import Config
from minio import Minio
from minio.error import S3Error

from app.config import get_settings
from app.interfaces.blob_store_interface import BlobStoreInterface
from app.storage.bucket_resolver import BucketResolver

logger = logging.getLogger(__name__)
settings = get_settings()


def _sanitize_object_name(object_name: str) -> str:
    """Normalize client-provided object keys and reject unsafe values."""
    normalized = (object_name or "").replace("\\", "/").strip()
    normalized = normalized.lstrip("/")
    while "//" in normalized:
        normalized = normalized.replace("//", "/")

    if not normalized:
        raise ValueError("Object name cannot be empty")

    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("Object name contains invalid path segments")

    return normalized


# ── Client factories ───────────────────────────────────────────────────────────

def _build_minio_client() -> Minio:
    """Construct a native Minio SDK client from settings."""
    return Minio(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )



def _build_boto_client(endpoint_override: str | None = None):
    """
    Construct a boto3 S3-compatible client pointed at MinIO.

    boto3 is used for operations the Minio SDK does not expose:
    presigned POST URLs and CORS management.

    *endpoint_override* allows constructing a second client that generates
    presigned URLs referencing the public (browser-accessible) hostname
    instead of the internal Docker container hostname.
    """
    # Derive the endpoint URL from the existing MINIO_ENDPOINT setting.
    # MINIO_ENDPOINT is "host:port" (no scheme), so we prepend http:// here.
    scheme = "https" if settings.MINIO_SECURE else "http"
    endpoint = endpoint_override or settings.MINIO_ENDPOINT
    endpoint_url = f"{scheme}://{endpoint}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",  # MinIO accepts any region value
    )


# Module-level singletons — populated by init_minio()
_minio_client: Minio = _build_minio_client()
# Internal boto3 client for bucket operations (uses Docker network hostname)
_boto_client = _build_boto_client()
# Public boto3 client for presigned URL generation (uses browser-accessible hostname)
_boto_public_client = _build_boto_client(settings.MINIO_PUBLIC_ENDPOINT)
_bucket_resolver = BucketResolver(_minio_client, _boto_client)


# ── Initialisation ─────────────────────────────────────────────────────────────

# Known-bad credential values that must never reach a running service.
# Expanded when new default-credential incidents are discovered.
_FORBIDDEN_CREDENTIALS = frozenset({"minioadmin", "minioadmin123", "", "admin", "password"})


def _assert_service_credentials() -> None:
    """Fail fast if root or default credentials were injected into the service.

    The blobstore-service must run with a least-privilege IAM account, never
    with MinIO root credentials. This guard fires before any network I/O so
    a misconfigured deployment is caught at startup, not at runtime.
    """
    key = settings.MINIO_ACCESS_KEY
    secret = settings.MINIO_SECRET_KEY

    if not key or not secret:
        raise RuntimeError(
            "MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set. "
            "Run scripts/init-minio.sh to provision a service account, "
            "then set the credentials in .env."
        )
    if key in _FORBIDDEN_CREDENTIALS or secret in _FORBIDDEN_CREDENTIALS:
        raise RuntimeError(
            f"Forbidden MinIO credential detected (key={key!r}). "
            "The blobstore-service must use a least-privilege IAM account, "
            "not the MinIO root credentials. "
            "See scripts/init-minio.sh and .env.example."
        )
    if len(secret) < 8:
        raise RuntimeError(
            "MINIO_SERVICE_SECRET_KEY must be at least 8 characters "
            "(MinIO minimum). Generate one with: "
            "python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )


def init_minio() -> None:
    """
    Called at application startup.
    1. Asserts that service (non-root) credentials are configured.
    2. Retries connection to MinIO with exponential back-off.
    3. Creates the default bucket if it does not exist.
    4. Applies CORS so browsers can POST directly to MinIO.
    """
    global _minio_client, _boto_client, _boto_public_client, _bucket_resolver  # noqa: PLW0603

    _assert_service_credentials()

    max_retries = settings.MINIO_MAX_RETRIES
    delay = settings.MINIO_RETRY_DELAY_SECONDS

    for attempt in range(1, max_retries + 1):
        try:
            client = _build_minio_client()
            client.list_buckets()          # lightweight connectivity probe
            _minio_client = client
            _boto_client = _build_boto_client()
            _boto_public_client = _build_boto_client(settings.MINIO_PUBLIC_ENDPOINT)
            _bucket_resolver = BucketResolver(_minio_client, _boto_client)
            logger.info("MinIO connection established on attempt %d.", attempt)
            # Apply CORS so browsers can POST presigned uploads directly to MinIO.
            _apply_minio_cors()
            return
        except Exception as exc:
            logger.warning(
                "MinIO connection attempt %d/%d failed: %s", attempt, max_retries, exc
            )
            if attempt < max_retries:
                sleep_time = delay * (2 ** (attempt - 1))
                logger.info("Retrying MinIO connection in %.1f seconds…", sleep_time)
                time.sleep(sleep_time)

    raise RuntimeError(
        f"Unable to connect to MinIO at {settings.MINIO_ENDPOINT} "
        f"after {max_retries} attempts."
    )


def get_minio_client() -> Minio:
    """Return the module-level MinIO SDK client."""
    return _minio_client


def get_bucket_resolver() -> BucketResolver:
    """Return the module-level bucket resolver."""
    return _bucket_resolver


def _apply_minio_cors() -> None:
    """Apply permissive CORS on the default bucket (and any existing buckets).

    This is required so browsers can POST directly to MinIO via presigned POST URLs.
    Called once at startup after MinIO connection is confirmed.
    """
    cors_config = {
        "CORSRules": [
            {
                "AllowedOrigins": ["*"],
                "AllowedMethods": ["GET", "POST", "PUT", "DELETE", "HEAD"],
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag", "x-amz-version-id"],
                "MaxAgeSeconds": 3600,
            }
        ]
    }
    try:
        buckets = _boto_client.list_buckets().get("Buckets", [])
        for b in buckets:
            try:
                _boto_client.put_bucket_cors(
                    Bucket=b["Name"],
                    CORSConfiguration=cors_config,
                )
                logger.info("CORS applied to bucket '%s'", b["Name"])
            except Exception as exc:  # noqa: BLE001
                logger.warning("CORS apply failed for bucket '%s': %s", b["Name"], exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not enumerate buckets for CORS setup: %s", exc)


def _ensure_bucket(client: Minio, bucket_name: str) -> None:
    """Create *bucket_name* if it does not already exist."""
    if not client.bucket_exists(bucket_name):
        client.make_bucket(bucket_name)
        logger.info("Bucket '%s' created.", bucket_name)
    else:
        logger.debug("Bucket '%s' already exists.", bucket_name)


# ── MinIOBlobStore — concrete implementation of BlobStoreInterface ──────────────

class MinIOBlobStore(BlobStoreInterface):
    """
    Wraps both the Minio SDK and boto3 S3-compatible client.

    All I/O-bound blocking calls are dispatched to the default thread pool
    via ``asyncio.get_event_loop().run_in_executor`` so they never block
    the event loop.
    """

    def __init__(self) -> None:
        self._resolver = get_bucket_resolver()

    # ── Upload ──────────────────────────────────────────────────────────────────

    async def upload_file(
        self,
        file,
        object_name: str,
        content_type: str,
        tenant_id: str,
        doc_type: str = "raw",
        blob_id: str | None = None,
        employee_id: str | None = None,
        tags: dict | None = None,
    ) -> dict:
        tags = dict(tags or {})
        tags["doc_type"] = doc_type
        tags["tenant_id"] = tenant_id

        bucket = self._resolver.resolve(tenant_id)
        safe_object_name = _sanitize_object_name(object_name)
        has_path_prefix = "/" in safe_object_name

        if has_path_prefix:
            key = safe_object_name
            folder = key.rsplit("/", 1)[0] if "/" in key else ""
        else:
            now = datetime.now(timezone.utc)
            ext = _ext_from_content_type(content_type)
            folder, key = self._resolver.object_key(
                doc_type=doc_type,
                blob_id=blob_id or safe_object_name,
                file_ext=ext,
                employee_id=employee_id,
                year=str(now.year),
                month=now.strftime("%m"),
            )

        def _put():
            _minio_client.put_object(
                bucket_name=bucket,
                object_name=key,
                data=file.file,
                length=-1,
                part_size=10 * 1024 * 1024,
                content_type=content_type,
            )

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _put)
        logger.info("Uploaded '%s' to bucket '%s'.", key, bucket)
        return {
            "bucket": bucket,
            "key": key,
            "folder": folder,
            "content_type": content_type,
            "doc_type": doc_type,
            "tenant_id": tenant_id,
        }

    # ── Download ────────────────────────────────────────────────────────────────

    async def download_file(self, bucket: str, object_name: str):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, lambda: _minio_client.get_object(bucket, object_name)
        )

    # ── Exists ──────────────────────────────────────────────────────────────────

    async def file_exists(self, bucket: str, object_name: str) -> bool:
        """
        Return True if the object exists.
        Uses stat_object() — a HEAD request, no data transferred.
        """
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, lambda: _minio_client.stat_object(bucket, object_name)
            )
            return True
        except S3Error as exc:
            if exc.code in ("NoSuchKey", "NoSuchObject"):
                return False
            raise

    # ── Presigned POST ──────────────────────────────────────────────────────────

    async def generate_presigned_post(
        self,
        bucket: str,
        object_name: str,
        expires_in: int,
        tags: dict | None = None,
    ) -> dict:
        """
        Generate a presigned POST policy for direct browser → MinIO uploads.

        The returned ``{ url, fields }`` dict is passed directly to an HTML form
        or fetch()  — the file bytes never go through FastAPI.

        The URL is generated using the **public** boto3 client so it references
        the browser-accessible endpoint (e.g. localhost:9000) rather than the
        internal Docker container hostname (minio:9000).

        Note: S3 Tagging is intentionally excluded from the presigned POST
        policy. MinIO's presigned POST implementation rejects requests that
        include a ``tagging`` field in the multipart body (returns 400
        MalformedPOSTRequest). All document metadata (category, label,
        employee_id, tenant_id) is stored durably in PostgreSQL via the
        ``confirm-upload`` endpoint instead.
        """
        capped = min(expires_in, settings.PRESIGNED_URL_MAX_EXPIRY_SECONDS)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: _boto_public_client.generate_presigned_post(
                Bucket=bucket,
                Key=object_name,
                Fields=None,
                Conditions=None,
                ExpiresIn=capped,
            ),
        )
        return result  # {"url": str, "fields": dict}

    # ── Presigned GET ───────────────────────────────────────────────────────────

    async def generate_presigned_get(
        self, bucket: str, object_name: str, expires_in: int
    ) -> str:
        capped = min(expires_in, settings.PRESIGNED_URL_MAX_EXPIRY_SECONDS)
        loop = asyncio.get_event_loop()
        # Use the public client so the URL is browser-accessible.
        return await loop.run_in_executor(
            None,
            lambda: _boto_public_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": object_name},
                ExpiresIn=capped,
            ),
        )

    # ── Delete ──────────────────────────────────────────────────────────────────

    async def delete_object(self, bucket: str, object_name: str) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None, lambda: _minio_client.remove_object(bucket, object_name)
        )
        logger.info("Deleted '%s' from bucket '%s'.", object_name, bucket)

    # ── CORS ────────────────────────────────────────────────────────────────────

    async def set_bucket_cors(
        self,
        bucket: str,
        allowed_origins: list[str],
        allowed_methods: list[str],
    ) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: _boto_client.put_bucket_cors(
                Bucket=bucket,
                CORSConfiguration={
                    "CORSRules": [
                        {
                            "AllowedOrigins": allowed_origins,
                            "AllowedMethods": allowed_methods,
                            "AllowedHeaders": ["*"],
                            "MaxAgeSeconds": 3600,
                        }
                    ]
                },
            ),
        )
        logger.info("CORS configured on bucket '%s'.", bucket)

    # ── Bucket management ───────────────────────────────────────────────────────

    async def list_buckets(self) -> list[str]:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(None, _boto_client.list_buckets)
        return [b["Name"] for b in resp.get("Buckets", [])]

    async def create_bucket(self, bucket: str) -> None:
        def _create():
            if not _minio_client.bucket_exists(bucket):
                _minio_client.make_bucket(bucket)
                logger.info("Bucket '%s' created.", bucket)
            else:
                logger.debug("Bucket '%s' already exists — skipping create.", bucket)

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _create)

    # ── Event stream (delegated to Kafka consumer) ──────────────────────────────

    async def blob_event_stream(self) -> AsyncGenerator[dict, None]:
        """Yields events from the Kafka-backed in-memory deque."""
        import asyncio as _asyncio

        from app.events.event_consumer import event_queue

        seen = 0
        while True:
            current = list(event_queue)
            new_count = len(current) - seen
            if new_count > 0:
                for event in reversed(current[:new_count]):
                    yield event
                seen = len(current)
            await _asyncio.sleep(0.5)


# ── Singleton (import everywhere) ──────────────────────────────────────────────

blob_store: BlobStoreInterface = MinIOBlobStore()


# ── Legacy module-level helpers (keep for existing service/router imports) ──────

def upload_object(
    data: bytes,
    content_type: str,
    original_filename: str,
    bucket_name: str | None = None,
    tenant_id: str | None = None,
    doc_type: str = "raw",
    blob_id: str | None = None,
    employee_id: str | None = None,
) -> tuple[str, str, str, str | None, str | None]:
    """Upload bytes to MinIO.

    Returns ``(object_name, bucket, folder, etag, version_id)``. ``etag`` and
    ``version_id`` come from the MinIO write result (``version_id`` is populated
    only on versioning-enabled buckets).
    """
    effective_blob_id = blob_id or str(uuid.uuid4())

    safe_original_filename = _sanitize_object_name(original_filename or "unknown")
    has_path_prefix = "/" in safe_original_filename

    folder = ""
    if tenant_id:
        resolver = get_bucket_resolver()
        bucket = bucket_name or resolver.resolve(tenant_id)
        if has_path_prefix:
            object_name = safe_original_filename
            folder = object_name.rsplit("/", 1)[0]
        else:
            ext = _ext_from_content_type(content_type)
            now = datetime.now(timezone.utc)
            folder, object_name = resolver.object_key(
                doc_type=doc_type,
                blob_id=effective_blob_id,
                file_ext=ext,
                employee_id=employee_id,
                year=str(now.year),
                month=now.strftime("%m"),
            )
    else:
        bucket = bucket_name or settings.MINIO_BUCKET
        _ensure_bucket(_minio_client, bucket)
        if has_path_prefix:
            object_name = safe_original_filename
            folder = object_name.rsplit("/", 1)[0] if "/" in object_name else ""
        else:
            ext = _ext_from_content_type(content_type)
            now = datetime.now(timezone.utc)
            folder = f"custom/{now.year}/{now.strftime('%m')}"
            object_name = f"{folder}/{effective_blob_id}{ext}"

    result = _minio_client.put_object(
        bucket_name=bucket,
        object_name=object_name,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    logger.info("Uploaded '%s' (%d bytes) to bucket '%s'.", object_name, len(data), bucket)
    etag = getattr(result, "etag", None)
    version_id = getattr(result, "version_id", None)
    return object_name, bucket, folder, etag, version_id


def download_object_stream(
    object_name: str,
    bucket_name: str | None = None,
) -> Iterator[bytes]:
    """Legacy sync streaming helper."""
    bucket = bucket_name or settings.MINIO_BUCKET
    response = None
    try:
        response = _minio_client.get_object(bucket, object_name)
        yield from response
    except S3Error as exc:
        logger.error("Failed to download '%s' from '%s': %s", object_name, bucket, exc)
        raise
    finally:
        if response:
            response.close()
            response.release_conn()


def delete_object(object_name: str, bucket_name: str | None = None) -> None:
    """Legacy sync delete helper."""
    bucket = bucket_name or settings.MINIO_BUCKET
    _minio_client.remove_object(bucket, object_name)
    logger.info("Deleted '%s' from bucket '%s'.", object_name, bucket)


def list_object_versions(bucket_name: str, object_name: str) -> list[dict]:
    """Return the version history for a single object (newest first).

    Uses the S3-compatible ``list_object_versions`` API. Returns an empty list
    on a non-versioned bucket or when the object has no recorded versions.
    """
    resp = _boto_client.list_object_versions(Bucket=bucket_name, Prefix=object_name)
    versions = [
        {
            "version_id": v.get("VersionId"),
            "is_latest": v.get("IsLatest", False),
            "last_modified": v["LastModified"].isoformat() if v.get("LastModified") else None,
            "size": v.get("Size"),
            "etag": (v.get("ETag") or "").strip('"') or None,
        }
        for v in resp.get("Versions", [])
        if v.get("Key") == object_name
    ]
    return versions


def generate_presigned_url(
    object_name: str,
    bucket_name: str | None = None,
    expiry_seconds: int | None = None,
) -> str:
    """Legacy sync presigned GET URL helper.

    Uses the *public* boto3 client so the returned URL references the
    browser-accessible endpoint (MINIO_PUBLIC_ENDPOINT, e.g. localhost:9000)
    rather than the internal Docker container hostname (minio:9000).
    """
    bucket = bucket_name or settings.MINIO_BUCKET
    expiry = min(
        expiry_seconds or settings.PRESIGNED_URL_EXPIRY_SECONDS,
        settings.PRESIGNED_URL_MAX_EXPIRY_SECONDS,
    )
    url = _boto_public_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": object_name},
        ExpiresIn=expiry,
    )
    logger.debug("Generated presigned URL for '%s' (expires %ds).", object_name, expiry)
    return url


def _ext_from_content_type(ct: str) -> str:
    if not ct:
        return ".bin"
    key = ct.lower().split(";")[0].strip()
    return {
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/tiff": ".tiff",
        "application/json": ".json",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    }.get(key, ".bin")
