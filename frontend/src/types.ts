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
  /** Drives the Maharashtra PT exemption for women earning up to Rs 25,000
   *  (compliance-service compute_pt). The API has always stored it, but the
   *  employee form had no field for it, so anyone not added by bulk import
   *  was left null and over-deducted Rs 200 a month. */
  gender: string | null;
  pan_number: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  uan_number: string | null;
  /** ESIC Insured Person number, 10 digits. Returned unmasked, unlike the
   *  other identifiers — it is printed on every monthly contribution return
   *  filed with ESIC, so masking it would block that filing. */
  ip_number: string | null;
  aadhaar_number: string;
  status: "ACTIVE" | "INACTIVE" | "SEPARATED";
  joining_date: string | null;
  /** Last working day. Goes on the employee's final ESIC return — without it
   *  ESIC keeps expecting contributions for them. */
  exit_date: string | null;
  department_id: string | null;
  designation: string | null;
  location_id: string | null;
  work_location: string | null;
  city: string | null;
  state: string | null;
  branch: string | null;
  client_id: string | null;
  reporting_manager_id: string | null;
  // Daily-wage configuration: DAILY employees are paid from a client rate card.
  wage_type?: "MONTHLY" | "DAILY";
  daily_rate_card_id?: string | null;
  daily_rate_card?: DailyRateCard | null;   // resolved, read-only
}

/** Client-level MONTHLY wage components shared by daily-rated employees.
 *  Payroll derives the day rate per cycle as monthly / days in that month. */
export interface DailyRateCard {
  id: string;
  client_id: string | null;
  /** Department this card prices. Null only on cards created before rate
   *  cards were classified by department — the form requires one on save. */
  department_id: string | null;
  name: string;
  monthly_basic: string;
  monthly_da: string;
  monthly_hra: string;
  bonus_pct: string;
  is_active: boolean;
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
/** Registration numbers, keyed as the API stores them.
 *  This is the store of record — the client form's flat inputs are mapped into
 *  and out of this object, because the API accepts nothing else. */
export interface StatutoryIds {
  gst: string | null;
  pan: string | null;
  tan: string | null;
  cin: string | null;
  pf_code: string | null;        // EPFO establishment code
  esic_code: string | null;      // ESIC employer code
  pt_number: string | null;      // Professional Tax (PTRC/PTEC)
  lwf: string | null;            // Labour Welfare Fund establishment code
  labour_license: string | null;
  shop_act: string | null;
  msme: string | null;
}
export interface ClientAddress {
  line1: string | null;
  line2: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
}
export interface ClientContact {
  person: string | null;
  email: string | null;
  mobile: string | null;
  telephone: string | null;
  website: string | null;
}
export interface Client {
  id: string;
  client_code: string;
  client_name: string;
  legal_name: string | null;
  industry: string | null;
  // Nested objects are what the API actually returns and the only shape it
  // accepts on write. Flat equivalents were declared here once but the server
  // never sent them, so every read of one silently yielded undefined.
  address: ClientAddress | null;
  contact: ClientContact | null;
  statutory_ids: StatutoryIds | null;
  // Genuinely returned flat, for backward compatibility, alongside the nested copy.
  city: string | null;
  state: string | null;
  gst_number: string | null;
  pan_number: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_mobile: string | null;
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
/** What the API accepts on write. Deliberately not derived from `Client`: the
 *  read shape carries flat backward-compat copies that the server ignores on
 *  write, and sending them looks like it works while the values are dropped. */
export interface ClientWrite {
  client_code?: string;
  client_name: string;
  legal_name?: string;
  industry?: string;
  address?: Partial<ClientAddress>;
  contact?: Partial<ClientContact>;
  statutory_ids?: Partial<StatutoryIds>;
}
export type ClientCreate = ClientWrite;
export type ClientUpdate = Partial<ClientWrite>;
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

/** Earnings differ by wage type: a monthly CTC result splits into basic / HRA /
 *  special allowance, while a daily-wage or register-imported result carries DA
 *  and a monthly bonus instead. Only basic, HRA and gross appear in both. */
export interface BreakdownEarnings {
  basic: string;
  hra: string;
  gross: string;
  /** Monthly (CTC-derived) results only. */
  special_allowance?: string;
  /** Daily-wage and register-import results only. */
  da?: string;
  bonus?: string;
}
export interface BreakdownDeductions {
  employee_pf: string;
  employee_esi: string;
  pt: string;
  tds: string;
  lop: string;
  other: string;
  /** Labour Welfare Fund — charged only in the state's contribution months
   *  (June and December for Maharashtra), so absent from every other cycle. */
  lwf?: string;
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
  // Daily-wage results only
  wage_type?: "DAILY";
  daily_rates?: {
    card_name?: string;
    basic: string; da: string; hra: string;   // derived per cycle
    bonus_pct: string;
    days_in_month?: string;
    monthly_basic?: string; monthly_da?: string; monthly_hra?: string;
  };
  warnings?: string[];
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
