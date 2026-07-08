ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS address JSONB;
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS contact JSONB;
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS statutory_ids JSONB;
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS industry VARCHAR(100);
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS payroll_start_date DATE;
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS payroll_frequency VARCHAR(20) DEFAULT 'MONTHLY';
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS payroll_calendar VARCHAR(30);
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS financial_year VARCHAR(9);
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS msme_number VARCHAR(50);
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS website VARCHAR(255);
ALTER TABLE employee_schema.clients ADD COLUMN IF NOT EXISTS salary_template_id UUID;

ALTER TABLE employee_schema.client_portal_credentials ALTER COLUMN portal_type TYPE VARCHAR(50);

CREATE TABLE IF NOT EXISTS employee_schema.client_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    client_id UUID NOT NULL REFERENCES employee_schema.clients(id) ON DELETE CASCADE,
    blob_id UUID,
    doc_category VARCHAR(50),
    doc_label VARCHAR(100),
    description TEXT,
    expiry_date DATE,
    version INTEGER DEFAULT 1,
    verification_status VARCHAR(20) DEFAULT 'PENDING',
    verified_by UUID,
    verified_at TIMESTAMP WITH TIME ZONE,
    verification_comment TEXT,
    superseded_by_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_docs_client_id ON employee_schema.client_documents (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_client_docs_expiry ON employee_schema.client_documents (expiry_date);
