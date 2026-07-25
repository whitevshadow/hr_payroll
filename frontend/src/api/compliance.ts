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
    total_employee_lwf: string;
    total_employer_lwf: string;
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
  lwf: Array<{
    employee_id: string;
    state: string;
    employee_lwf: string;
    employer_lwf: string;
  }>;
}

export interface ComplianceSetting {
  id: string;
  client_id: string | null;
  state: string;
  pf_enabled: boolean;
  pf_employer_rate: number;
  pf_employee_rate: number;
  pf_wage_limit: number;
  esi_enabled: boolean;
  esi_employer_rate: number;
  esi_employee_rate: number;
  esi_wage_limit: number;
  pt_enabled: boolean;
  lwf_enabled: boolean;
  bonus_enabled: boolean;
  gratuity_enabled: boolean;
}

export const complianceApi = {
  getSummary: (cycleId: string) =>
    api.get<ComplianceSummary>(`/compliance/summary/${cycleId}`).then((r) => r.data),
    
  getSettings: (client_id?: string) => 
    api.get<ComplianceSetting[]>("/compliance/settings", { params: { client_id } }).then((r) => r.data),
    
  createSetting: (body: Partial<ComplianceSetting>) => 
    api.post<ComplianceSetting>("/compliance/settings", body).then((r) => r.data),
};
