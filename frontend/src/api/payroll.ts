import api from "../lib/api";
import type {
  AuditEvent,
  CycleSummaryResponse,
  PayrollCycle,
  PayrollResult,
  RunSummary,
} from "../types";

export const payrollApi = {
  listCycles: (client_id?: string, financial_year?: string) => 
    api.get<PayrollCycle[]>("/payroll/cycles", { params: { client_id, financial_year } }).then((r) => r.data),

  getCycle: (id: string) =>
    api.get<PayrollCycle>(`/payroll/cycles/${id}`).then((r) => r.data),

  createCycle: (body: {
    name: string;
    client_id?: string | null;
    financial_year?: string | null;
    period_start: string;
    period_end: string;
    is_dry_run?: boolean;
  }) => api.post<PayrollCycle>("/payroll/cycles", body).then((r) => r.data),

  runCycle: (id: string) =>
    api.post<RunSummary>(`/payroll/cycles/${id}/run`).then((r) => r.data),

  approveCycle: (id: string) =>
    api.post(`/payroll/cycles/${id}/approve`).then((r) => r.data),

  getCycleSummary: (id: string) =>
    api
      .get<CycleSummaryResponse>(`/payroll/cycles/${id}/summary`)
      .then((r) => r.data),

  getResult: (cycleId: string, employeeId: string) =>
    api
      .get<PayrollResult>(`/payroll/results/${cycleId}/${employeeId}`)
      .then((r) => r.data),

  getAudit: (params?: { event_type?: string; limit?: number }) =>
    api.get<AuditEvent[]>("/audit", { params }).then((r) => r.data),

  importRegister: (cycleId: string, mode: ImportRegisterMode, rows: ImportRegisterRow[]) =>
    api
      .post<RunSummary>(`/payroll/cycles/${cycleId}/import-register`, { mode, rows })
      .then((r) => r.data),
};

/** "prefilled": the sheet's deduction/net figures are stored as-is.
 *  "compute": backend derives PF/ESI/PT and net pay from the earnings. */
export type ImportRegisterMode = "prefilled" | "compute";

export interface ImportRegisterRow {
  employee_id: string;
  present_days?: number | null;
  holiday_days?: number | null;
  wo_days?: number | null;
  total_days: number;
  basic: number;
  da?: number;
  hra?: number;
  bonus?: number;
  gross: number;
  employee_esi?: number;
  employee_pf?: number;
  pt?: number;
  total_deductions?: number | null;
  net_pay?: number | null;
}
