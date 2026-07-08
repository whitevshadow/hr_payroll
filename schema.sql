--
-- PostgreSQL database dump
--

\restrict qXhGFFeBbumydpIKe98FtONhP1IP4DcAtSlk07ico8MnkCzvql8Gkmglh5K5LAO

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg13+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: attendance_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA attendance_schema;


ALTER SCHEMA attendance_schema OWNER TO hr;

--
-- Name: audit_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA audit_schema;


ALTER SCHEMA audit_schema OWNER TO hr;

--
-- Name: auth_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA auth_schema;


ALTER SCHEMA auth_schema OWNER TO hr;

--
-- Name: compliance_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA compliance_schema;


ALTER SCHEMA compliance_schema OWNER TO hr;

--
-- Name: employee_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA employee_schema;


ALTER SCHEMA employee_schema OWNER TO hr;

--
-- Name: notification_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA notification_schema;


ALTER SCHEMA notification_schema OWNER TO hr;

--
-- Name: payout_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA payout_schema;


ALTER SCHEMA payout_schema OWNER TO hr;

--
-- Name: payroll_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA payroll_schema;


ALTER SCHEMA payroll_schema OWNER TO hr;

--
-- Name: reporting_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA reporting_schema;


ALTER SCHEMA reporting_schema OWNER TO hr;

--
-- Name: salary_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA salary_schema;


ALTER SCHEMA salary_schema OWNER TO hr;

--
-- Name: tds_schema; Type: SCHEMA; Schema: -; Owner: hr
--

CREATE SCHEMA tds_schema;


ALTER SCHEMA tds_schema OWNER TO hr;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance_audit; Type: TABLE; Schema: attendance_schema; Owner: hr
--

