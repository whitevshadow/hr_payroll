import api from "../lib/api";
import type { AttendanceRecord } from "../types";

export type AttendanceStatus = "DRAFT" | "VALIDATED" | "LOCKED";

export interface AttendanceMonthControl {
  id: string;
  month: string;
  status: AttendanceStatus;
  total_employees: number;
  employees_with_lop: number;
  completion_pct: string;
  validated_by: string | null;
  validated_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  locked_reason: string | null;
  unlocked_by: string | null;
  unlocked_at: string | null;
  unlock_reason: string | null;
}

export interface AttendanceRecordFull extends AttendanceRecord {
  cl_days: string;
  sl_days: string;
  pl_days: string;
  wo_days: string;
  holiday_days: string;
  wfh_days: string;
  overtime_hours: string;
  attendance_pct: string;
}

export interface MonthlyListResponse {
  month_control: AttendanceMonthControl | null;
  records: AttendanceRecordFull[];
}

export interface BulkRecord {
  employee_id: string;
  total_days: number;
  present_days: number;
  cl_days?: number;
  sl_days?: number;
  pl_days?: number;
  wo_days?: number;
  holiday_days?: number;
  wfh_days?: number;
  overtime_hours?: number;
}

export const attendanceApi = {
  /** Get single employee record (YYYY-MM format). */
  get: (employeeId: string, month: string) =>
    api
      .get<AttendanceRecord>(`/attendance/${employeeId}/${month}`)
      .then((r) => r.data),

  /** Upsert one employee's monthly summary. */
  upsert: (body: {
    employee_id: string;
    month: string;
    total_days: number;
    present_days: number;
    cl_days?: number;
    sl_days?: number;
    pl_days?: number;
    wo_days?: number;
    holiday_days?: number;
    wfh_days?: number;
    overtime_hours?: number;
  }) =>
    api
      .post<AttendanceRecordFull>("/attendance/manual", body)
      .then((r) => r.data),

  /** Bulk upsert from Excel import or copy-paste. */
  bulkUpsert: (body: { month: string; records: BulkRecord[]; source?: string }) =>
    api
      .post<{ created: number; updated: number; month: string; source: string }>(
        "/attendance/bulk",
        body
      )
      .then((r) => r.data),

  /** Get all records + month control for a month (YYYY-MM). */
  getMonthly: (month: string) =>
    api
      .get<MonthlyListResponse>(`/attendance/monthly/${month}`)
      .then((r) => r.data),

  /** Get month status only (creates DRAFT if not exists). */
  getMonthStatus: (month: string) =>
    api
      .get<AttendanceMonthControl>(`/attendance/monthly/${month}/status`)
      .then((r) => r.data),

  /** Mark month as VALIDATED. */
  validate: (month: string) =>
    api
      .post<AttendanceMonthControl>(`/attendance/monthly/${month}/validate`)
      .then((r) => r.data),

  /** Lock the month — makes attendance immutable. */
  lock: (month: string, reason?: string) =>
    api
      .post<AttendanceMonthControl>(`/attendance/monthly/${month}/lock`, { reason })
      .then((r) => r.data),

  /** Unlock the month — admin only. */
  unlock: (month: string, reason: string) =>
    api
      .post<AttendanceMonthControl>(`/attendance/monthly/${month}/unlock`, { reason })
      .then((r) => r.data),
};
