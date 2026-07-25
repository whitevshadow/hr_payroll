-- Blobstore service bootstrap schema (standalone / reference).
--
-- NOTE: In the platform deployment the tables are created authoritatively by
-- the SQLAlchemy models via `Base.metadata.create_all` at startup
-- (see app/database/db.py). This file mirrors that schema for standalone use
-- and must be kept in sync with the ORM models.

CREATE TABLE IF NOT EXISTS blobs (
    id              UUID PRIMARY KEY,
    tenant_id       UUID        NOT NULL,
    employee_id     UUID        NULL,
    bucket_name     VARCHAR(255) NOT NULL,
    object_key      TEXT        NOT NULL,
    folder          VARCHAR(255) NOT NULL DEFAULT '',
    file_name       TEXT        NOT NULL,
    document_type   VARCHAR(50) NOT NULL DEFAULT 'raw',
    mime_type       VARCHAR(255) NOT NULL,
    size            BIGINT      NOT NULL,
    etag            VARCHAR(255) NULL,
    version         VARCHAR(255) NULL,
    checksum        VARCHAR(255) NULL,
    uploaded_by     UUID        NOT NULL,
    tags            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
    retention_until TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_blobs_tenant_id ON blobs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_blobs_employee_id ON blobs (employee_id);
CREATE INDEX IF NOT EXISTS idx_blobs_uploaded_by ON blobs (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_blobs_active
    ON blobs (tenant_id, uploaded_at DESC) WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS document_registry (
    id                    UUID PRIMARY KEY,
    tenant_id             UUID        NOT NULL,
    raw_blob_id           UUID        NOT NULL REFERENCES blobs (id) ON DELETE RESTRICT,
    extracted_blob_id     UUID        REFERENCES blobs (id) ON DELETE SET NULL,
    doc_type              VARCHAR(50) NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'UPLOADED',
    employee_id           UUID        NULL,
    payroll_cycle_id      UUID        NULL,
    month                 VARCHAR(10) NULL,
    extraction_confidence VARCHAR(10) NULL,
    extraction_error      TEXT        NULL,
    extraction_attempts   INTEGER     NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registry_tenant_type ON document_registry (tenant_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_registry_employee ON document_registry (tenant_id, employee_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_registry_cycle ON document_registry (tenant_id, payroll_cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_registry_month ON document_registry (tenant_id, month, doc_type);

-- Transactional outbox for durable blob domain events.
CREATE TABLE IF NOT EXISTS blob_outbox (
    id           UUID PRIMARY KEY,
    event_type   VARCHAR(64) NOT NULL,
    tenant_id    UUID        NOT NULL,
    trace_id     UUID        NOT NULL,
    payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    payload_hash VARCHAR(64) NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempts     INTEGER     NOT NULL DEFAULT 0,
    last_error   TEXT        NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at      TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON blob_outbox (created_at) WHERE status = 'PENDING';
