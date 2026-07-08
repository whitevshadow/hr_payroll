ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS mobile VARCHAR(20);
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50);
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(20);
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS exit_date DATE;
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS exit_reason VARCHAR(255);
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE employee_schema.employees ADD COLUMN IF NOT EXISTS reporting_manager_id UUID REFERENCES employee_schema.employees(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS employee_schema.financial_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_fy_tenant_name UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS employee_schema.workflow_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    steps JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_schema.workflow_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    definition_id UUID REFERENCES employee_schema.workflow_definitions(id),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    current_step INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'PENDING',
    initiated_by UUID NOT NULL,
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_schema.workflow_step_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    instance_id UUID REFERENCES employee_schema.workflow_instances(id) ON DELETE CASCADE NOT NULL,
    step_number INTEGER NOT NULL,
    actor_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    comment TEXT,
    acted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
