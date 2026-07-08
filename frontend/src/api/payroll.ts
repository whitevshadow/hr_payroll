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
};
