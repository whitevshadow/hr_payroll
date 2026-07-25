# Blobstore Service — Current State Audit & Migration Plan

**Audited:** 2026-05-30
**Service version:** 2.0.0 (`app/config.py`), README/`.env` still say 1.0.0
**Scope:** MinIO object storage + PostgreSQL metadata + optional Kafka, FastAPI on port 8010

---

## 1. Executive Summary

The service is **architecturally close** to the target design already: it uses a
one-bucket-per-tenant model (`tenant-{tenant_id}`), prefix-based folder hierarchy
(`employees/`, `payroll/`, `compliance/`, `audit/`, `organization/`), a provider
interface (`BlobStoreInterface`) for future S3 swap, soft-delete with scheduled
purge, and an `EventEnvelope` Kafka producer. **No other service touches MinIO
directly** — the "all file ops go through Blobstore" goal is already satisfied at
the code level.

However, it is **not production-ready and not wired into the platform**. The most
serious problems are a **complete absence of authentication / tenant-isolation
enforcement**, several **cross-tenant data-leak endpoints**, a **download endpoint
that crashes on every call**, and the fact that the service is **absent from the
root `docker-compose.yml`** (no MinIO, no Kafka, port collides with
reporting-service). Many target-spec features (versioning APIs, lifecycle/object-lock,
encryption, virus scan, outbox/DLQ, org-event-driven provisioning, 7-year archive)
are **unimplemented or only partially implemented**.

Severity tally: **5 Critical · 8 High · 9 Medium · gaps vs. spec below.**

---

## 2. Current State (what actually works)

| Area | State |
|---|---|
| Storage model | ✅ One bucket per tenant `tenant-{tenant_id}` (`bucket_resolver.py`) |
| Folder routing | ✅ `doc_type` → `employees/.../`, `payroll/{year}/{month}/...`, `compliance/...`, `audit/...`, `organization/...` |
| Provider abstraction | ✅ `BlobStoreInterface` + `MinIOBlobStore`; dual MinIO-SDK + boto3 clients |
| Metadata table | ✅ `blobs` table has nearly all spec columns (id, tenant_id, employee_id, bucket, key, folder, doc_type, mime, size, etag, version, checksum, uploaded_by, timestamps, is_deleted, retention_until, tags) |
| Soft delete | ✅ `is_deleted` + `retention_until`, daily APScheduler purge |
| Upload pipeline | ✅ Validate → MinIO put → DB insert → MinIO rollback on DB failure |
| Presigned upload | ✅ `generate_presigned_post` (boto3) for direct browser→MinIO |
| Events | ⚠️ Producer emits `blob.created/deleted/restored.v1` envelopes (fire-and-forget) |
| SSE notifications | ⚠️ Kafka→deque→SSE stream exists |
| Health | ✅ `/health`, `/health/live`, `/health/ready` (DB + MinIO + Kafka lag) |
| Registry | ✅ `document_registry` table + reconcile job (extraction tracking) |
| No direct MinIO access elsewhere | ✅ Confirmed: only blobstore imports `minio`/`boto3` |

---

## 3. Issues & Bugs

### CRITICAL

- **C1 — `GET /blobs/{id}` (download) crashes on every call.**
  `blob_router.py:373,376` read `blob.content_type` and `blob.file_size`, but the
  ORM model exposes `mime_type` and `size`. Every download raises `AttributeError`
  → HTTP 500. Download is effectively non-functional.

- **C2 — `GET /blobs` leaks every tenant's blobs.**
  `list_blobs` / `BlobRepository.list_filtered` apply **no `tenant_id` filter**.
  Any caller lists all tenants' metadata. Direct breach of tenant isolation.

- **C3 — No authentication anywhere; tenant identity is forgeable.**
  There is **no JWT/token verification code in the service** (grep confirms none).
  `X-Tenant-Id` is trusted blindly and `uploaded_by` is a plain form field. The
  docstrings claiming "cross-validated against the calling service's JWT
  `tenant_id` claim" (`main.py:211`, `blob_router.py:120`) are **false**. Any
  client can read/write/delete as any tenant.

- **C4 — Download / metadata / delete / restore / presigned-GET ignore tenant.**
  These endpoints take only `blob_id` and never check the caller's tenant against
  `blob.tenant_id`. Knowing (or guessing) a blob UUID grants cross-tenant
  download and **deletion**.

- **C5 — `POST /blobs/presigned-url` and `POST /blobs/file-exists` accept an
  arbitrary `bucket_name`/`object_name` from the client.**
  `presigned-url` even defaults `bucket_name="blobs"`. A caller can mint a
  presigned **POST (write)** URL into *any* bucket/key, or probe object existence
  across tenants. Cross-tenant write + enumeration.

### HIGH

- **H1 — Service not deployed.** `docker-compose.yml` contains no `blobstore`,
  no `minio`, no `kafka`. Its documented port **8010 collides with
  reporting-service**. The service cannot run in the platform as-is.

