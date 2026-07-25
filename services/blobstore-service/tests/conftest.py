from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator
from unittest.mock import MagicMock

# Configure the environment BEFORE importing the app so module-level settings
# (rate-limit middleware wiring, JWT secret) are read with test values.
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("VIRUS_SCAN_ENABLED", "false")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from hr_shared.auth import create_access_token

from app.config import get_settings
from app.database.base import Base
from app.database.db import get_db
from app.main import app as fastapi_app

# Register all models with Base.metadata (these rebind the bare name ``app`` to
# the package, which is why the FastAPI instance is aliased as fastapi_app).
import app.models.blob_model  # noqa: F401,E402
import app.models.document_registry  # noqa: F401,E402
import app.models.outbox  # noqa: F401,E402

TENANT_ID = str(uuid.uuid4())
OTHER_TENANT_ID = str(uuid.uuid4())
USER_ID = str(uuid.uuid4())
EMPLOYEE_ID = str(uuid.uuid4())

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://hr:hr@localhost:5432/blobstore_test",
)

_test_engine = create_async_engine(TEST_DATABASE_URL, echo=False, poolclass=NullPool)
_TestSession = async_sessionmaker(bind=_test_engine, class_=AsyncSession, expire_on_commit=False)


def _token(tenant_id: str = TENANT_ID, roles: list[str] | None = None) -> str:
    settings = get_settings()
    return create_access_token(
        user_id=USER_ID,
        tenant_id=tenant_id,
        roles=roles if roles is not None else ["ORG_ADMIN"],
        secret=settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def auth_headers(tenant_id: str = TENANT_ID, roles: list[str] | None = None) -> dict:
    return {"Authorization": f"Bearer {_token(tenant_id, roles)}"}


@pytest_asyncio.fixture(scope="session")
async def setup_database():
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await _test_engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def clean_db(setup_database):
    async with _test_engine.begin() as conn:
        await conn.execute(text("DELETE FROM document_registry"))
        await conn.execute(text("DELETE FROM blob_outbox"))
        await conn.execute(text("DELETE FROM blobs"))
    yield


@pytest_asyncio.fixture
async def db_session(setup_database) -> AsyncGenerator[AsyncSession, None]:
    async with _TestSession() as session:
        yield session


@pytest.fixture
def mock_minio(monkeypatch):
    """Patch the MinIO + boto clients and the resolver used by the app."""
    from app.storage.bucket_resolver import BucketResolver
    from app.storage.minio_client import blob_store

    minio_mock = MagicMock()
    minio_mock.bucket_exists.return_value = True
    minio_mock.make_bucket.return_value = None
    minio_mock.put_object.return_value = MagicMock(etag="test-etag", version_id="v1")
    minio_mock.get_object.return_value = iter([b"fake-bytes"])
    minio_mock.remove_object.return_value = None
    minio_mock.stat_object.return_value = MagicMock(size=10)
    minio_mock.list_buckets.return_value = []

    boto_mock = MagicMock()
    boto_mock.generate_presigned_post.return_value = {"url": "http://minio/", "fields": {}}
    boto_mock.generate_presigned_url.return_value = "http://minio/signed"
    boto_mock.list_buckets.return_value = {"Buckets": []}
    boto_mock.list_object_versions.return_value = {"Versions": []}

    resolver = BucketResolver(minio_client=minio_mock, boto_client=boto_mock)

    monkeypatch.setattr("app.storage.minio_client._minio_client", minio_mock)
    monkeypatch.setattr("app.storage.minio_client._boto_client", boto_mock)
    monkeypatch.setattr("app.storage.minio_client._bucket_resolver", resolver)
    if hasattr(blob_store, "_resolver"):
        monkeypatch.setattr(blob_store, "_resolver", resolver)

    return {"minio": minio_mock, "boto": boto_mock, "resolver": resolver}


@pytest_asyncio.fixture
async def client(setup_database, mock_minio) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        async with _TestSession() as session:
            yield session

    fastapi_app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac
    fastapi_app.dependency_overrides.clear()


def upload_files(filename="test.pdf", content=b"fake-pdf", content_type="application/pdf"):
    return {"file": (filename, content, content_type)}
