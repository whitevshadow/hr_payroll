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
  }) => api.post<SalaryStructure>("/salary/structures", body).then((r) => r.data),

  revise: (
    structureId: string,
    body: { ctc: number; effective_from: string; work_location?: string | null }
  ) =>
    api
      .put<SalaryStructure>(`/salary/structures/${structureId}/revise`, body)
      .then((r) => r.data),
};