- **H2 — Reporting-service does not use Blobstore.** It writes to local disk
  (`REPORTS_DIR: /app/reports`). Payslips/Form16/PF-ECR are **not** stored in
  `payroll/`/`compliance/`. Target integration unmet.

- **H3 — CORS misconfig.** `allow_origins=["*"]` **with**
  `allow_credentials=True` (`main.py:258`) is invalid per the CORS spec and
  unsafe; browsers reject credentialed wildcard. Bucket CORS auto-config is also
  fully permissive (`["*"]`, all methods).

- **H4 — Events are lossy (no outbox).** `publish_event` is fire-and-forget in a
  `BackgroundTask`; if Kafka is down or the producer failed to start, events are
  **silently dropped**. No outbox table, no DLQ, no retry — contradicts the
  "audit: no exceptions" and "outbox compatibility" requirements.

- **H5 — `etag`, `version`, `checksum` are never populated.** Columns exist but
  upload never captures the MinIO `ETag`/version-id or computes a checksum, so
  integrity validation and version tracking are impossible downstream.

- **H6 — No org-event-driven bucket provisioning.** The Kafka consumer only fills
  the SSE deque. There is **no `ORG_CREATED.v1` handler** to auto-create + policy
  + version a tenant bucket. Buckets are created lazily on first upload or via a
  manual endpoint only.

- **H7 — Dual schema source of truth / fragile migrations.**
  `postgres/init.sql` creates the **old** schema (`object_name`, `content_type`,
  `file_size`, `deleted_at`); `db.py:init_db` then runs a long list of
  `ALTER … RENAME` statements at every startup to reshape it. No Alembic. Renames
  silently swallow errors — schema drift is invisible.

- **H8 — Kafka topic semantics are conflated.** The producer publishes the
  service's **domain** events and the consumer treats the same topic as **MinIO
  bucket notifications** (`event_consumer.py` docstring). The SSE "storage events"
  stream therefore surfaces domain envelopes, not MinIO put/delete notifications.
  `.env` sets `KAFKA_TOPIC_BLOB_EVENTS=blob-store-events` while `config.py`
  default is `blob.events.v1` — easy to misconfigure.

### MEDIUM

- **M1 — Retention default 30 days**, spec wants **90**; `.env`/README say 1.0.0,
  config says 2.0.0 — version/config drift.
- **M2 — No `GET /blobs/{id}/versions` or version-restore endpoint** (spec
  requires it). MinIO versioning is enabled only on resolver-created buckets, not
  on `create_bucket()` / legacy `_ensure_bucket` paths → inconsistent.
- **M3 — No lifecycle rules, object locking, SSE-S3/KMS encryption, or
  notification targets** configured on buckets. None of the "MINIO CONFIGURATION"
  verify items are actually set.
- **M4 — No AES-256 metadata encryption, no virus-scan hook, no checksum
  validation** (security spec items absent).
- **M5 — Missing events:** `blob.updated.v1`, `blob.downloaded.v1`,
  `blob.version_created.v1` are never emitted.
- **M6 — No rate limiting** despite documented `429` responses.
- **M7 — `repository.get_expired_soft_deleted(retention_days)` ignores its
  argument** (filters purely on `retention_until`), so the service-layer
  retention value is dead code on that path.
- **M8 — Org deletion flow (mark inactive, archive, retain 7 years) not
  implemented.** Buckets/blobs would just be left or hard-deleted.
- **M9 — Stale provenance:** README/tests reference `d:\extractor`, "MS Blob
  Store", "extractor" — the service was copied from another project; docs and the
  multi-bucket-per-type model in the README contradict the implemented
  one-bucket-per-tenant model.

---

## 4. Risks

- **Data confidentiality breach (C2–C5):** cross-tenant read, write, enumerate,
  and delete are all currently possible without credentials. This is the dominant
  risk and blocks any real deployment.
- **Data loss:** hard-delete and lossy events mean deletions may occur with no
  durable audit trail (H4). No object-lock/WORM for `audit/` immutable archives.
- **Availability:** download is broken (C1); startup migrations can silently leave
  the schema half-renamed (H7).
- **Compliance:** 7-year statutory retention and immutable audit archives are not
  enforced (M3, M8); audit events can be dropped (H4).
- **Operational:** port collision and missing infra (H1) mean "it works on my
  machine" only; no Alembic means environments diverge.

---

## 5. Scalability Concerns

- **Per-request boto3/MinIO calls run on the default thread pool** via
  `run_in_executor(None, …)`. Under load this saturates the shared executor; needs
  a bounded, dedicated pool or async S3 client.
- **SSE notifications use a single in-process `deque(maxlen=50)`** — not shared
  across replicas, lost on restart, and the stream polls every 500 ms per client.
  Does not scale horizontally.
- **`list_filtered` uses OFFSET pagination** — O(n) deep pages; should be
  keyset/cursor for large tenants.
- **Single `blobs` table, no partitioning** by tenant/time; the partial index
  helps but very large tenants will need partitioning.
