import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────
const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const decimalStr = z.string().regex(/^\d+(\.\d+)?$/, "Must be a numeric string");

// ── Employee ──────────────────────────────────────────────────────────────
export const EmployeeSchema = z.object({
  id: z.string().uuid(),
  emp_code: z.string().min(1).max(32),
  first_name: z.string().min(1).max(128),
  last_name: z.string().min(1).max(128),
  email: z.string().email().nullable(),
  pan_number: z.string().regex(panRegex).nullable(),
  bank_account: z.string().nullable(),
  bank_ifsc: z.string().regex(ifscRegex).nullable(),
  uan_number: z.string().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "SEPARATED"]),
  joining_date: z.string().nullable(),
  department_id: z.string().uuid().nullable(),
  designation: z.string().nullable(),
  location_id: z.string().uuid().nullable(),
  work_location: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  branch: z.string().nullable(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const EmployeePageSchema = z.object({
  items: z.array(EmployeeSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

export const EmployeeCreateSchema = EmployeeSchema.omit({ id: true });
export type EmployeeCreate = z.infer<typeof EmployeeCreateSchema>;

// ── Department ────────────────────────────────────────────────────────────
export const DepartmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  cost_center: z.string().nullable(),
});
export type Department = z.infer<typeof DepartmentSchema>;

// ── Payroll Cycle ─────────────────────────────────────────────────────────
export const CycleStatusSchema = z.enum([
  "DRAFT", "LOCKED", "COMPUTING", "COMPUTED", "APPROVED", "DISBURSED", "FAILED",
]);
export type CycleStatus = z.infer<typeof CycleStatusSchema>;

export const PayrollCycleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  status: CycleStatusSchema,
  is_dry_run: z.boolean(),
  created_by: z.string().nullable(),
  approved_by: z.string().nullable(),
  trace_id: z.string().nullable(),
});
export type PayrollCycle = z.infer<typeof PayrollCycleSchema>;

// ── Payroll Result ────────────────────────────────────────────────────────
export const PayrollResultSchema = z.object({
  id: z.string().uuid(),
  cycle_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  gross_earnings: decimalStr,
  total_deductions: decimalStr,
  net_pay: decimalStr,
  breakdown_json: z.record(z.string(), z.unknown()),
  status: z.enum(["COMPUTED", "APPROVED", "PAID", "FAILED"]),
  error: z.string().nullable(),
});
export type PayrollResult = z.infer<typeof PayrollResultSchema>;

export const CycleSummarySchema = z.object({
  cycle: PayrollCycleSchema,
  results: z.array(PayrollResultSchema),
  totals: z.object({
    gross: decimalStr,
    deductions: decimalStr,
    net: decimalStr,
    count: z.number().int().nonnegative(),
  }),
});
export type CycleSummary = z.infer<typeof CycleSummarySchema>;

// ── Payout ────────────────────────────────────────────────────────────────
export const PayoutBatchSchema = z.object({
  id: z.string().uuid(),
  cycle_id: z.string().uuid(),
  batch_type: z.string(),
  total_amount: decimalStr,
  status: z.string(),
});
export type PayoutBatch = z.infer<typeof PayoutBatchSchema>;

export const PayoutTransactionSchema = z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  amount: decimalStr,
  status: z.string(),
  bank_reference: z.string().nullable(),
  idempotency_key: z.string(),
});
export type PayoutTransaction = z.infer<typeof PayoutTransactionSchema>;

// ── Audit Event ───────────────────────────────────────────────────────────
export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  actor_id: z.string().nullable(),
  trace_id: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ── Notification ──────────────────────────────────────────────────────────
export const NotificationSchema = z.object({
  id: z.string(),
  body: z.string(),
  is_read: z.boolean(),
  created_at: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z.object({
  notifications: z.array(NotificationSchema),
  unread_count: z.number().int().nonnegative(),
});

// ── SSE Event Payloads ────────────────────────────────────────────────────
export const SSEPayrollEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("payroll.computed"),
    cycle_id: z.string(),
    cycle_name: z.string(),
    status: CycleStatusSchema,
    employee_count: z.number().int(),
    failed_count: z.number().int(),
  }),
  z.object({
    type: z.literal("payroll.disbursed"),
    cycle_id: z.string(),
    total_amount: z.string(),
  }),
  z.object({
    type: z.literal("notification.new"),
    notification: NotificationSchema,
  }),
]);
export type SSEPayrollEvent = z.infer<typeof SSEPayrollEventSchema>;

// ── Auth ──────────────────────────────────────────────────────────────────
export const MeSchema = z.object({
  user_id: z.string(),
  tenant_id: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
});
export type Me = z.infer<typeof MeSchema>;
