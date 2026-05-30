import api from "../lib/api";
import type { AttendanceRecord } from "../types";

export const attendanceApi = {
  /** month: "YYYY-MM" */
  get: (employeeId: string, month: string) =>
    api
      .get<AttendanceRecord>(`/attendance/${employeeId}/${month}`)
      .then((r) => r.data),

  /** month should be "YYYY-MM-01" (first of month) */
  upsert: (body: {
    employee_id: string;
    month: string;
    total_days: number;
    present_days: number;
  }) => api.post<AttendanceRecord>("/attendance/manual", body).then((r) => r.data),
};
