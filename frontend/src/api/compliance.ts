import api from "../lib/api";

export interface ComplianceSummary {
  cycle_id: string;
  totals: {
    total_employee_pf: string;
    total_employer_pf: string;
    total_employer_eps: string;
    total_employee_esi: string;
    total_employer_esi: string;
    total_pt: string;
    ceiling_applied_count: number;
    esi_eligible_count: number;
  };
  pf: Array<{
    employee_id: string;
    pf_wages: string;
    employee_pf: string;
    employer_eps: string;
    employer_epf: string;
    is_ceiling_applied: boolean;
  }>;
  esi: Array<{
    employee_id: string;
    gross_wages: string;
    is_esi_eligible: boolean;
    employee_esi: string;
    employer_esi: string;
  }>;
  pt: Array<{
    employee_id: string;
    state: string;
    pt_amount: string;
  }>;
}

export const complianceApi = {
  getSummary: (cycleId: string) =>
    api.get<ComplianceSummary>(`/compliance/summary/${cycleId}`).then((r) => r.data),
};