- **Bucket-per-tenant** is fine for hundreds–thousands of tenants but S3/MinIO
  have account bucket limits; at high tenant counts consider prefix-per-tenant in
  shared buckets (trade-off documented for the AWS migration).
- **`provision_tenant`/resolver caches created buckets in a per-process `set`** —
  fine, but bucket existence checks still hit MinIO on cold processes.

---

## 6. Security Gaps (consolidated)

| Spec requirement | Status |
|---|---|
| JWT / role-based access | ❌ none |
| Tenant-id validation before every op | ❌ header trusted, not enforced on most ops |
| Cross-tenant access impossible | ❌ C2–C5 allow it |
| AES-256 metadata encryption | ❌ |
| Bucket SSE (server-side encryption) | ❌ |
| Object checksum validation | ❌ column unused |
| Virus scan hook | ❌ |
| Presigned URLs scoped to tenant | ❌ arbitrary bucket/key |
| Never expose raw MinIO creds | ⚠️ presigned flow OK, but no auth around it |
| Audit logging of every action | ⚠️ best-effort HTTP + lossy Kafka, can drop |
| Object lock / WORM for audit | ❌ |

---

## 7. Spec Compliance Matrix (Success Criteria)

| Criterion | Status |
|---|---|
| Organization-level buckets | ✅ |
| Employee-level folder hierarchy | ✅ |
| Versioning | ⚠️ enabled inconsistently; no APIs |
| Presigned uploads | ✅ (but unscoped) |
| Metadata tracking | ✅ (etag/version/checksum unpopulated) |
| Kafka events | ⚠️ partial set, lossy |
| Audit integration | ⚠️ best-effort, lossy |
| Reporting integration | ❌ reporting writes to disk |
| Employee integration | ⚠️ APIs exist; not enforced/secured |
| Tenant isolation | ❌ not enforced |
| Lifecycle policies | ❌ |
| S3 compatibility | ✅ boto3 + interface |
| Future AWS migration | ✅ interface seam present |

---

## 8. Migration Plan (phased)

**Phase 0 — Stop the bleeding (Critical fixes, ~1–2 days)**
1. Fix C1: use `blob.mime_type` / `blob.size` in `download_blob`.
2. Add tenant scoping everywhere: thread `X-Tenant-Id` into
   `get_by_id`, `list_filtered`, delete/restore/presigned/file-exists; reject
   mismatches with 404. Add `tenant_id` to the `WHERE` of every query.
3. Lock down `presigned-url`/`file-exists`: derive bucket from the caller's tenant
   via the resolver; never accept a raw bucket name.

**Phase 1 — AuthN/AuthZ (~2–3 days)**
4. Add shared JWT verification dependency (reuse the platform `JWT_SECRET`);
   require `Authorization: Bearer`; cross-check `X-Tenant-Id` == token
   `tenant_id`; derive `uploaded_by` from the token, not a form field. Make the
   docstrings true.
5. Role checks for delete/restore/audit operations.

**Phase 2 — Platform wiring (~2 days)**
6. Add `minio`, `kafka` (+ zookeeper/kraft), and `blobstore` to
   `docker-compose.yml`; resolve the **8010 port collision** (move blobstore to
   e.g. 8011 or reporting elsewhere). Add healthchecks + `depends_on`.
7. Repoint reporting-service (and employee/compliance) to call Blobstore APIs for
   `payroll/` and `compliance/` artifacts instead of local disk.

**Phase 3 — Durability & correctness (~3 days)**
8. Introduce **Alembic**; make `postgres/init.sql` match the final schema; remove
   the runtime RENAME migrations. Single source of truth.
9. Implement the **transactional outbox** (+ relay + DLQ + retry) so every
   create/update/delete/restore/download/version event is durable. Emit the full
   event set. Wire audit-service consumption.
10. Populate `etag`/`version`/`checksum` on upload; add checksum validation.

**Phase 4 — Storage policies & lifecycle (~3 days)**
11. `ORG_CREATED.v1` consumer → create bucket, enable versioning, apply lifecycle
    rules, SSE encryption, and (for `audit/`) object-lock/WORM. Startup validation.
12. Lifecycle: 90-day soft-delete cleanup; org-deletion → mark inactive + archive,
    7-year retention. Default retention 30→90.
13. Version APIs: `GET /blobs/{id}/versions`, version restore, emit
    `blob.version_created.v1`.

**Phase 5 — Hardening & scale (~ongoing)**
14. Virus-scan hook, AES-256 metadata encryption, dedicated thread pool / async
    S3, keyset pagination, rate limiting, CORS tightening, optional table
    partitioning.

---

## 9. Quick Wins (safe, isolated, high value)

- C1 download fix (one-line attribute rename).
- Tenant filter on `list_filtered` (one `WHERE` clause).
- CORS credentials/origins fix.
- Retention default 30→90 + version string alignment.
- Topic-name alignment between `.env` and `config.py`.