CREATE TABLE attendance_schema.attendance_audit (
    client_id uuid,
    actor_id uuid NOT NULL,
    employee_id uuid,
    month date,
    event_type character varying(60) NOT NULL,
    previous_value text,
    new_value text,
    reason text,
    created_at timestamp with time zone DEFAULT '2026-06-15 14:21:46.146496+00'::timestamp with time zone NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE attendance_schema.attendance_audit OWNER TO hr;

--
-- Name: attendance_months; Type: TABLE; Schema: attendance_schema; Owner: hr
--

CREATE TABLE attendance_schema.attendance_months (
    client_id uuid,
    month date NOT NULL,
    status character varying(20) NOT NULL,
    total_employees integer NOT NULL,
    employees_with_lop integer NOT NULL,
    completion_pct numeric(5,2) NOT NULL,
    validated_by uuid,
    validated_at timestamp with time zone,
    locked_by uuid,
    locked_at timestamp with time zone,
    locked_reason text,
    unlocked_by uuid,
    unlocked_at timestamp with time zone,
    unlock_reason text,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE attendance_schema.attendance_months OWNER TO hr;

--
-- Name: attendance_records; Type: TABLE; Schema: attendance_schema; Owner: hr
--

CREATE TABLE attendance_schema.attendance_records (
    client_id uuid,
    employee_id uuid NOT NULL,
    month date NOT NULL,
    total_days integer NOT NULL,
    present_days numeric(5,1) NOT NULL,
    lop_days numeric(5,1) NOT NULL,
    payable_days numeric(5,1) NOT NULL,
    is_finalized boolean NOT NULL,
    cl_days numeric(5,1) NOT NULL,
    sl_days numeric(5,1) NOT NULL,
    pl_days numeric(5,1) NOT NULL,
    wo_days numeric(5,1) NOT NULL,
    holiday_days numeric(5,1) NOT NULL,
    wfh_days numeric(5,1) NOT NULL,
    overtime_hours numeric(6,1) NOT NULL,
    attendance_pct numeric(5,2) NOT NULL,
    daily_status text,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE attendance_schema.attendance_records OWNER TO hr;

--
-- Name: audit_logs; Type: TABLE; Schema: audit_schema; Owner: hr
--

CREATE TABLE audit_schema.audit_logs (
    client_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_type character varying(100) NOT NULL,
    actor_id uuid,
    entity_type character varying(100),
    entity_id character varying(100),
    payload_json jsonb NOT NULL,
    payload_hash character varying(64) NOT NULL,
    trace_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE audit_schema.audit_logs OWNER TO hr;

--
-- Name: roles; Type: TABLE; Schema: auth_schema; Owner: hr
--

CREATE TABLE auth_schema.roles (
    user_id uuid NOT NULL,
    role_name character varying(50) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE auth_schema.roles OWNER TO hr;

--
-- Name: tenants; Type: TABLE; Schema: auth_schema; Owner: hr
--

CREATE TABLE auth_schema.tenants (
    name character varying(200) NOT NULL,
    is_active boolean NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE auth_schema.tenants OWNER TO hr;

--
-- Name: users; Type: TABLE; Schema: auth_schema; Owner: hr
--

CREATE TABLE auth_schema.users (
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_active boolean NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE auth_schema.users OWNER TO hr;

--
-- Name: esi_contributions; Type: TABLE; Schema: compliance_schema; Owner: hr
--

CREATE TABLE compliance_schema.esi_contributions (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    gross_wages numeric(12,2) NOT NULL,
    is_esi_eligible boolean NOT NULL,
    employee_esi numeric(12,2) NOT NULL,
    employer_esi numeric(12,2) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE compliance_schema.esi_contributions OWNER TO hr;

--
-- Name: pf_contributions; Type: TABLE; Schema: compliance_schema; Owner: hr
--

CREATE TABLE compliance_schema.pf_contributions (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    pf_wages numeric(12,2) NOT NULL,
    employee_pf numeric(12,2) NOT NULL,
    employer_eps numeric(12,2) NOT NULL,
    employer_epf numeric(12,2) NOT NULL,
    is_ceiling_applied boolean NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE compliance_schema.pf_contributions OWNER TO hr;

--
-- Name: pt_deductions; Type: TABLE; Schema: compliance_schema; Owner: hr
--

CREATE TABLE compliance_schema.pt_deductions (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    state character varying(60) NOT NULL,
    pt_amount numeric(12,2) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE compliance_schema.pt_deductions OWNER TO hr;

--
-- Name: client_portal_credentials; Type: TABLE; Schema: employee_schema; Owner: hr
--

CREATE TABLE employee_schema.client_portal_credentials (
    client_id uuid NOT NULL,
    portal_type character varying(20) NOT NULL,
    portal_name character varying(200),
    username character varying(255),
    password_encrypted text,
    last_rotated_at timestamp with time zone,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE employee_schema.client_portal_credentials OWNER TO hr;

--
-- Name: clients; Type: TABLE; Schema: employee_schema; Owner: hr
--

CREATE TABLE employee_schema.clients (
    client_code character varying(50) NOT NULL,
    client_name character varying(200) NOT NULL,
    legal_name character varying(200),
    address_line1 character varying(255),
    address_line2 character varying(255),
    area character varying(150),
    city character varying(100),
    state character varying(100),
    country character varying(100) NOT NULL,
    pincode character varying(20),
    gst_number character varying(20),
    pan_number character varying(20),
    tan_number character varying(20),
    cin_number character varying(30),
    contact_person character varying(150),
    contact_email character varying(255),
    contact_mobile character varying(20),
    contact_telephone character varying(20),
    pf_establishment_code character varying(50),
    esic_employer_code character varying(50),
    professional_tax_number character varying(50),
    labour_license_number character varying(100),
    shop_act_number character varying(100),
    status character varying(20) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE employee_schema.clients OWNER TO hr;

--
-- Name: departments; Type: TABLE; Schema: employee_schema; Owner: hr
--

CREATE TABLE employee_schema.departments (
    client_id uuid,
    name character varying(150) NOT NULL,
    cost_center character varying(100),
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE employee_schema.departments OWNER TO hr;

--
-- Name: employees; Type: TABLE; Schema: employee_schema; Owner: hr
--

CREATE TABLE employee_schema.employees (
    emp_code character varying(50) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255),
    pan_number text,
    bank_account text,
    bank_ifsc text,
    uan_number text,
    status character varying(20) NOT NULL,
    joining_date date,
    department_id uuid,
    designation character varying(120),
    location_id uuid,
    work_location character varying(120),
    city character varying(100),
    state character varying(100),
    branch character varying(100),
    client_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE employee_schema.employees OWNER TO hr;

--
-- Name: locations; Type: TABLE; Schema: employee_schema; Owner: hr
--

CREATE TABLE employee_schema.locations (
    client_id uuid,
    location_name character varying(150) NOT NULL,
    city character varying(100) NOT NULL,
    state character varying(100) NOT NULL,
    country character varying(100) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE employee_schema.locations OWNER TO hr;

--
-- Name: notifications; Type: TABLE; Schema: notification_schema; Owner: hr
--

CREATE TABLE notification_schema.notifications (
    client_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    type character varying(80) NOT NULL,
    body text NOT NULL,
    link text,
    is_read boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE notification_schema.notifications OWNER TO hr;

--
-- Name: payout_batches; Type: TABLE; Schema: payout_schema; Owner: hr
--

CREATE TABLE payout_schema.payout_batches (
    client_id uuid,
    cycle_id uuid NOT NULL,
    batch_type character varying(20) NOT NULL,
    total_amount numeric(14,2) NOT NULL,
    status character varying(20) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE payout_schema.payout_batches OWNER TO hr;

--
-- Name: payout_transactions; Type: TABLE; Schema: payout_schema; Owner: hr
--

CREATE TABLE payout_schema.payout_transactions (
    client_id uuid,
    batch_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    idempotency_key character varying(64) NOT NULL,
    status character varying(20) NOT NULL,
    bank_reference text,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE payout_schema.payout_transactions OWNER TO hr;

--
-- Name: payroll_cycles; Type: TABLE; Schema: payroll_schema; Owner: hr
--

CREATE TABLE payroll_schema.payroll_cycles (
    client_id uuid,
    name character varying(150) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status character varying(20) NOT NULL,
    is_dry_run boolean NOT NULL,
    created_by uuid,
    approved_by uuid,
    trace_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE payroll_schema.payroll_cycles OWNER TO hr;

--
-- Name: payroll_results; Type: TABLE; Schema: payroll_schema; Owner: hr
--

CREATE TABLE payroll_schema.payroll_results (
    client_id uuid,
    cycle_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    gross_earnings numeric(12,2) NOT NULL,
    total_deductions numeric(12,2) NOT NULL,
    net_pay numeric(12,2) NOT NULL,
    breakdown_json jsonb NOT NULL,
    status character varying(20) NOT NULL,
    error character varying(500),
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE payroll_schema.payroll_results OWNER TO hr;

--
-- Name: blob_outbox; Type: TABLE; Schema: public; Owner: hr
--

CREATE TABLE public.blob_outbox (
    client_id uuid,
    id uuid NOT NULL,
    event_type character varying(64) NOT NULL,
    tenant_id uuid NOT NULL,
    trace_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash character varying(64) NOT NULL,
    status character varying(16) NOT NULL,
    attempts integer NOT NULL,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone
);


ALTER TABLE public.blob_outbox OWNER TO hr;

--
-- Name: blobs; Type: TABLE; Schema: public; Owner: hr
--

CREATE TABLE public.blobs (
    client_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid,
    bucket_name character varying(255) NOT NULL,
    object_key text NOT NULL,
    folder character varying(255) NOT NULL,
    file_name text NOT NULL,
    document_type character varying(50) NOT NULL,
    mime_type character varying(255) NOT NULL,
    size bigint NOT NULL,
    etag character varying(255),
    version character varying(255),
    checksum character varying(255),
    uploaded_by uuid NOT NULL,
    tags jsonb NOT NULL,
    doc_category character varying(50),
    doc_label character varying(100),
    description text,
    verification_status character varying(20),
    verified_by uuid,
    verified_at timestamp with time zone,
    verification_comment text,
    uploaded_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    is_deleted boolean NOT NULL,
    retention_until timestamp with time zone
);


ALTER TABLE public.blobs OWNER TO hr;

--
-- Name: document_audit; Type: TABLE; Schema: public; Owner: hr
--

CREATE TABLE public.document_audit (
    client_id uuid,
    id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    blob_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    trace_id character varying(64) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE public.document_audit OWNER TO hr;

--
-- Name: document_registry; Type: TABLE; Schema: public; Owner: hr
--

CREATE TABLE public.document_registry (
    client_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    raw_blob_id uuid NOT NULL,
    extracted_blob_id uuid,
    doc_type character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    employee_id uuid,
    payroll_cycle_id uuid,
    month character varying(10),
    extraction_confidence character varying(10),
    extraction_error text,
    extraction_attempts integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


ALTER TABLE public.document_registry OWNER TO hr;

--
-- Name: employee_documents; Type: TABLE; Schema: public; Owner: hr
--

CREATE TABLE public.employee_documents (
    client_id uuid,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    bucket_name character varying(255) NOT NULL,
    object_key text NOT NULL,
    filename text NOT NULL,
    mime_type character varying(255) NOT NULL,
    file_size bigint NOT NULL,
    doc_category character varying(50) NOT NULL,
    doc_label character varying(100) NOT NULL,
    description text,
    verification_status character varying(20) NOT NULL,
    rejection_reason text,
    verified_by uuid,
    verified_at timestamp with time zone,
    uploaded_by uuid NOT NULL,
    uploaded_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    superseded_by_id uuid
);


ALTER TABLE public.employee_documents OWNER TO hr;

--
-- Name: generated_reports; Type: TABLE; Schema: reporting_schema; Owner: hr
--

CREATE TABLE reporting_schema.generated_reports (
    client_id uuid,
    cycle_id uuid NOT NULL,
    employee_id uuid,
    report_type character varying(30) NOT NULL,
    status character varying(20) NOT NULL,
    file_path text,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE reporting_schema.generated_reports OWNER TO hr;

--
-- Name: salary_components; Type: TABLE; Schema: salary_schema; Owner: hr
--

CREATE TABLE salary_schema.salary_components (
    client_id uuid,
    structure_id uuid NOT NULL,
    component_name character varying(100) NOT NULL,
    amount numeric(12,2) NOT NULL,
    component_type character varying(20) NOT NULL,
    is_taxable boolean NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE salary_schema.salary_components OWNER TO hr;

--
-- Name: salary_structures; Type: TABLE; Schema: salary_schema; Owner: hr
--

CREATE TABLE salary_schema.salary_structures (
    client_id uuid,
    employee_id uuid NOT NULL,
    ctc numeric(12,2) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    is_active boolean NOT NULL,
    work_location character varying(120),
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE salary_schema.salary_structures OWNER TO hr;

--
-- Name: declaration_versions; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.declaration_versions (
    client_id uuid,
    declaration_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    tax_year character varying(9) NOT NULL,
    version integer NOT NULL,
    status character varying(20) NOT NULL,
    payload_json jsonb NOT NULL,
    change_reason text,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.declaration_versions OWNER TO hr;

--
-- Name: employee_declarations; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.employee_declarations (
    client_id uuid,
    employee_id uuid NOT NULL,
    tax_year character varying(9) NOT NULL,
    current_version integer NOT NULL,
    status character varying(20) NOT NULL,
    submitted_at timestamp with time zone,
    approved_by uuid,
    declaration_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.employee_declarations OWNER TO hr;

--
-- Name: employee_tax_profiles; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.employee_tax_profiles (
    client_id uuid,
    employee_id uuid NOT NULL,
    pan text,
    aadhaar text,
    dob date,
    residential_status character varying(32) NOT NULL,
    tax_regime character varying(10) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    tax_law_version character varying(32) NOT NULL,
    status character varying(20) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.employee_tax_profiles OWNER TO hr;

--
-- Name: form122; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.form122 (
    client_id uuid,
    employee_id uuid NOT NULL,
    tax_year character varying(9) NOT NULL,
    salary_details jsonb NOT NULL,
    declaration_summary jsonb NOT NULL,
    generated_at timestamp with time zone,
    status character varying(20) NOT NULL,
    submission_mode character varying(20) NOT NULL,
    copy_ref character varying(256),
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.form122 OWNER TO hr;

--
-- Name: form16; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.form16 (
    client_id uuid,
    employee_id uuid NOT NULL,
    tax_year character varying(9) NOT NULL,
    part_a_json jsonb NOT NULL,
    part_b_json jsonb NOT NULL,
    generation_metadata jsonb NOT NULL,
    issue_history jsonb NOT NULL,
    correction_history jsonb NOT NULL,
    digital_signature_status character varying(20) NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.form16 OWNER TO hr;

--
-- Name: proof_documents; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.proof_documents (
    client_id uuid,
    declaration_version_id uuid,
    employee_id uuid NOT NULL,
    tax_year character varying(9) NOT NULL,
    proof_type character varying(40) NOT NULL,
    document_ref character varying(256) NOT NULL,
    status character varying(20) NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    verification_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.proof_documents OWNER TO hr;

--
-- Name: tax_audit_log; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tax_audit_log (
    client_id uuid,
    actor_id uuid,
    employee_id uuid,
    event_type character varying(80) NOT NULL,
    previous_values jsonb NOT NULL,
    new_values jsonb NOT NULL,
    reason text,
    event_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tax_audit_log OWNER TO hr;

--
-- Name: tax_computations; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tax_computations (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid,
    tax_year character varying(9) NOT NULL,
    law_version character varying(32) NOT NULL,
    regime character varying(10) NOT NULL,
    annual_tax numeric(12,2) NOT NULL,
    trace_hash character varying(64) NOT NULL,
    trace_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tax_computations OWNER TO hr;

--
-- Name: tax_projections; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tax_projections (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid,
    tax_year character varying(9) NOT NULL,
    law_version character varying(32) NOT NULL,
    regime character varying(10) NOT NULL,
    projected_income numeric(12,2) NOT NULL,
    taxable_income numeric(12,2) NOT NULL,
    projection_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tax_projections OWNER TO hr;

--
-- Name: tax_regime_history; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tax_regime_history (
    client_id uuid,
    employee_id uuid NOT NULL,
    effective_date date NOT NULL,
    previous_regime character varying(10),
    new_regime character varying(10) NOT NULL,
    reason text,
    approved_by uuid,
    audit_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tax_regime_history OWNER TO hr;

--
-- Name: tax_traces; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tax_traces (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid,
    tax_year character varying(9) NOT NULL,
    law_version character varying(32) NOT NULL,
    trace_hash character varying(64) NOT NULL,
    trace_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tax_traces OWNER TO hr;

--
-- Name: tds_calculations; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tds_calculations (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    taxable_income numeric(12,2) NOT NULL,
    annual_tax numeric(12,2) NOT NULL,
    remaining_tax numeric(12,2) NOT NULL,
    monthly_tds numeric(12,2) NOT NULL,
    regime_applied character varying(10) NOT NULL,
    law_version character varying(32) NOT NULL,
    salary_payment_date date,
    trace_hash character varying(64),
    tax_trace_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tds_calculations OWNER TO hr;

--
-- Name: tds_declarations; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tds_declarations (
    client_id uuid,
    employee_id uuid NOT NULL,
    financial_year character varying(9) NOT NULL,
    regime_preference character varying(10) NOT NULL,
    sec_80c numeric(12,2) NOT NULL,
    sec_80d numeric(12,2) NOT NULL,
    hra_claimed numeric(12,2) NOT NULL,
    other_deductions numeric(12,2) NOT NULL,
    is_finalized boolean NOT NULL,
    payload_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tds_declarations OWNER TO hr;

--
-- Name: tds_ledger; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tds_ledger (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid,
    tax_year character varying(9) NOT NULL,
    entry_type character varying(30) NOT NULL,
    amount numeric(12,2) NOT NULL,
    reconciliation_status character varying(20) NOT NULL,
    reference_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tds_ledger OWNER TO hr;

--
-- Name: tds_snapshots; Type: TABLE; Schema: tds_schema; Owner: hr
--

CREATE TABLE tds_schema.tds_snapshots (
    client_id uuid,
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    annual_tax numeric(12,2) NOT NULL,
    remaining_tax numeric(12,2) NOT NULL,
    monthly_tds numeric(12,2) NOT NULL,
    tax_trace_id uuid,
    law_version character varying(32) NOT NULL,
    regime character varying(10) NOT NULL,
    snapshot_json jsonb NOT NULL,
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE tds_schema.tds_snapshots OWNER TO hr;

--
-- Name: attendance_audit attendance_audit_pkey; Type: CONSTRAINT; Schema: attendance_schema; Owner: hr
--

ALTER TABLE ONLY attendance_schema.attendance_audit
    ADD CONSTRAINT attendance_audit_pkey PRIMARY KEY (id);


--
-- Name: attendance_months attendance_months_pkey; Type: CONSTRAINT; Schema: attendance_schema; Owner: hr
--

ALTER TABLE ONLY attendance_schema.attendance_months
    ADD CONSTRAINT attendance_months_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: attendance_schema; Owner: hr
--

ALTER TABLE ONLY attendance_schema.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: attendance_months uq_att_control_month; Type: CONSTRAINT; Schema: attendance_schema; Owner: hr
--

ALTER TABLE ONLY attendance_schema.attendance_months
    ADD CONSTRAINT uq_att_control_month UNIQUE (tenant_id, month);


--
-- Name: attendance_records uq_att_month; Type: CONSTRAINT; Schema: attendance_schema; Owner: hr
--

ALTER TABLE ONLY attendance_schema.attendance_records
    ADD CONSTRAINT uq_att_month UNIQUE (tenant_id, employee_id, month);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: audit_schema; Owner: hr
--

ALTER TABLE ONLY audit_schema.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: auth_schema; Owner: hr
--

ALTER TABLE ONLY auth_schema.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: auth_schema; Owner: hr
--

ALTER TABLE ONLY auth_schema.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: users uq_user_email; Type: CONSTRAINT; Schema: auth_schema; Owner: hr
--

ALTER TABLE ONLY auth_schema.users
    ADD CONSTRAINT uq_user_email UNIQUE (tenant_id, email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth_schema; Owner: hr
--

ALTER TABLE ONLY auth_schema.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: esi_contributions esi_contributions_pkey; Type: CONSTRAINT; Schema: compliance_schema; Owner: hr
--

ALTER TABLE ONLY compliance_schema.esi_contributions
    ADD CONSTRAINT esi_contributions_pkey PRIMARY KEY (id);


--
-- Name: pf_contributions pf_contributions_pkey; Type: CONSTRAINT; Schema: compliance_schema; Owner: hr
--

ALTER TABLE ONLY compliance_schema.pf_contributions
    ADD CONSTRAINT pf_contributions_pkey PRIMARY KEY (id);


--
-- Name: pt_deductions pt_deductions_pkey; Type: CONSTRAINT; Schema: compliance_schema; Owner: hr
--

ALTER TABLE ONLY compliance_schema.pt_deductions
    ADD CONSTRAINT pt_deductions_pkey PRIMARY KEY (id);


--
-- Name: client_portal_credentials client_portal_credentials_pkey; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.client_portal_credentials
    ADD CONSTRAINT client_portal_credentials_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: clients uq_client_code; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.clients
    ADD CONSTRAINT uq_client_code UNIQUE (tenant_id, client_code);


--
-- Name: client_portal_credentials uq_client_portal_type; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.client_portal_credentials
    ADD CONSTRAINT uq_client_portal_type UNIQUE (client_id, portal_type);


--
-- Name: employees uq_emp_code; Type: CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.employees
    ADD CONSTRAINT uq_emp_code UNIQUE (tenant_id, emp_code);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: notification_schema; Owner: hr
--

ALTER TABLE ONLY notification_schema.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payout_batches payout_batches_pkey; Type: CONSTRAINT; Schema: payout_schema; Owner: hr
--

ALTER TABLE ONLY payout_schema.payout_batches
    ADD CONSTRAINT payout_batches_pkey PRIMARY KEY (id);


--
-- Name: payout_transactions payout_transactions_pkey; Type: CONSTRAINT; Schema: payout_schema; Owner: hr
--

ALTER TABLE ONLY payout_schema.payout_transactions
    ADD CONSTRAINT payout_transactions_pkey PRIMARY KEY (id);


--
-- Name: payout_transactions uq_payout_idem; Type: CONSTRAINT; Schema: payout_schema; Owner: hr
--

ALTER TABLE ONLY payout_schema.payout_transactions
    ADD CONSTRAINT uq_payout_idem UNIQUE (idempotency_key);


--
-- Name: payroll_cycles payroll_cycles_pkey; Type: CONSTRAINT; Schema: payroll_schema; Owner: hr
--

ALTER TABLE ONLY payroll_schema.payroll_cycles
    ADD CONSTRAINT payroll_cycles_pkey PRIMARY KEY (id);


--
-- Name: payroll_results payroll_results_pkey; Type: CONSTRAINT; Schema: payroll_schema; Owner: hr
--

ALTER TABLE ONLY payroll_schema.payroll_results
    ADD CONSTRAINT payroll_results_pkey PRIMARY KEY (id);


--
-- Name: payroll_results uq_result_cycle_emp; Type: CONSTRAINT; Schema: payroll_schema; Owner: hr
--

ALTER TABLE ONLY payroll_schema.payroll_results
    ADD CONSTRAINT uq_result_cycle_emp UNIQUE (tenant_id, cycle_id, employee_id);


--
-- Name: blob_outbox blob_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.blob_outbox
    ADD CONSTRAINT blob_outbox_pkey PRIMARY KEY (id);


--
-- Name: blobs blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.blobs
    ADD CONSTRAINT blobs_pkey PRIMARY KEY (id);


--
-- Name: document_audit document_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.document_audit
    ADD CONSTRAINT document_audit_pkey PRIMARY KEY (id);


--
-- Name: document_registry document_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.document_registry
    ADD CONSTRAINT document_registry_pkey PRIMARY KEY (id);


--
-- Name: employee_documents employee_documents_object_key_key; Type: CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_object_key_key UNIQUE (object_key);


--
-- Name: employee_documents employee_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_pkey PRIMARY KEY (id);


--
-- Name: generated_reports generated_reports_pkey; Type: CONSTRAINT; Schema: reporting_schema; Owner: hr
--

ALTER TABLE ONLY reporting_schema.generated_reports
    ADD CONSTRAINT generated_reports_pkey PRIMARY KEY (id);


--
-- Name: salary_components salary_components_pkey; Type: CONSTRAINT; Schema: salary_schema; Owner: hr
--

ALTER TABLE ONLY salary_schema.salary_components
    ADD CONSTRAINT salary_components_pkey PRIMARY KEY (id);


--
-- Name: salary_structures salary_structures_pkey; Type: CONSTRAINT; Schema: salary_schema; Owner: hr
--

ALTER TABLE ONLY salary_schema.salary_structures
    ADD CONSTRAINT salary_structures_pkey PRIMARY KEY (id);


--
-- Name: salary_structures uq_struct_eff; Type: CONSTRAINT; Schema: salary_schema; Owner: hr
--

ALTER TABLE ONLY salary_schema.salary_structures
    ADD CONSTRAINT uq_struct_eff UNIQUE (tenant_id, employee_id, effective_from);


--
-- Name: declaration_versions declaration_versions_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.declaration_versions
    ADD CONSTRAINT declaration_versions_pkey PRIMARY KEY (id);


--
-- Name: employee_declarations employee_declarations_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.employee_declarations
    ADD CONSTRAINT employee_declarations_pkey PRIMARY KEY (id);


--
-- Name: employee_tax_profiles employee_tax_profiles_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.employee_tax_profiles
    ADD CONSTRAINT employee_tax_profiles_pkey PRIMARY KEY (id);


--
-- Name: form122 form122_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.form122
    ADD CONSTRAINT form122_pkey PRIMARY KEY (id);


--
-- Name: form16 form16_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.form16
    ADD CONSTRAINT form16_pkey PRIMARY KEY (id);


--
-- Name: proof_documents proof_documents_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.proof_documents
    ADD CONSTRAINT proof_documents_pkey PRIMARY KEY (id);


--
-- Name: tax_audit_log tax_audit_log_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tax_audit_log
    ADD CONSTRAINT tax_audit_log_pkey PRIMARY KEY (id);


--
-- Name: tax_computations tax_computations_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tax_computations
    ADD CONSTRAINT tax_computations_pkey PRIMARY KEY (id);


--
-- Name: tax_projections tax_projections_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tax_projections
    ADD CONSTRAINT tax_projections_pkey PRIMARY KEY (id);


--
-- Name: tax_regime_history tax_regime_history_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tax_regime_history
    ADD CONSTRAINT tax_regime_history_pkey PRIMARY KEY (id);


--
-- Name: tax_traces tax_traces_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tax_traces
    ADD CONSTRAINT tax_traces_pkey PRIMARY KEY (id);


--
-- Name: tds_calculations tds_calculations_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tds_calculations
    ADD CONSTRAINT tds_calculations_pkey PRIMARY KEY (id);


--
-- Name: tds_declarations tds_declarations_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tds_declarations
    ADD CONSTRAINT tds_declarations_pkey PRIMARY KEY (id);


--
-- Name: tds_ledger tds_ledger_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tds_ledger
    ADD CONSTRAINT tds_ledger_pkey PRIMARY KEY (id);


--
-- Name: tds_snapshots tds_snapshots_pkey; Type: CONSTRAINT; Schema: tds_schema; Owner: hr
--

ALTER TABLE ONLY tds_schema.tds_snapshots
    ADD CONSTRAINT tds_snapshots_pkey PRIMARY KEY (id);


--
-- Name: ix_attendance_audit_tenant_id; Type: INDEX; Schema: attendance_schema; Owner: hr
--

CREATE INDEX ix_attendance_audit_tenant_id ON attendance_schema.attendance_audit USING btree (tenant_id);


--
-- Name: ix_attendance_months_tenant_id; Type: INDEX; Schema: attendance_schema; Owner: hr
--

CREATE INDEX ix_attendance_months_tenant_id ON attendance_schema.attendance_months USING btree (tenant_id);


--
-- Name: ix_attendance_records_tenant_id; Type: INDEX; Schema: attendance_schema; Owner: hr
--

CREATE INDEX ix_attendance_records_tenant_id ON attendance_schema.attendance_records USING btree (tenant_id);


--
-- Name: ix_audit_schema_audit_logs_tenant_id; Type: INDEX; Schema: audit_schema; Owner: hr
--

CREATE INDEX ix_audit_schema_audit_logs_tenant_id ON audit_schema.audit_logs USING btree (tenant_id);


--
-- Name: ix_roles_tenant_id; Type: INDEX; Schema: auth_schema; Owner: hr
--

CREATE INDEX ix_roles_tenant_id ON auth_schema.roles USING btree (tenant_id);


--
-- Name: ix_tenants_tenant_id; Type: INDEX; Schema: auth_schema; Owner: hr
--

CREATE INDEX ix_tenants_tenant_id ON auth_schema.tenants USING btree (tenant_id);


--
-- Name: ix_users_tenant_id; Type: INDEX; Schema: auth_schema; Owner: hr
--

CREATE INDEX ix_users_tenant_id ON auth_schema.users USING btree (tenant_id);


--
-- Name: ix_esi_contributions_tenant_id; Type: INDEX; Schema: compliance_schema; Owner: hr
--

CREATE INDEX ix_esi_contributions_tenant_id ON compliance_schema.esi_contributions USING btree (tenant_id);


--
-- Name: ix_pf_contributions_tenant_id; Type: INDEX; Schema: compliance_schema; Owner: hr
--

CREATE INDEX ix_pf_contributions_tenant_id ON compliance_schema.pf_contributions USING btree (tenant_id);


--
-- Name: ix_pt_deductions_tenant_id; Type: INDEX; Schema: compliance_schema; Owner: hr
--

CREATE INDEX ix_pt_deductions_tenant_id ON compliance_schema.pt_deductions USING btree (tenant_id);


--
-- Name: ix_client_portal_credentials_client_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_client_portal_credentials_client_id ON employee_schema.client_portal_credentials USING btree (client_id);


--
-- Name: ix_client_portal_credentials_tenant_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_client_portal_credentials_tenant_id ON employee_schema.client_portal_credentials USING btree (tenant_id);


--
-- Name: ix_clients_tenant_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_clients_tenant_id ON employee_schema.clients USING btree (tenant_id);


--
-- Name: ix_departments_tenant_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_departments_tenant_id ON employee_schema.departments USING btree (tenant_id);


--
-- Name: ix_employees_client_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_employees_client_id ON employee_schema.employees USING btree (client_id);


--
-- Name: ix_employees_tenant_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_employees_tenant_id ON employee_schema.employees USING btree (tenant_id);


--
-- Name: ix_locations_tenant_id; Type: INDEX; Schema: employee_schema; Owner: hr
--

CREATE INDEX ix_locations_tenant_id ON employee_schema.locations USING btree (tenant_id);


--
-- Name: ix_notification_schema_notifications_tenant_id; Type: INDEX; Schema: notification_schema; Owner: hr
--

CREATE INDEX ix_notification_schema_notifications_tenant_id ON notification_schema.notifications USING btree (tenant_id);


--
-- Name: ix_payout_batches_tenant_id; Type: INDEX; Schema: payout_schema; Owner: hr
--

CREATE INDEX ix_payout_batches_tenant_id ON payout_schema.payout_batches USING btree (tenant_id);


--
-- Name: ix_payout_transactions_tenant_id; Type: INDEX; Schema: payout_schema; Owner: hr
--

CREATE INDEX ix_payout_transactions_tenant_id ON payout_schema.payout_transactions USING btree (tenant_id);


--
-- Name: ix_payroll_cycles_tenant_id; Type: INDEX; Schema: payroll_schema; Owner: hr
--

CREATE INDEX ix_payroll_cycles_tenant_id ON payroll_schema.payroll_cycles USING btree (tenant_id);


--
-- Name: ix_payroll_results_tenant_id; Type: INDEX; Schema: payroll_schema; Owner: hr
--

CREATE INDEX ix_payroll_results_tenant_id ON payroll_schema.payroll_results USING btree (tenant_id);


--
-- Name: idx_blobs_active; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_blobs_active ON public.blobs USING btree (tenant_id, uploaded_at) WHERE (is_deleted IS FALSE);


--
-- Name: idx_blobs_employee_category; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_blobs_employee_category ON public.blobs USING btree (tenant_id, employee_id, doc_category) WHERE (is_deleted = false);


--
-- Name: idx_blobs_verification; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_blobs_verification ON public.blobs USING btree (tenant_id, verification_status) WHERE (is_deleted = false);


--
-- Name: idx_doc_audit_blob; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_doc_audit_blob ON public.document_audit USING btree (blob_id, created_at);


--
-- Name: idx_doc_audit_employee; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_doc_audit_employee ON public.document_audit USING btree (tenant_id, employee_id, created_at);


--
-- Name: idx_emp_doc_category_active; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_emp_doc_category_active ON public.employee_documents USING btree (tenant_id, employee_id, doc_category) WHERE (deleted_at IS NULL);


--
-- Name: idx_emp_doc_verification; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_emp_doc_verification ON public.employee_documents USING btree (tenant_id, verification_status) WHERE (deleted_at IS NULL);


--
-- Name: idx_outbox_pending; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_outbox_pending ON public.blob_outbox USING btree (created_at) WHERE ((status)::text = 'PENDING'::text);


--
-- Name: idx_registry_cycle; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_registry_cycle ON public.document_registry USING btree (tenant_id, payroll_cycle_id, status);


--
-- Name: idx_registry_employee; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_registry_employee ON public.document_registry USING btree (tenant_id, employee_id, doc_type);


--
-- Name: idx_registry_month; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_registry_month ON public.document_registry USING btree (tenant_id, month, doc_type);


--
-- Name: idx_registry_tenant_type; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX idx_registry_tenant_type ON public.document_registry USING btree (tenant_id, doc_type);


--
-- Name: ix_blobs_doc_category; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_blobs_doc_category ON public.blobs USING btree (doc_category);


--
-- Name: ix_blobs_employee_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_blobs_employee_id ON public.blobs USING btree (employee_id);


--
-- Name: ix_blobs_tenant_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_blobs_tenant_id ON public.blobs USING btree (tenant_id);


--
-- Name: ix_blobs_uploaded_by; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_blobs_uploaded_by ON public.blobs USING btree (uploaded_by);


--
-- Name: ix_blobs_verification_status; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_blobs_verification_status ON public.blobs USING btree (verification_status);


--
-- Name: ix_document_audit_blob_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_audit_blob_id ON public.document_audit USING btree (blob_id);


--
-- Name: ix_document_audit_employee_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_audit_employee_id ON public.document_audit USING btree (employee_id);


--
-- Name: ix_document_audit_tenant_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_audit_tenant_id ON public.document_audit USING btree (tenant_id);


--
-- Name: ix_document_registry_doc_type; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_registry_doc_type ON public.document_registry USING btree (doc_type);


--
-- Name: ix_document_registry_employee_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_registry_employee_id ON public.document_registry USING btree (employee_id);


--
-- Name: ix_document_registry_payroll_cycle_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_registry_payroll_cycle_id ON public.document_registry USING btree (payroll_cycle_id);


--
-- Name: ix_document_registry_tenant_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_document_registry_tenant_id ON public.document_registry USING btree (tenant_id);


--
-- Name: ix_employee_documents_doc_category; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_employee_documents_doc_category ON public.employee_documents USING btree (doc_category);


--
-- Name: ix_employee_documents_employee_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_employee_documents_employee_id ON public.employee_documents USING btree (employee_id);


--
-- Name: ix_employee_documents_tenant_id; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_employee_documents_tenant_id ON public.employee_documents USING btree (tenant_id);


--
-- Name: ix_employee_documents_verification_status; Type: INDEX; Schema: public; Owner: hr
--

CREATE INDEX ix_employee_documents_verification_status ON public.employee_documents USING btree (verification_status);


--
-- Name: uq_emp_active_document; Type: INDEX; Schema: public; Owner: hr
--

CREATE UNIQUE INDEX uq_emp_active_document ON public.employee_documents USING btree (tenant_id, employee_id, doc_category, doc_label) WHERE (deleted_at IS NULL);


--
-- Name: ix_generated_reports_tenant_id; Type: INDEX; Schema: reporting_schema; Owner: hr
--

CREATE INDEX ix_generated_reports_tenant_id ON reporting_schema.generated_reports USING btree (tenant_id);


--
-- Name: ix_salary_components_tenant_id; Type: INDEX; Schema: salary_schema; Owner: hr
--

CREATE INDEX ix_salary_components_tenant_id ON salary_schema.salary_components USING btree (tenant_id);


--
-- Name: ix_salary_structures_tenant_id; Type: INDEX; Schema: salary_schema; Owner: hr
--

CREATE INDEX ix_salary_structures_tenant_id ON salary_schema.salary_structures USING btree (tenant_id);


--
-- Name: ix_declaration_versions_declaration_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_declaration_versions_declaration_id ON tds_schema.declaration_versions USING btree (declaration_id);


--
-- Name: ix_declaration_versions_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_declaration_versions_employee_id ON tds_schema.declaration_versions USING btree (employee_id);


--
-- Name: ix_declaration_versions_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_declaration_versions_tenant_id ON tds_schema.declaration_versions USING btree (tenant_id);


--
-- Name: ix_employee_declarations_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_employee_declarations_employee_id ON tds_schema.employee_declarations USING btree (employee_id);


--
-- Name: ix_employee_declarations_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_employee_declarations_tenant_id ON tds_schema.employee_declarations USING btree (tenant_id);


--
-- Name: ix_employee_tax_profiles_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_employee_tax_profiles_employee_id ON tds_schema.employee_tax_profiles USING btree (employee_id);


--
-- Name: ix_employee_tax_profiles_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_employee_tax_profiles_tenant_id ON tds_schema.employee_tax_profiles USING btree (tenant_id);


--
-- Name: ix_form122_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_form122_employee_id ON tds_schema.form122 USING btree (employee_id);


--
-- Name: ix_form122_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_form122_tenant_id ON tds_schema.form122 USING btree (tenant_id);


--
-- Name: ix_form16_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_form16_employee_id ON tds_schema.form16 USING btree (employee_id);


--
-- Name: ix_form16_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_form16_tenant_id ON tds_schema.form16 USING btree (tenant_id);


--
-- Name: ix_proof_documents_declaration_version_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_proof_documents_declaration_version_id ON tds_schema.proof_documents USING btree (declaration_version_id);


--
-- Name: ix_proof_documents_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_proof_documents_employee_id ON tds_schema.proof_documents USING btree (employee_id);


--
-- Name: ix_proof_documents_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_proof_documents_tenant_id ON tds_schema.proof_documents USING btree (tenant_id);


--
-- Name: ix_tax_audit_log_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_audit_log_employee_id ON tds_schema.tax_audit_log USING btree (employee_id);


--
-- Name: ix_tax_audit_log_event_type; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_audit_log_event_type ON tds_schema.tax_audit_log USING btree (event_type);


--
-- Name: ix_tax_audit_log_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_audit_log_tenant_id ON tds_schema.tax_audit_log USING btree (tenant_id);


--
-- Name: ix_tax_computations_cycle_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_computations_cycle_id ON tds_schema.tax_computations USING btree (cycle_id);


--
-- Name: ix_tax_computations_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_computations_employee_id ON tds_schema.tax_computations USING btree (employee_id);


--
-- Name: ix_tax_computations_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_computations_tenant_id ON tds_schema.tax_computations USING btree (tenant_id);


--
-- Name: ix_tax_projections_cycle_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_projections_cycle_id ON tds_schema.tax_projections USING btree (cycle_id);


--
-- Name: ix_tax_projections_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_projections_employee_id ON tds_schema.tax_projections USING btree (employee_id);


--
-- Name: ix_tax_projections_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_projections_tenant_id ON tds_schema.tax_projections USING btree (tenant_id);


--
-- Name: ix_tax_regime_history_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_regime_history_employee_id ON tds_schema.tax_regime_history USING btree (employee_id);


--
-- Name: ix_tax_regime_history_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_regime_history_tenant_id ON tds_schema.tax_regime_history USING btree (tenant_id);


--
-- Name: ix_tax_traces_cycle_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_traces_cycle_id ON tds_schema.tax_traces USING btree (cycle_id);


--
-- Name: ix_tax_traces_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_traces_employee_id ON tds_schema.tax_traces USING btree (employee_id);


--
-- Name: ix_tax_traces_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_traces_tenant_id ON tds_schema.tax_traces USING btree (tenant_id);


--
-- Name: ix_tax_traces_trace_hash; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tax_traces_trace_hash ON tds_schema.tax_traces USING btree (trace_hash);


--
-- Name: ix_tds_calculations_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_calculations_tenant_id ON tds_schema.tds_calculations USING btree (tenant_id);


--
-- Name: ix_tds_declarations_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_declarations_employee_id ON tds_schema.tds_declarations USING btree (employee_id);


--
-- Name: ix_tds_declarations_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_declarations_tenant_id ON tds_schema.tds_declarations USING btree (tenant_id);


--
-- Name: ix_tds_ledger_cycle_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_ledger_cycle_id ON tds_schema.tds_ledger USING btree (cycle_id);


--
-- Name: ix_tds_ledger_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_ledger_employee_id ON tds_schema.tds_ledger USING btree (employee_id);


--
-- Name: ix_tds_ledger_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_ledger_tenant_id ON tds_schema.tds_ledger USING btree (tenant_id);


--
-- Name: ix_tds_snapshots_cycle_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_snapshots_cycle_id ON tds_schema.tds_snapshots USING btree (cycle_id);


--
-- Name: ix_tds_snapshots_employee_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_snapshots_employee_id ON tds_schema.tds_snapshots USING btree (employee_id);


--
-- Name: ix_tds_snapshots_tenant_id; Type: INDEX; Schema: tds_schema; Owner: hr
--

CREATE INDEX ix_tds_snapshots_tenant_id ON tds_schema.tds_snapshots USING btree (tenant_id);


--
-- Name: roles roles_user_id_fkey; Type: FK CONSTRAINT; Schema: auth_schema; Owner: hr
--

ALTER TABLE ONLY auth_schema.roles
    ADD CONSTRAINT roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth_schema.users(id) ON DELETE CASCADE;


--
-- Name: client_portal_credentials client_portal_credentials_client_id_fkey; Type: FK CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.client_portal_credentials
    ADD CONSTRAINT client_portal_credentials_client_id_fkey FOREIGN KEY (client_id) REFERENCES employee_schema.clients(id) ON DELETE CASCADE;


--
-- Name: employees employees_department_id_fkey; Type: FK CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.employees
    ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES employee_schema.departments(id);


--
-- Name: employees employees_location_id_fkey; Type: FK CONSTRAINT; Schema: employee_schema; Owner: hr
--

ALTER TABLE ONLY employee_schema.employees
    ADD CONSTRAINT employees_location_id_fkey FOREIGN KEY (location_id) REFERENCES employee_schema.locations(id);


--
-- Name: payout_transactions payout_transactions_batch_id_fkey; Type: FK CONSTRAINT; Schema: payout_schema; Owner: hr
--

ALTER TABLE ONLY payout_schema.payout_transactions
    ADD CONSTRAINT payout_transactions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES payout_schema.payout_batches(id) ON DELETE CASCADE;


--
-- Name: payroll_results payroll_results_cycle_id_fkey; Type: FK CONSTRAINT; Schema: payroll_schema; Owner: hr
--

ALTER TABLE ONLY payroll_schema.payroll_results
    ADD CONSTRAINT payroll_results_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES payroll_schema.payroll_cycles(id) ON DELETE CASCADE;


--
-- Name: document_registry document_registry_extracted_blob_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.document_registry
    ADD CONSTRAINT document_registry_extracted_blob_id_fkey FOREIGN KEY (extracted_blob_id) REFERENCES public.blobs(id);


--
-- Name: document_registry document_registry_raw_blob_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: hr
--

ALTER TABLE ONLY public.document_registry
    ADD CONSTRAINT document_registry_raw_blob_id_fkey FOREIGN KEY (raw_blob_id) REFERENCES public.blobs(id);


--
-- Name: salary_components salary_components_structure_id_fkey; Type: FK CONSTRAINT; Schema: salary_schema; Owner: hr
--

ALTER TABLE ONLY salary_schema.salary_components
    ADD CONSTRAINT salary_components_structure_id_fkey FOREIGN KEY (structure_id) REFERENCES salary_schema.salary_structures(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict qXhGFFeBbumydpIKe98FtONhP1IP4DcAtSlk07ico8MnkCzvql8Gkmglh5K5LAO

