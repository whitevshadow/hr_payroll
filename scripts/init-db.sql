-- Creates one schema per service in the single hr_payroll database.
-- Runs automatically on first Postgres container start.
CREATE SCHEMA IF NOT EXISTS auth_schema;
CREATE SCHEMA IF NOT EXISTS employee_schema;
CREATE SCHEMA IF NOT EXISTS salary_schema;
CREATE SCHEMA IF NOT EXISTS attendance_schema;
CREATE SCHEMA IF NOT EXISTS compliance_schema;
CREATE SCHEMA IF NOT EXISTS tds_schema;
CREATE SCHEMA IF NOT EXISTS payroll_schema;
CREATE SCHEMA IF NOT EXISTS payout_schema;
CREATE SCHEMA IF NOT EXISTS reporting_schema;
CREATE SCHEMA IF NOT EXISTS audit_schema;
