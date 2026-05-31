"""
app/interfaces/blob_store_interface.py

Abstract storage provider interface.

Implementing this contract means the caller layer (service, router) is
completely decoupled from the underlying object storage backend.  To switch
from MinIO to AWS S3, implement S3BlobStore(BlobStoreInterface) and swap
the singleton in minio_client.py — nothing else changes.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator


class BlobStoreInterface(ABC):

    @abstractmethod
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
        """Upload a file and return metadata dict with bucket, key, content_type."""
        ...

    @abstractmethod
    async def download_file(self, bucket: str, object_name: str):
        """Return a streaming response object for the given object."""
        ...

    @abstractmethod
    async def file_exists(self, bucket: str, object_name: str) -> bool:
        """Return True if the object exists in the bucket, False otherwise."""
        ...

    @abstractmethod
    async def generate_presigned_post(
        self,
        bucket: str,
        object_name: str,
        expires_in: int,
        tags: dict | None = None,
    ) -> dict:
        """
        Generate a presigned POST URL for direct client-to-storage uploads.

        Returns
        -------
        dict
            ``{ "url": str, "fields": dict }`` — pass both to the HTML form.
        """
        ...

    @abstractmethod
    async def generate_presigned_get(
        self, bucket: str, object_name: str, expires_in: int
    ) -> str:
        """Generate a presigned GET URL for time-limited direct downloads."""
        ...

    @abstractmethod
    async def delete_object(self, bucket: str, object_name: str) -> None:
        """Permanently remove an object from storage."""
        ...

    @abstractmethod
    async def set_bucket_cors(
        self,
        bucket: str,
        allowed_origins: list[str],
        allowed_methods: list[str],
    ) -> None:
        """Apply a CORS configuration to the bucket."""
        ...

    @abstractmethod
    async def list_buckets(self) -> list[str]:
        """Return the names of all buckets visible to the current credentials."""
        ...

    @abstractmethod
    async def create_bucket(self, bucket: str) -> None:
        """Create bucket if it does not exist; no-op if it already exists."""
        ...

    @abstractmethod
    async def blob_event_stream(self) -> AsyncGenerator[dict, None]:
        """Async generator that yields storage events (upload/delete/etc.)."""
        ...
