# blobstore-service

Centralized document-storage platform for the HR & Payroll SaaS. All file
operations for every service (employee documents, payroll reports, compliance
filings, organization assets, audit exports) go through this service — direct
MinIO access from other services is forbidden.

- Object storage: MinIO (S3-compatible; one bucket per tenant)
- Metadata store: PostgreSQL
- Event streaming: Kafka via a transactional outbox (durable, replayable)
- Default API port: **8011**
- API base path: **`/api/v1`** (e.g. `POST /api/v1/blobs/upload`)

## Authentication & tenant isolation

Every data endpoint requires a valid platform JWT (`Authorization: Bearer`).
The tenant is derived from the verified token's `tenant_id` claim — if an
`X-Tenant-Id` header is supplied it must match, and `uploaded_by` is taken from
the token, never from a client field. Bucket-config, registry-reconcile, blob
delete/restore and notification endpoints additionally require an admin role
(`ORG_ADMIN`, `HR_MANAGER`, `PAYROLL_ADMIN`, `SUPER_ADMIN`).

## Quick Start

### Standalone mode (blobstore + Postgres + MinIO)

```bash
cd blobstore-service
cp .env.example .env
docker compose -f docker-compose.standalone.yml up --build
```

Endpoints:

- API docs: http://localhost:8010/docs
- Health: http://localhost:8010/health
- MinIO console: http://localhost:9001
- Postgres: localhost:5433

### Full stack mode (root compose)

```bash
cd d:\extractor
docker compose up --build
```

This starts extractor + blobstore + infra services together.

## Core Workflow

### 1) Startup workflow

Blobstore startup order:

1. Preflight checks
   - Postgres probe (`SELECT 1`) with bounded retries
   - MinIO probe (`list_buckets`) with bounded retries
2. DB initialization/migrations
3. Optional Kafka consumer start (`ENABLE_KAFKA_CONSUMER=true`)
4. Scheduler start for retention purge

Retry log semantics:

- `INFO ... not reachable yet ... retrying` is transient and expected during container boot.
- `WARNING ... retries exhausted` means real startup failure.

### 2) Upload workflow

`POST /blobs/upload`

1. Validate file size/content-type and tenant header (`X-Tenant-Id`)
2. Resolve target bucket + object key from `doc_type`
3. Ensure tenant bucket exists in MinIO
4. Upload file to MinIO
5. Persist metadata row in Postgres
6. Return `blob_id`, storage metadata, and upload result

### 3) Read/download workflow

- `GET /blobs/{blob_id}` streams file bytes
- `GET /blobs/{blob_id}/metadata` returns metadata only
- `GET /blobs/{blob_id}/url` and `POST /blobs/{blob_id}/url` generate pre-signed URLs

### 4) Deletion workflow

- `DELETE /blobs/{blob_id}` performs soft delete by default
- `DELETE /blobs/{blob_id}?permanent=true` removes object + metadata
- `POST /blobs/{blob_id}/restore` restores soft-deleted metadata

## API Surface

### Blob routes (`/blobs`)

- `POST /upload`
- `POST /batch-upload`
- `GET /`
- `GET /{blob_id}`
- `GET /{blob_id}/metadata`
- `DELETE /{blob_id}`
- `POST /{blob_id}/restore`
- `GET /{blob_id}/url`
- `POST /{blob_id}/url`
- `PATCH /{blob_id}/tags`
- `POST /file-exists`
- `POST /presigned-url`
- `GET /notifications`
- `GET /notifications/stream`

### Bucket routes (`/bucket-config`)

- `GET /buckets/list`
- `POST /buckets/create`
- `POST /cors/{bucket_name}`
- `GET /status/{bucket_name}`
- `POST /auto-configure/{bucket_name}`
- `POST /provision-tenant/{tenant_id}`

### Registry routes (`/registry`)

- `POST /`
- `PATCH /{registry_id}`
- `GET /`
- `GET /{registry_id}`
- `POST /reconcile-stale`

### Health routes

- `GET /health`
- `GET /health/live`
- `GET /health/ready`

## Storage Routing Model

**One bucket per organization**, named `tenant-{tenant_id}`. Buckets are created
automatically on first use, on `ORG_CREATED.v1`, or via the provision endpoint —
each with versioning, SSE-S3 (AES-256) encryption, and lifecycle rules applied.

Inside a bucket, objects are routed by `doc_type` into folder prefixes:

```
employees/{employee_id}/{aadhaar|pan|bank|photo|offer_letter|salary_docs|compliance_docs|contracts}/
organization/{logo|branding|policies|holiday_calendars|tax_configuration|compliance_configuration}/
payroll/{year}/{month}/{payslips|reports|exports}/
compliance/{pf|esi|pt|tds|exports}/
audit/{exports|investigations|snapshots}/
```

Object key: `{folder}/{blob_id}.{ext}`. Unknown doc types fall back to
`employees/{employee_id}/custom/` or `organization/custom/`.

## Events

Domain events are written to a transactional outbox and relayed to Kafka
(`blob.events.v1`): `blob.created.v1`, `blob.updated.v1`, `blob.deleted.v1`,
`blob.restored.v1`, `blob.downloaded.v1`. Org lifecycle events
(`org.events.v1`: `ORG_CREATED.v1` / `ORG_DELETED.v1`) drive automatic bucket
provisioning and archival.

## Key Environment Variables

- `DATABASE_URL`
- `MINIO_ENDPOINT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_SECURE`
- `ENABLE_KAFKA_CONSUMER`
- `KAFKA_BOOTSTRAP_SERVERS`
- `STARTUP_MAX_RETRIES`
- `STARTUP_RETRY_DELAY_SECONDS`

See `.env.example` for complete defaults.

## Troubleshooting

### PostgreSQL not reachable on startup

If startup ends with retries exhausted:

1. Check service status:
   ```bash
   docker compose ps
   ```
2. Check postgres logs:
   ```bash
   docker compose logs postgres
   ```
3. Check blobstore logs:
   ```bash
   docker compose logs blobstore
   ```
4. Verify `DATABASE_URL` credentials match the running compose mode.

### Common local mismatch

- Standalone compose (`docker-compose.standalone.yml`) uses `blobstore:blobstore` on port 5433
- Root compose (`docker-compose.yml`) uses `postgres:postgres` on port 5432

Run tests against standalone:
```powershell
$env:TEST_DATABASE_URL = "postgresql+asyncpg://blobstore:blobstore@127.0.0.1:5433/blobstore_test"
cd d:\extractor\blobstore-service
.\.venv\Scripts\python.exe -m pytest -q
```

Run tests against root compose:
```powershell
$env:TEST_DATABASE_URL = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/blobstore_test"
cd d:\extractor\blobstore-service
.\.venv\Scripts\python.exe -m pytest -q
```

## Development

Run tests:

```bash
d:/extractor/.venv/Scripts/python.exe -m pytest -q blobstore-service/tests
```

Run startup preflight tests:

```bash
d:/extractor/.venv/Scripts/python.exe -m pytest -q blobstore-service/tests/test_health.py::TestStartupPreflight::test_preflight_retries_postgres_then_succeeds blobstore-service/tests/test_health.py::TestStartupPreflight::test_preflight_raises_after_postgres_retries_exhausted
```
