// ---- Auth ---------------------------------------------------------------
export interface LoginResponse {
  access_token: string;
  token_type: string;
}
export interface Me {
  user_id: string;
  tenant_id: string;
  email: string;
  roles: string[];
}

// ---- Employees ----------------------------------------------------------
export interface Department {
  id: string;
  name: string;
  cost_center: string | null;
}
export interface Employee {
  id: string;
  emp_code: string;
  first_name: string;
  last_name: string;
  email: string | null;
  pan_number: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  uan_number: string | null;
  aadhaar_number: string;
  status: "ACTIVE" | "INACTIVE" | "SEPARATED";
  joining_date: string | null;
  department_id: string | null;
  designation: string | null;
  location_id: string | null;
  work_location: string | null;
  city: string | null;
  state: string | null;
  branch: string | null;
  client_id: string | null;
  reporting_manager_id: string | null;
}
export interface Location {
  id: string;
  location_name: string;
  city: string;
  state: string;
  country: string;
}
export interface EmployeePage {
  items: Employee[];
  total: number;
  page: number;
  page_size: number;
}
export type EmployeeCreate = Omit<Employee, "id">;
export type EmployeeUpdate = Partial<Omit<Employee, "id" | "emp_code">>;

// ---- Leaves -----------------------------------------------------------------
export interface LeavePolicy {
  id: string;
  name: string;
  description: string | null;
  leave_type: "CASUAL" | "SICK" | "EARNED" | "UNPAID" | "MATERNITY" | "PATERNITY" | "COMPENSATORY";
  annual_allowance: number;
  max_consecutive_days: number | null;
  requires_document_after_days: number | null;
  is_active: boolean;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  policy_id: string;
  financial_year: string;
  total_accrued: number;
  total_used: number;
  balance: number;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  policy_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  workflow_instance_id: string | null;
  document_id: string | null;
  reviewer_id: string | null;
  rejection_reason: string | null;
}

// ---- Documents --------------------------------------------------------------
export interface EmployeeDocument {
  id: string;
  tenant_id: string;
  employee_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  doc_category: string;
  doc_label: string;
  description: string | null;
  verification_status: "PENDING" | "VERIFIED" | "REJECTED";
  rejection_reason: string | null;
  uploaded_by: string;
  uploaded_at: string;
  verified_by: string | null;
  verified_at: string | null;
}

// ---- Clients ----------------------------------------------------------------
export interface Client {
  id: string;
  client_code: string;
  client_name: string;
  legal_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string;
  pincode: string | null;
  gst_number: string | null;
  pan_number: string | null;
  tan_number: string | null;
  cin_number: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_mobile: string | null;
  contact_telephone: string | null;
  pf_establishment_code: string | null;
  esic_employer_code: string | null;
  professional_tax_number: string | null;
  labour_license_number: string | null;
  shop_act_number: string | null;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  created_at: string;
  updated_at: string;
}
export interface ClientPage {
  items: Client[];
  total: number;
  page: number;
  page_size: number;
}
export type ClientCreate = Omit<Client, "id" | "status" | "created_at" | "updated_at">;
export type ClientUpdate = Partial<Omit<Client, "id" | "client_code" | "status" | "created_at" | "updated_at">>;
export interface ClientCredential {
  id: string;
  client_id: string;
  portal_type: "PF" | "ESIC" | "GST";
  portal_name: string | null;
  username: string | null;
  has_password: boolean;
  last_rotated_at: string | null;
}
export interface CredentialReveal {
  id: string;
  portal_type: string;
  username: string | null;
  password: string | null;
}

export interface ClientDocument {
  id: string;
  client_id: string;
  blob_id: string;
  doc_category: string;
  doc_label: string;
  description?: string;
  expiry_date?: string;
  version: number;
  verification_status: "PENDING" | "APPROVED" | "REJECTED";
  verified_by?: string;
  verified_at?: string;
  verification_comment?: string;
  created_at: string;
  updated_at: string;
}

// ---- Salary -------------------------------------------------------------
export interface SalaryBreakdown {
  monthly_gross: string;
  basic: string;
  hra: string;
  special_allowance: string;
  is_metro: boolean;
}
export interface SalaryComponent {
  component_name: string;
  amount: string;
  component_type: string;
  is_taxable: boolean;
}
export interface SalaryStructure {
  id: string;
  employee_id: string;
  ctc: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  work_location: string | null;
  components: SalaryComponent[];
  breakdown: SalaryBreakdown;
  template_id?: string;
}
export interface SalaryTemplate {
  id: string;
  client_id?: string | null;
  template_name: string;
  description: string;
  is_active: boolean;
  template_components: SalaryComponent[];
}

// ---- Attendance ---------------------------------------------------------
export interface AttendanceRecord {
  id: string;
  employee_id: string;
  month: string;
  total_days: number;
  present_days: string;
  lop_days: string;
  payable_days: string;
  is_finalized: boolean;
  daily_status?: string;
  leave_breakdown?: Record<string, number>;
}

// ---- Payroll ------------------------------------------------------------
export type CycleStatus =
  | "DRAFT"
  | "LOCKED"
  | "COMPUTING"
  | "COMPUTED"
  | "APPROVED"
  | "DISBURSED"
  | "FAILED";

export interface PayrollCycle {
  id: string;
  name: string;
  client_id?: string | null;
  financial_year?: string | null;
  period_start: string;
  period_end: string;
  status: CycleStatus;
  is_dry_run: boolean;
  created_by: string | null;
  approved_by: string | null;
  trace_id: string | null;
}

export interface BreakdownEarnings {
  basic: string;
  hra: string;
  special_allowance: string;
  gross: string;
}
export interface BreakdownDeductions {
  employee_pf: string;
  employee_esi: string;
  pt: string;
  tds: string;
  lop: string;
  other: string;
}
export interface BreakdownEmployerContrib {
  employer_eps: string;
  employer_epf: string;
  employer_esi: string;
}
export interface BreakdownAttendance {
  total_days: number;
  payable_days: string;
  lop_days: string;
}
export interface BreakdownEmployee {
  emp_code?: string;
  name?: string;
  pan?: string;
  bank_account?: string;
  designation?: string;
  work_location?: string;
}
export interface BreakdownJson {
  employee?: BreakdownEmployee;
  earnings: BreakdownEarnings;
  deductions: BreakdownDeductions;
  employer_contrib: BreakdownEmployerContrib;
  attendance: BreakdownAttendance;
  tds_trace?: Record<string, unknown>;
  net_pay: string;
}

export interface PayrollResult {
  id: string;
  cycle_id: string;
  employee_id: string;
  gross_earnings: string;
  total_deductions: string;
  net_pay: string;
  breakdown_json: BreakdownJson;
  status: "COMPUTED" | "APPROVED" | "PAID" | "FAILED";
  error: string | null;
}

export interface RunSummary {
  cycle_id: string;
  status: string;
  total_employees: number;
  computed: number;
  failed: number;
  errors: string[];
}

export interface CycleSummaryResponse {
  cycle: PayrollCycle;
  results: PayrollResult[];
  totals: {
    gross: string;
    deductions: string;
    net: string;
    count: number;
  };
}

// ---- Payout -------------------------------------------------------------
export interface PayoutBatch {
  id: string;
  cycle_id: string;
  batch_type: string;
  total_amount: string;
  status: string;
}
export interface PayoutTransaction {
  id: string;
  employee_id: string;
  amount: string;
  status: string;
  bank_reference: string | null;
  idempotency_key: string;
}

// ---- Audit --------------------------------------------------------------
export interface AuditEvent {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  trace_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
