-- 1. ADD client_id COLUMN TO ALL RELEVANT TABLES
-- Attendance Schema
ALTER TABLE attendance_schema.attendance_audit ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE attendance_schema.attendance_months ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE attendance_schema.attendance_records ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Audit & Notification Schemas
ALTER TABLE audit_schema.audit_logs ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE notification_schema.notifications ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Compliance Schema
ALTER TABLE compliance_schema.esi_contributions ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE compliance_schema.pf_contributions ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE compliance_schema.pt_deductions ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Employee Schema
ALTER TABLE employee_schema.departments ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE employee_schema.locations ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Payout Schema
ALTER TABLE payout_schema.payout_batches ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE payout_schema.payout_transactions ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Payroll Schema
ALTER TABLE payroll_schema.payroll_cycles ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE payroll_schema.payroll_results ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Reporting Schema
ALTER TABLE reporting_schema.generated_reports ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Salary Schema
ALTER TABLE salary_schema.salary_components ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE salary_schema.salary_structures ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- TDS Schema
ALTER TABLE tds_schema.declaration_versions ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.employee_declarations ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.employee_tax_profiles ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.form122 ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.form16 ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.proof_documents ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tax_audit_log ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tax_computations ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tax_projections ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tax_regime_history ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tax_traces ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tds_calculations ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tds_declarations ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tds_ledger ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE tds_schema.tds_snapshots ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- Public Schema (Documents)
ALTER TABLE public.blob_outbox ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE public.blobs ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE public.document_audit ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE public.document_registry ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);
ALTER TABLE public.employee_documents ADD COLUMN client_id UUID REFERENCES employee_schema.clients(id);

-- 2. DATA BACKFILL FOR TABLES WITH employee_id
UPDATE attendance_schema.attendance_audit t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE attendance_schema.attendance_records t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE compliance_schema.esi_contributions t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE compliance_schema.pf_contributions t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE compliance_schema.pt_deductions t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE payout_schema.payout_transactions t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE payroll_schema.payroll_results t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE reporting_schema.generated_reports t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE salary_schema.salary_structures t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE tds_schema.declaration_versions t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.employee_declarations t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.employee_tax_profiles t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.form122 t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.form16 t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.proof_documents t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tax_audit_log t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tax_computations t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tax_projections t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tax_regime_history t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tax_traces t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tds_calculations t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tds_declarations t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tds_ledger t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE tds_schema.tds_snapshots t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

UPDATE public.blobs t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE public.document_audit t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE public.document_registry t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;
UPDATE public.employee_documents t SET client_id = e.client_id FROM employee_schema.employees e WHERE t.employee_id = e.id;

-- 3. DATA BACKFILL FOR TABLES WITHOUT DIRECT employee_id
UPDATE employee_schema.departments d
SET client_id = (SELECT e.client_id FROM employee_schema.employees e WHERE e.department_id = d.id LIMIT 1);

UPDATE employee_schema.locations l
SET client_id = (SELECT e.client_id FROM employee_schema.employees e WHERE e.location_id = l.id LIMIT 1);

UPDATE payroll_schema.payroll_cycles c
SET client_id = (SELECT r.client_id FROM payroll_schema.payroll_results r WHERE r.cycle_id = c.id LIMIT 1);

UPDATE payout_schema.payout_batches b
SET client_id = (SELECT t.client_id FROM payout_schema.payout_transactions t WHERE t.batch_id = b.id LIMIT 1);

UPDATE salary_schema.salary_components c
SET client_id = (SELECT s.client_id FROM salary_schema.salary_structures s WHERE s.id = c.structure_id LIMIT 1);

UPDATE attendance_schema.attendance_months m
SET client_id = (SELECT r.client_id FROM attendance_schema.attendance_records r WHERE r.month = m.month LIMIT 1);
