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
  status: "ACTIVE" | "INACTIVE" | "SEPARATED";
  joining_date: string | null;
  department_id: string | null;
  designation: string | null;
  work_location: string | null;
}
export interface EmployeePage {
  items: Employee[];
  total: number;
  page: number;
  page_size: number;
}
export type EmployeeCreate = Omit<Employee, "id">;
export type EmployeeUpdate = Partial<Omit<Employee, "id" | "emp_code">>;

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
