import api from "../lib/api";

export interface TDSCalculation {
  employee_id: string;
  cycle_id: string;
  taxable_income: string;
  annual_tax: string;
  monthly_tds: string;
  regime_applied: string;
  tax_trace: {
    std_deduction: string;
    cess_rate: string;
    slabs: Array<{
      slab_from: string;
      slab_to: string;
      rate: string;
      taxable_in_slab: string;
      tax: string;
    }>;
  };
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

export const tdsApi = {
  getCalculation: (cycleId: string, empId: string) =>
    api.get<TDSCalculation>(`/tds/calculations/${cycleId}/${empId}`).then((r) => r.data),

  submitDeclaration: (body: {
    employee_id: string;
    financial_year?: string;
    regime_preference?: string;
    sec_80c?: number;
    sec_80d?: number;
    hra_claimed?: number;
    other_deductions?: number;
  }) => api.post<TDSDeclaration>("/tds/declarations", body).then((r) => r.data),
};
