import api from "../lib/api";

// ─── Trace types (matches logic.py trace dict exactly) ────────────────────────
export interface SlabBreakdownRow {
  slab_from: string;
  slab_to: string;       // "inf" or numeric string
  rate: string;
  income_portion: string;
  tax_generated: string;
}

export interface TaxTrace {
  law: {
    law_id: string;
    law_name: string;
    version: string;
    forms: string[];
    section_mappings: Record<string, string>;
    salary_payment_date: string;
  };
  regime: string;
  declaration_version_id: string | null;
  projected_income: Record<string, string>;
  projected_annual_income: string;
  exemptions: Record<string, string>;
  deductions: Record<string, string>;
  taxable_income: string;
  slab_breakdown: SlabBreakdownRow[];
  slabs: SlabBreakdownRow[];
  tax_before_rebate: string;
  rebate: { amount: string; threshold: string | null };
  surcharge: { amount: string; trace: unknown[] };
  relief: { section_89: string };
  cess: { rate: string; amount: string };
  annual_tax: string;
  monthly_allocation: {
    annual_tax_liability: string;
    current_employer_tds: string;
    previous_employer_tds: string;
    remaining_tax: string;
    remaining_payroll_months: number;
    monthly_tds: string;
  };
  hash?: string;
  // Legacy shape used by the old flat-struct response (V1 calc endpoint)
  std_deduction?: string;
  cess_rate?: string;
}

export interface TDSComputeResponse {
  employee_id: string;
  cycle_id: string;
  taxable_income: string;
  annual_tax: string;
  remaining_tax: string;
  monthly_tds: string;
  regime_applied: string;
  law_version: string;
  salary_payment_date: string;
  trace_hash: string;
  tax_trace: TaxTrace;
}

export interface TDSDeclaration {
  id: string;
  employee_id: string;
  financial_year: string;
  regime_preference: string;
  sec_80c: string;
  sec_80d: string;
  hra_claimed: string;
  other_deductions: string;
  is_finalized: boolean;
  note?: string;
}

export interface DeclarationV2Payload {
  employee_id: string;
  tax_year: string;
  payload: Record<string, unknown>;
  change_reason?: string;
}

export interface TDSOverviewResponse {
  employee_overview: {
    annual_gross: string;
    total_deductions: string;
    taxable_income: string;
    annual_tax: string;
    remaining_tax: string;
    monthly_tds: string;
    effective_rate: string;
    recommended_regime: string;
  };
  new_regime: {
    annual_tax: string;
    monthly_tds: string;
    taxable_income: string;
    effective_rate: string;
    tax_trace: TaxTrace;
  };
  old_regime: {
    annual_tax: string;
    monthly_tds: string;
    taxable_income: string;
    effective_rate: string;
    tax_trace: TaxTrace;
  };
  savings: string;
  recommended: string;
  remaining_months: number;
  alerts: { type: string; section: string; message: string }[];
  salary: {
    ctc: string;
    basic_monthly: string;
    hra_monthly: string;
    is_metro: boolean;
    epf_annual: string;
  };
  declaration_payload: Record<string, unknown>;
  tax_year: string;
}

export interface TDSDeclarationResponse {
  employee_id: string;
  tax_year: string;
  has_declaration: boolean;
  declaration_json: Record<string, unknown>;
  status: string | null;
  version: number;
  submitted_at?: string | null;
}

export const tdsApi = {
  getCalculation: (cycleId: string, empId: string) =>
    api
      .get<TDSComputeResponse>(`/tds/calculations/${cycleId}/${empId}`)
      .then((r) => r.data),

  getOverview: (employeeId: string) =>
    api
      .get<TDSOverviewResponse>(`/tds/overview/${employeeId}`)
      .then((r) => r.data),

  getDeclarations: (employeeId: string) =>
    api
      .get<TDSDeclarationResponse>(`/tds/declarations/${employeeId}`)
      .then((r) => r.data),

  compute: (body: {
    employee_id: string;
    cycle_id: string;
    salary_payment_date?: string;
    monthly_gross: number;
    fixed_pay?: number;
    bonus?: number;
    variable_pay?: number;
    remaining_payroll_months?: number;
    tax_regime: "OLD" | "NEW" | "DEFAULT";
    declarations?: Record<string, number>;
    approved_proofs?: Record<string, boolean>;
    current_employer_tds?: number;
  }) =>
    api.post<TDSComputeResponse>("/tds/compute", body).then((r) => r.data),

  submitDeclaration: (body: {
    employee_id: string;
    financial_year?: string;
    regime_preference?: string;
    sec_80c?: number;
    sec_80d?: number;
    hra_claimed?: number;
    other_deductions?: number;
  }) => api.post<TDSDeclaration>("/tds/declarations", body).then((r) => r.data),

  submitDeclarationV2: (body: DeclarationV2Payload) =>
    api.post("/tds/declarations/v2", body).then((r) => r.data),

  listLaws: () =>
    api.get<{ versions: string[] }>("/tds/laws").then((r) => r.data),
};
