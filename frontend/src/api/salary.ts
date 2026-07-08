import api from "../lib/api";
import type { SalaryStructure } from "../types";

export const salaryApi = {
  getActive: (employeeId: string) =>
    api
      .get<SalaryStructure>(`/salary/structures/${employeeId}`)
      .then((r) => r.data),

  create: (body: {
    employee_id: string;
    ctc: number;
    effective_from: string;
    work_location?: string | null;
    template_id?: string | null;
  }) => api.post<SalaryStructure>("/salary/structures", body).then((r) => r.data),

  revise: (
    structureId: string,
    body: { ctc: number; effective_from: string; work_location?: string | null; template_id?: string | null }
  ) =>
    api
      .put<SalaryStructure>(`/salary/structures/${structureId}/revise`, body)
      .then((r) => r.data),

  getTemplates: (client_id?: string) =>
    api
      .get<any[]>("/salary/templates", { params: { client_id } })
      .then((r) => r.data),

  createTemplate: (body: any) =>
    api.post<any>("/salary/templates", body).then((r) => r.data),
};
