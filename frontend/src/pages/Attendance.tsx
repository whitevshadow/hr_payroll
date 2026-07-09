import {
  useState, useMemo, useRef, useCallback, memo,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  Calendar, Download, Upload, Lock, Unlock, CheckCircle2,
  AlertCircle, AlertTriangle, Users, Percent, FileSpreadsheet,
  RefreshCw, X, ChevronDown, ShieldCheck, Save, Eye,
  BarChart3, Clock,
} from "lucide-react";
import { attendanceApi, type AttendanceRecordFull, type AttendanceStatus } from "../api/attendance";
import { employeesApi } from "../api/employees";
import { qk, STALE_STABLE, STALE_OPERATIONAL } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { currentMonthValue, monthToFirst, formatDateTime } from "../lib/format";
import { toastService, extractErrorMessage } from "../lib/toast";
import { useAuth } from "../lib/auth";
import { hasRole, isEmployeeOnly } from "../lib/roles";
import { useClientContext } from "../lib/ClientContext";
import type { Employee } from "../types";
import clsx from "clsx";

// ═══════════════════════════════════════════════════════════════════════════════
// § 1 — CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const ATT_CODES = ["P", "A", "CL", "SL", "PL", "LOP", "WO", "H", "HD", "WFH", "OT"] as const;
type AttCode = typeof ATT_CODES[number];

const CODE_META: Record<AttCode, { label: string; color: string; bg: string; darkBg: string; shortLabel: string }> = {
  P:   { label: "Present",     color: "text-emerald-700", bg: "bg-emerald-100",  darkBg: "dark:bg-emerald-900/30", shortLabel: "P" },
  A:   { label: "Absent",      color: "text-red-700",     bg: "bg-red-100",      darkBg: "dark:bg-red-900/30",     shortLabel: "A" },
  CL:  { label: "Casual Leave",color: "text-blue-700",    bg: "bg-blue-100",     darkBg: "dark:bg-blue-900/30",    shortLabel: "CL" },
  SL:  { label: "Sick Leave",  color: "text-cyan-700",    bg: "bg-cyan-100",     darkBg: "dark:bg-cyan-900/30",    shortLabel: "SL" },
  PL:  { label: "Privilege Leave", color: "text-indigo-700", bg: "bg-indigo-100", darkBg: "dark:bg-indigo-900/30", shortLabel: "PL" },
  LOP: { label: "LOP",         color: "text-orange-700",  bg: "bg-orange-100",   darkBg: "dark:bg-orange-900/30",  shortLabel: "LOP" },
  WO:  { label: "Weekly Off",  color: "text-slate-600",   bg: "bg-slate-100",    darkBg: "dark:bg-slate-800",      shortLabel: "WO" },
  H:   { label: "Holiday",     color: "text-purple-700",  bg: "bg-purple-100",   darkBg: "dark:bg-purple-900/30",  shortLabel: "H" },
  HD:  { label: "Half Day",    color: "text-amber-700",   bg: "bg-amber-100",    darkBg: "dark:bg-amber-900/30",   shortLabel: "HD" },
  WFH: { label: "Work From Home", color: "text-teal-700", bg: "bg-teal-100",     darkBg: "dark:bg-teal-900/30",    shortLabel: "WFH" },
  OT:  { label: "Overtime",    color: "text-violet-700",  bg: "bg-violet-100",   darkBg: "dark:bg-violet-900/30",  shortLabel: "OT" },
};

// Maps attendance code → summary bucket
const CODE_TO_BUCKET: Partial<Record<AttCode, "present" | "cl" | "sl" | "pl" | "lop" | "wo" | "holiday" | "wfh">> = {
  P: "present", WFH: "present", OT: "present",
  CL: "cl", SL: "sl", PL: "pl", LOP: "lop",
  WO: "wo", H: "holiday", HD: "present",  // HD = 0.5, handled as 0.5 present below
};

function getDaysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function getMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Calculate summary from day-array
function summariseDays(days: AttCode[], totalDays: number) {
  let present = 0, cl = 0, sl = 0, pl = 0, lop = 0, wo = 0, holiday = 0, wfh = 0;
  for (const code of days) {
    if (code === "P") present++;
    else if (code === "WFH") { wfh++; present++; }
    else if (code === "OT") present++;
    else if (code === "HD") present += 0.5;
    else if (code === "CL") cl++;
    else if (code === "SL") sl++;
    else if (code === "PL") pl++;
    else if (code === "LOP") lop++;
    else if (code === "WO") wo++;
    else if (code === "H") holiday++;
    else if (code === "A") lop++;  // absent = LOP
  }
  const payable = totalDays - lop;
  const pct = totalDays > 0 ? Math.round((present / totalDays) * 100) : 0;
  return { present, cl, sl, pl, lop, wo, holiday, wfh, payable, pct };
}

// ── AttendanceRow: per-employee state for the edit grid ───────────────────────
interface AttRow {
  employee_id: string;
  emp_code: string;
  name: string;
  department_id: string | null;
  days: AttCode[];          // length = total days in month, default "P"
  // persisted summary (from backend)
  saved_total: number;
  saved_present: number;
  saved_lop: number;
  saved_payable: number;
  dirty: boolean;
  saving: boolean;
  error: string;
}

// ── AttendanceMonth query key ──────────────────────────────────────────────────
function qkMonthly(month: string) { return ["attendance-monthly", month] as const; }
function qkMonthStatus(month: string) { return ["attendance-month-status", month] as const; }

// ═══════════════════════════════════════════════════════════════════════════════
// § 2 — HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const cfg = {
    DRAFT: { cls: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/40", label: "DRAFT" },
    VALIDATED: { cls: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-700/40", label: "VALIDATED" },
    LOCKED: { cls: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-700/40", label: "LOCKED" },
  };
  const { cls, label } = cfg[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold", cls)}>
      {status === "LOCKED" && <Lock className="h-3 w-3" />}
      {status === "VALIDATED" && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );
}

function KPICard({ icon: Icon, label, value, sub, color = "#5A52E5" }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="card-glass p-4 flex items-start gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0" style={{ background: `${color}22` }}>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
        <div className="font-display font-bold text-xl text-[var(--text-primary)] tabular-nums mt-0.5">{value}</div>
        {sub && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ── Code Cell Dropdown ────────────────────────────────────────────────────────
// The dropdown is portalled into #popover-root so it escapes the
// overflow:auto table scroll container and never gets clipped.
//
// IMPORTANT: AnimatePresence must be INSIDE the portal content, not wrapping
// the createPortal() call — Framer Motion tracks children by key and a portal
// object is opaque to it, so exit animations never fire when placed outside.
const DROPDOWN_APPROX_H = ATT_CODES.length * 30 + 12; // ~11 items × 30px + padding

const CodeCell = memo(function CodeCell({
  code, disabled, onChange,
}: { code: AttCode; disabled: boolean; onChange: (c: AttCode) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const meta = CODE_META[code];

  function openDropdown() {
    if (disabled) return;
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < DROPDOWN_APPROX_H + 8;
      setPos({
        top: openUp ? rect.top - DROPDOWN_APPROX_H - 4 : rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 148), // keep within viewport
        openUp,
      });
    }
    setOpen(true);
  }

  const portalRoot = typeof document !== "undefined"
    ? document.getElementById("popover-root")
    : null;

  // AnimatePresence lives INSIDE the portal so Framer Motion can track the
  // motion.div key correctly and play entry/exit animations.
  const dropdown = (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[1199]" onClick={() => setOpen(false)} />
          <motion.div
            key="att-cell-dropdown"
            initial={{ opacity: 0, y: pos.openUp ? -4 : 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: pos.openUp ? -4 : 4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[1200] rounded-xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-2xl p-1 w-36"
          >
            {ATT_CODES.map((c) => {
              const m = CODE_META[c];
              return (
                <button
                  key={c}
                  onClick={() => { onChange(c); setOpen(false); }}
                  className={clsx(
                    "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left hover:bg-[var(--accent-soft)] transition-colors",
                    c === code && "bg-[var(--accent-soft)]",
                  )}
                >
                  <span className={clsx("rounded px-1.5 py-0.5 font-bold text-[10px]", m.bg, m.darkBg, m.color)}>
                    {m.shortLabel}
                  </span>
                  <span className="text-[var(--text-secondary)]">{m.label}</span>
                </button>
              );
            })}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div>
      <button
        ref={btnRef}
        onClick={openDropdown}
        disabled={disabled}
        title={meta.label}
        className={clsx(
          "w-12 h-8 rounded-md text-xs font-bold transition-all border",
          meta.bg, meta.darkBg, meta.color,
          disabled ? "opacity-60 cursor-not-allowed border-transparent" : "cursor-pointer hover:opacity-80 border-transparent hover:border-current/20",
        )}
      >
        {meta.shortLabel}
      </button>
      {/* Portal renders permanently; AnimatePresence inside manages show/hide */}
      {portalRoot ? createPortal(dropdown, portalRoot) : dropdown}
    </div>
  );
});

// ── Confirmation Modal ─────────────────────────────────────────────────────────
function ConfirmModal({
  title, description, onConfirm, onCancel, isPending,
  requireReason = false, reasonLabel = "Reason",
  confirmLabel = "Confirm", variant = "danger",
}: {
  title: string; description: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  isPending: boolean;
  requireReason?: boolean; reasonLabel?: string;
  confirmLabel?: string; variant?: "danger" | "warning" | "primary";
}) {
  const [reason, setReason] = useState("");
  const btnCls = {
    danger: "bg-red-600 hover:bg-red-700 text-white",
    warning: "bg-amber-500 hover:bg-amber-600 text-white",
    primary: "btn",
  }[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-10 w-full max-w-md rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-2xl p-6"
      >
        <h3 className="font-display font-bold text-lg text-[var(--text-primary)]">{title}</h3>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{description}</p>
        {requireReason && (
          <div className="mt-4">
            <label className="label">{reasonLabel}</label>
            <textarea
              rows={2}
              className="input w-full resize-none text-sm mt-1"
              placeholder="Enter reason…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        <div className="mt-5 flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm rounded-xl">Cancel</button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={isPending || (requireReason && !reason.trim())}
            className={clsx("flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50", btnCls)}
          >
            {isPending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Upload Preview Modal ───────────────────────────────────────────────────────
function UploadPreviewModal({
  rows, employees, month, totalDays,
  onCancel, onConfirm, isPending,
}: {
  rows: { emp_code: string; name: string; days: AttCode[] }[];
  employees: Employee[];
  month: string;
  totalDays: number;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const empByCode = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) m[e.emp_code] = e;
    return m;
  }, [employees]);

  const errors: string[] = [];
  const warnings: string[] = [];
  const validRows: typeof rows = [];

  for (const row of rows) {
    if (!empByCode[row.emp_code]) {
      errors.push(`Employee code "${row.emp_code}" not found`);
      continue;
    }
    if (row.days.length !== totalDays) {
      warnings.push(`${row.emp_code}: expected ${totalDays} days, got ${row.days.length}`);
    }
    validRows.push(row);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--glass-border)]">
          <h3 className="font-display font-bold text-lg text-[var(--text-primary)]">Upload Preview — {getMonthLabel(month)}</h3>
          <button onClick={onCancel} className="rounded-xl p-1.5 hover:bg-[var(--accent-soft)] transition-colors">
            <X className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 p-3 text-center">
              <div className="text-2xl font-bold font-numeric text-emerald-600">{validRows.length}</div>
              <div className="text-xs text-emerald-600 mt-0.5">Ready to import</div>
            </div>
            <div className={clsx("rounded-xl p-3 border text-center", errors.length ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/30" : "bg-slate-50 dark:bg-slate-800/40 border-[var(--glass-border)]")}>
              <div className={clsx("text-2xl font-bold font-numeric", errors.length ? "text-red-600" : "text-[var(--text-muted)]")}>{errors.length}</div>
              <div className={clsx("text-xs mt-0.5", errors.length ? "text-red-600" : "text-[var(--text-muted)]")}>Errors</div>
            </div>
            <div className={clsx("rounded-xl p-3 border text-center", warnings.length ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/30" : "bg-slate-50 dark:bg-slate-800/40 border-[var(--glass-border)]")}>
              <div className={clsx("text-2xl font-bold font-numeric", warnings.length ? "text-amber-600" : "text-[var(--text-muted)]")}>{warnings.length}</div>
              <div className={clsx("text-xs mt-0.5", warnings.length ? "text-amber-600" : "text-[var(--text-muted)]")}>Warnings</div>
            </div>
          </div>
          {errors.length > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20 p-3 space-y-1">
              {errors.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {e}
                </div>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-1">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}
          {/* Preview grid */}
          <div className="overflow-x-auto rounded-xl border border-[var(--glass-border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--glass-card-bg)] border-b border-[var(--glass-border)]">
                  <th className="th">Code</th>
                  <th className="th">Name</th>
                  <th className="th text-right">Present</th>
                  <th className="th text-right">LOP</th>
                  <th className="th text-right">Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                {validRows.slice(0, 20).map((row) => {
                  const summary = summariseDays(row.days, totalDays);
                  return (
                    <tr key={row.emp_code} className="tr-hover">
                      <td className="td font-mono">{row.emp_code}</td>
                      <td className="td">{row.name}</td>
                      <td className="td text-right font-numeric">{summary.present}</td>
                      <td className={clsx("td text-right font-numeric", summary.lop > 0 && "text-red-600")}>{summary.lop}</td>
                      <td className="td text-right font-numeric">{summary.payable}</td>
                    </tr>
                  );
                })}
                {validRows.length > 20 && (
                  <tr><td colSpan={5} className="td text-center text-[var(--text-muted)]">…{validRows.length - 20} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--glass-border)]">
          <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm rounded-xl">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={isPending || validRows.length === 0}
            className="btn flex items-center gap-2"
          >
            {isPending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
            <Save className="h-4 w-4" />
            Save {validRows.length} Records
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 3 — MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

type ActiveTab = "summary" | "grid";

export function Attendance() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isHR = hasRole(user, "SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN");
  const isAdmin = hasRole(user, "SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN");

  const [month, setMonth] = useState(currentMonthValue());
  const [activeTab, setActiveTab] = useState<ActiveTab>("summary");
  const { selectedClientId } = useClientContext();

  // Grid state
  const [gridRows, setGridRows] = useState<AttRow[]>([]);
  const [gridLoaded, setGridLoaded] = useState(false);
  const [gridLoading, setGridLoading] = useState(false);

  // Modals
  const [showLock, setShowLock] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [showValidate, setShowValidate] = useState(false);

  // Upload state
  const [uploadRows, setUploadRows] = useState<{ emp_code: string; name: string; days: AttCode[] }[]>([]);
  const [showUploadPreview, setShowUploadPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalDays = getDaysInMonth(month);
  const monthLabel = getMonthLabel(month);

  // ── Queries ────────────────────────────────────────────────────────────────
  const employeesQ = useQuery({
    queryKey: qk.employees({ status: "ACTIVE", page_size: 200 }),
    queryFn: () => employeesApi.list({ status: "ACTIVE", page_size: 200 }),
    staleTime: STALE_STABLE,
  });

  const monthlyQ = useQuery({
    queryKey: qkMonthly(month),
    queryFn: () => attendanceApi.getMonthly(month),
    staleTime: STALE_OPERATIONAL,
  });

  const statusQ = useQuery({
    queryKey: qkMonthStatus(month),
    queryFn: () => attendanceApi.getMonthStatus(month),
    staleTime: STALE_OPERATIONAL,
  });

  const status: AttendanceStatus = statusQ.data?.status ?? "DRAFT";
  const isLocked = status === "LOCKED";
  const canEdit = isHR && !isLocked;

  // ── Derived ────────────────────────────────────────────────────────────────
  const employees = (selectedClientId
    ? (employeesQ.data?.items ?? []).filter((e) => e.client_id === selectedClientId)
    : (employeesQ.data?.items ?? []));
  const monthlyRecords = monthlyQ.data?.records ?? [];

  const empById = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) m[e.id] = e;
    return m;
  }, [employees]);

  const summaryRows = useMemo(() => {
    return monthlyRecords.map((r) => {
      const emp = empById[r.employee_id];
      return {
        ...r,
        emp_code: emp?.emp_code ?? "—",
        name: emp ? `${emp.first_name} ${emp.last_name}` : r.employee_id,
        designation: emp?.designation ?? "—",
      };
    });
  }, [monthlyRecords, empById]);

  // KPI values
  const totalEmp = employees.length;
  const recordedEmp = summaryRows.length;
  const completionPct = totalEmp > 0 ? Math.round((recordedEmp / totalEmp) * 100) : 0;
  const empWithLop = summaryRows.filter((r) => parseFloat(r.lop_days) > 0).length;
  const pendingValidation = totalEmp - recordedEmp;

  // ── Build grid rows from employees + monthly data ─────────────────────────
  const buildGrid = useCallback(() => {
    if (!employees.length) return;
    setGridLoading(true);

    const recByEmp: Record<string, AttendanceRecordFull> = {};
    for (const r of monthlyRecords) recByEmp[r.employee_id] = r;

    const rows: AttRow[] = employees.map((emp) => {
      const rec = recByEmp[emp.id];
      const defaultDays = Array<AttCode>(totalDays).fill("P");
      if (rec) {
        // Reconstruct days array from daily_status or fallback to summary
        let days: AttCode[] = [];
        if (rec.daily_status) {
          const splitDays = rec.daily_status.split(",");
          // ensure valid codes and right length
          for (let i = 0; i < totalDays; i++) {
             const code = (splitDays[i] as AttCode) || "P";
             days.push(ATT_CODES.includes(code) ? code : "P");
          }
        } else {
          const presentN = Math.round(parseFloat(rec.present_days));
          const lopN = Math.round(parseFloat(rec.lop_days));
          const woN = Math.round(parseFloat(rec.wo_days));
          const holN = Math.round(parseFloat(rec.holiday_days));
          // Fill days: P...P, then WO, H, LOP
          let remaining = totalDays;
          while (remaining > woN + holN + lopN) { days.push("P"); remaining--; }
          for (let i = 0; i < woN && remaining > 0; i++) { days.push("WO"); remaining--; }
          for (let i = 0; i < holN && remaining > 0; i++) { days.push("H"); remaining--; }
          for (let i = 0; i < lopN && remaining > 0; i++) { days.push("LOP"); remaining--; }
        }
        return {
          employee_id: emp.id,
          emp_code: emp.emp_code,
          name: `${emp.first_name} ${emp.last_name}`,
          department_id: emp.department_id,
          days: days.slice(0, totalDays),
          saved_total: rec.total_days,
          saved_present: parseFloat(rec.present_days),
          saved_lop: parseFloat(rec.lop_days),
          saved_payable: parseFloat(rec.payable_days),
          dirty: false, saving: false, error: "",
        };
      }
      return {
        employee_id: emp.id,
        emp_code: emp.emp_code,
        name: `${emp.first_name} ${emp.last_name}`,
        department_id: emp.department_id,
        days: defaultDays,
        saved_total: 0, saved_present: 0, saved_lop: 0, saved_payable: 0,
        dirty: true, saving: false, error: "",
      };
    });
    setGridRows(rows);
    setGridLoading(false);
    setGridLoaded(true);
  }, [employees, monthlyRecords, totalDays]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: qkMonthly(month) });
    qc.invalidateQueries({ queryKey: qkMonthStatus(month) });
  }, [qc, month]);

  const lockMut = useMutation({
    mutationFn: (reason?: string) => attendanceApi.lock(month, reason),
    onSuccess: () => { toastService.success("Attendance LOCKED. Payroll can now run."); setShowLock(false); invalidate(); },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const unlockMut = useMutation({
    mutationFn: (reason: string) => attendanceApi.unlock(month, reason),
    onSuccess: () => { toastService.success("Attendance unlocked and returned to DRAFT."); setShowUnlock(false); invalidate(); },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const validateMut = useMutation({
    mutationFn: () => attendanceApi.validate(month),
    onSuccess: () => { toastService.success("Attendance VALIDATED."); setShowValidate(false); invalidate(); },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const saveMut = useMutation({
    mutationFn: (records: Parameters<typeof attendanceApi.bulkUpsert>[0]["records"]) =>
      attendanceApi.bulkUpsert({ month: monthToFirst(month), records, source: "MANUAL" }),
    onSuccess: () => { toastService.success("Attendance saved."); invalidate(); setGridRows((rs) => rs.map((r) => ({ ...r, dirty: false }))); },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const uploadSaveMut = useMutation({
    mutationFn: () => {
      const empByCode: Record<string, Employee> = {};
      for (const e of employees) empByCode[e.emp_code] = e;
      const records = uploadRows
        .filter((r) => empByCode[r.emp_code])
        .map((r) => {
          const emp = empByCode[r.emp_code];
          const s = summariseDays(r.days, totalDays);
          return {
            employee_id: emp.id,
            total_days: totalDays,
            present_days: s.present,
            cl_days: s.cl, sl_days: s.sl, pl_days: s.pl,
            lop_days: s.lop, wo_days: s.wo, holiday_days: s.holiday, wfh_days: s.wfh,
            daily_status: r.days.join(","),
          };
        });
      return attendanceApi.bulkUpsert({ month: monthToFirst(month), records, source: "EXCEL_IMPORT" });
    },
    onSuccess: (data) => {
      toastService.success(`Imported ${data.created + data.updated} records.`);
      setShowUploadPreview(false);
      setUploadRows([]);
      invalidate();
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  // ── Save all dirty grid rows ───────────────────────────────────────────────
  function saveAllDirty() {
    const dirtyRows = gridRows.filter((r) => r.dirty);
    if (!dirtyRows.length) return;
    const records = dirtyRows.map((r) => {
      const s = summariseDays(r.days, totalDays);
      return {
        employee_id: r.employee_id,
        total_days: totalDays,
        present_days: s.present,
        cl_days: s.cl, sl_days: s.sl, pl_days: s.pl,
        lop_days: s.lop, wo_days: s.wo, holiday_days: s.holiday, wfh_days: s.wfh,
        daily_status: r.days.join(","),
      };
    });
    saveMut.mutate(records);
  }

  // ── Excel template download ────────────────────────────────────────────────
  function downloadTemplate() {
    const [y, m] = month.split("-").map(Number);
    const days = getDaysInMonth(month);

    // Sheet 1: Attendance Register
    const dayHeaders = Array.from({ length: days }, (_, i) => `${i + 1}`);
    const headers = ["Employee Code", "Employee Name", "Department", "Designation", ...dayHeaders];
    const dataRows: string[][] = employees.map((emp) => [
      emp.emp_code,
      `${emp.first_name} ${emp.last_name}`,
      "",
      emp.designation ?? "",
      ...Array(days).fill("P"),
    ]);

    const ws1 = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    // Style headers (set column widths)
    ws1["!cols"] = [
      { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 20 },
      ...Array(days).fill({ wch: 5 }),
    ];

    // Sheet 2: Instructions
    const instructions: string[][] = [
      ["Attendance Import Instructions"],
      [""],
      ["1. Do not change the employee code or name columns."],
      ["2. Enter attendance codes in the day columns."],
      ["3. Leave blank cells will be treated as Present (P)."],
      [""],
      ["Attendance Codes:"],
      ["P   = Present"],
      ["A   = Absent (counted as LOP)"],
      ["CL  = Casual Leave"],
      ["SL  = Sick Leave"],
      ["PL  = Privilege Leave"],
      ["LOP = Leave Without Pay"],
      ["WO  = Weekly Off"],
      ["H   = Holiday"],
      ["HD  = Half Day"],
      ["WFH = Work From Home"],
      ["OT  = Overtime"],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(instructions);
    ws2["!cols"] = [{ wch: 50 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Attendance Register");
    XLSX.utils.book_append_sheet(wb, ws2, "Instructions");

    const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }).replace(" ", "_");
    XLSX.writeFile(wb, `Attendance_Template_${monthName}.xlsx`);
    toastService.success("Template downloaded.");
  }

  // ── Excel upload parse ─────────────────────────────────────────────────────
  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];

        if (rows.length < 2) { toastService.error("No data rows found in the file."); return; }

        const header = rows[0];
        const dayStart = 4; // columns 0-3 are EmpCode, Name, Dept, Designation
        const parsed: { emp_code: string; name: string; days: AttCode[] }[] = [];

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const empCode = String(row[0] ?? "").trim();
          if (!empCode) continue;
          const days: AttCode[] = [];
          for (let d = dayStart; d < dayStart + totalDays; d++) {
            const raw = String(row[d] ?? "P").trim().toUpperCase();
            const code = ATT_CODES.includes(raw as AttCode) ? (raw as AttCode) : "P";
            days.push(code);
          }
          parsed.push({ emp_code: empCode, name: String(row[1] ?? "").trim(), days });
        }

        setUploadRows(parsed);
        setShowUploadPreview(true);
      } catch {
        toastService.error("Failed to parse Excel file. Please use the provided template.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Render ───────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance Management"
        subtitle="Monthly attendance entry, validation, and payroll locking"
      >
        {/* Toolbar — only shown when a client is selected */}
        {selectedClientId && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Month picker */}
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="month"
                value={month}
                onChange={(e) => { setMonth(e.target.value); setGridLoaded(false); }}
                className="input pl-8 text-sm py-2 w-40"
              />
            </div>

            {/* Status badge */}
            <StatusBadge status={status} />

            {canEdit && (
              <>
                <button onClick={downloadTemplate} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl">
                  <Download className="h-3.5 w-3.5" /> Template
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl">
                  <Upload className="h-3.5 w-3.5" /> Import Excel
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileUpload} />
              </>
            )}

            {canEdit && status === "DRAFT" && (
              <button onClick={() => setShowValidate(true)} className="btn-ghost flex items-center gap-1.5 text-sm py-2 px-3 rounded-xl text-blue-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Validate
              </button>
            )}

            {canEdit && (
              <button
                onClick={() => setShowLock(true)}
                className="flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white px-3 py-2 text-sm font-semibold transition-colors"
              >
                <Lock className="h-3.5 w-3.5" /> Lock Attendance
              </button>
            )}

            {isLocked && isAdmin && (
              <button
                onClick={() => setShowUnlock(true)}
                className="flex items-center gap-1.5 rounded-xl border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 px-3 py-2 text-sm font-semibold transition-colors"
              >
                <Unlock className="h-3.5 w-3.5" /> Unlock
              </button>
            )}
          </div>
        )}
      </PageHeader>

      {!selectedClientId ? (
        <div className="card-glass p-12 flex flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-slate-300 mb-4" />
          <h2 className="text-lg font-bold text-slate-800">No Client Selected</h2>
          <p className="text-slate-500 mt-2 max-w-sm">Please select a client from the top navigation bar to view or manage attendance.</p>
        </div>
      ) : (
        <>
          {/* ── Locked banner ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isLocked && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20 px-5 py-4 flex items-center justify-between flex-wrap gap-3"
          >
            <div className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              <div>
                <div className="font-semibold text-red-700 dark:text-red-300">Attendance Locked — {monthLabel}</div>
                <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  This attendance data is payroll-authoritative. No modifications allowed.
                  {statusQ.data?.locked_at && ` Locked ${formatDateTime(statusQ.data.locked_at)}.`}
                  {statusQ.data?.locked_reason && ` Reason: ${statusQ.data.locked_reason}`}
                </div>
              </div>
            </div>
            {isAdmin && (
              <button onClick={() => setShowUnlock(true)} className="text-sm text-red-600 dark:text-red-400 underline hover:no-underline shrink-0">
                Unlock (Admin only)
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── KPI Summary ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KPICard icon={Users} label="Total Employees" value={totalEmp} color="#3B82F6" />
        <KPICard icon={Percent} label="Completion %" value={`${completionPct}%`} sub={`${recordedEmp}/${totalEmp} recorded`} color="#10B981" />
        <KPICard icon={AlertTriangle} label="Employees With LOP" value={empWithLop} color="#EF4444" />
        <KPICard icon={Clock} label="Pending" value={pendingValidation} sub="records missing" color="#F59E0B" />
        <KPICard icon={ShieldCheck} label="Status" value={status} color={status === "LOCKED" ? "#EF4444" : status === "VALIDATED" ? "#3B82F6" : "#8B5CF6"} />
        <KPICard icon={Calendar} label="Working Days" value={totalDays} sub={monthLabel} color="#6366F1" />
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card-bg)] p-1 w-fit">
        {([["summary", BarChart3, "Summary"], ["grid", FileSpreadsheet, "Edit Grid"]] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id as ActiveTab);
              if (id === "grid" && !gridLoaded) buildGrid();
            }}
            className={clsx(
              "relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
              activeTab === id
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
            )}
          >
            {activeTab === id && (
              <motion.div
                layoutId="att-tab"
                className="absolute inset-0 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/20"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <Icon className="relative h-3.5 w-3.5" />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* ══ SUMMARY TAB ════════════════════════════════════════════════ */}
          {activeTab === "summary" && (
            <div className="card-glass overflow-hidden p-0">
              <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--glass-border)]">
                <h3 className="font-display font-semibold text-[var(--text-primary)]">
                  Monthly Summary — {monthLabel}
                </h3>
                <div className="flex items-center gap-2">
                  {monthlyQ.isFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />}
                  <span className="text-xs text-[var(--text-muted)]">{summaryRows.length} records</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-card-bg)]/60 sticky top-0 z-10">
                      <th className="th">Code</th>
                      <th className="th">Employee</th>
                      <th className="th">Designation</th>
                      <th className="th text-right">Working Days</th>
                      <th className="th text-right">Present</th>
                      <th className="th text-right">CL</th>
                      <th className="th text-right">SL</th>
                      <th className="th text-right">PL</th>
                      <th className="th text-right">LOP</th>
                      <th className="th text-right">Payable</th>
                      <th className="th text-right">Att %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                    {monthlyQ.isLoading && (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 11 }).map((_, j) => (
                            <td key={j} className="td"><div className="skeleton h-4 rounded" /></td>
                          ))}
                        </tr>
                      ))
                    )}
                    {!monthlyQ.isLoading && summaryRows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="td py-10 text-center text-[var(--text-muted)]">
                          No attendance records for {monthLabel}. Import Excel or use the Edit Grid.
                        </td>
                      </tr>
                    )}
                    {summaryRows.map((r) => {
                      const lop = parseFloat(r.lop_days);
                      const pct = parseFloat(r.attendance_pct);
                      return (
                        <tr key={r.employee_id} className="tr-hover">
                          <td className="td">
                            <span className="rounded-md bg-[var(--glass-border)] px-2 py-0.5 text-xs font-mono text-[var(--text-secondary)]">
                              {r.emp_code}
                            </span>
                          </td>
                          <td className="td font-medium text-[var(--text-primary)] text-sm">{r.name}</td>
                          <td className="td text-xs text-[var(--text-muted)]">{r.designation}</td>
                          <td className="td text-right font-numeric text-sm">{r.total_days}</td>
                          <td className="td text-right font-numeric text-sm text-emerald-600 dark:text-emerald-400 font-semibold">{r.present_days}</td>
                          <td className="td text-right font-numeric text-xs text-blue-600">{r.cl_days}</td>
                          <td className="td text-right font-numeric text-xs text-cyan-600">{r.sl_days}</td>
                          <td className="td text-right font-numeric text-xs text-indigo-600">{r.pl_days}</td>
                          <td className="td text-right font-numeric text-sm">
                            <span className={clsx("font-semibold", lop > 0 ? "text-red-600 dark:text-red-400" : "text-[var(--text-muted)]")}>
                              {r.lop_days}
                            </span>
                          </td>
                          <td className="td text-right font-numeric text-sm font-semibold text-[var(--text-primary)]">{r.payable_days}</td>
                          <td className="td text-right">
                            <span className={clsx(
                              "rounded-full px-2 py-0.5 text-xs font-semibold",
                              pct >= 90 ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                : pct >= 75 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                                  : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                            )}>
                              {pct.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══ GRID TAB ═══════════════════════════════════════════════════ */}
          {activeTab === "grid" && (
            <div className="space-y-4">
              {!gridLoaded ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-card-bg)] py-16 gap-4">
                  <FileSpreadsheet className="h-10 w-10 text-[var(--accent)]" />
                  <div className="text-center">
                    <div className="font-semibold text-[var(--text-primary)]">Daily Attendance Grid</div>
                    <div className="text-sm text-[var(--text-muted)] mt-1">Click below to load the editable attendance grid for {monthLabel}.</div>
                  </div>
                  <button onClick={buildGrid} disabled={gridLoading || !employees.length} className="btn flex items-center gap-2">
                    {gridLoading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Loading…</> : <><Eye className="h-4 w-4" /> Load Grid</>}
                  </button>
                </div>
              ) : (
                <>
                  {/* Grid toolbar */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--text-muted)]">
                      {ATT_CODES.slice(0, 8).map((code) => {
                        const meta = CODE_META[code];
                        return (
                          <span key={code} className={clsx("rounded px-2 py-0.5 font-semibold", meta.bg, meta.darkBg, meta.color)}>
                            {meta.shortLabel} = {meta.label}
                          </span>
                        );
                      })}
                    </div>
                    {canEdit && (
                      <button
                        onClick={saveAllDirty}
                        disabled={saveMut.isPending || !gridRows.some((r) => r.dirty)}
                        className="btn flex items-center gap-2"
                      >
                        {saveMut.isPending
                          ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Saving…</>
                          : <><Save className="h-4 w-4" /> Save Changes ({gridRows.filter((r) => r.dirty).length})</>
                        }
                      </button>
                    )}
                  </div>

                  {/* Horizontal scrolling grid with sticky first two columns */}
                  <div className="card-glass overflow-hidden p-0">
                    <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-20">
                          <tr className="bg-[var(--glass-panel-bg)] backdrop-blur-sm border-b border-[var(--glass-border)]">
                            <th className="th sticky left-0 z-30 bg-[var(--glass-panel-bg)] backdrop-blur-sm min-w-[110px] text-left border-r border-[var(--glass-border)]">
                              Code
                            </th>
                            <th className="th sticky left-[110px] z-30 bg-[var(--glass-panel-bg)] backdrop-blur-sm min-w-[160px] text-left border-r border-[var(--glass-border)]">
                              Employee
                            </th>
                            {/* Day columns */}
                            {Array.from({ length: totalDays }, (_, i) => {
                              const d = new Date(parseInt(month.split("-")[0]), parseInt(month.split("-")[1]) - 1, i + 1);
                              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                              return (
                                <th key={i} className={clsx("th text-center min-w-[48px]", isWeekend && "bg-slate-100/80 dark:bg-slate-800/60")}>
                                  <div>{i + 1}</div>
                                  <div className="font-normal text-[10px] opacity-60">{d.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 2)}</div>
                                </th>
                              );
                            })}
                            <th className="th text-right min-w-[56px] border-l border-[var(--glass-border)]">P</th>
                            <th className="th text-right min-w-[56px]">LOP</th>
                            <th className="th text-right min-w-[64px]">Payable</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                          {gridRows.map((row, ri) => {
                            const s = summariseDays(row.days, totalDays);
                            return (
                              <tr
                                key={row.employee_id}
                                className={clsx("tr-hover", row.dirty && "bg-amber-50/20 dark:bg-amber-900/5")}
                              >
                                {/* Sticky emp code */}
                                <td className="td sticky left-0 z-10 bg-[var(--table-bg)] border-r border-[var(--glass-border-subtle)]">
                                  <span className="rounded-md bg-[var(--glass-border)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                                    {row.emp_code}
                                  </span>
                                </td>
                                {/* Sticky name */}
                                <td className="td sticky left-[110px] z-10 bg-[var(--table-bg)] border-r border-[var(--glass-border-subtle)] font-medium text-[var(--text-primary)] text-xs max-w-[160px] truncate">
                                  {row.name}
                                </td>
                                {/* Day cells */}
                                {row.days.map((code, di) => {
                                  const d = new Date(parseInt(month.split("-")[0]), parseInt(month.split("-")[1]) - 1, di + 1);
                                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                                  return (
                                    <td key={di} className={clsx("p-0.5 text-center", isWeekend && "bg-slate-50/60 dark:bg-slate-900/30")}>
                                      <CodeCell
                                        code={code}
                                        disabled={!canEdit}
                                        onChange={(newCode) => {
                                          setGridRows((rs) =>
                                            rs.map((r, idx) =>
                                              idx === ri
                                                ? { ...r, dirty: true, days: r.days.map((d, j) => j === di ? newCode : d) }
                                                : r
                                            )
                                          );
                                        }}
                                      />
                                    </td>
                                  );
                                })}
                                {/* Summary */}
                                <td className="td text-right font-numeric font-semibold text-emerald-600 dark:text-emerald-400 border-l border-[var(--glass-border-subtle)]">
                                  {s.present}
                                </td>
                                <td className={clsx("td text-right font-numeric font-semibold", s.lop > 0 ? "text-red-600 dark:text-red-400" : "text-[var(--text-muted)]")}>
                                  {s.lop}
                                </td>
                                <td className="td text-right font-numeric text-[var(--text-primary)] font-semibold">
                                  {s.payable}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showLock && (
          <ConfirmModal
            title={`Lock Attendance — ${monthLabel}`}
            description={`This will lock attendance for all ${summaryRows.length} employees. Once locked, no changes can be made without admin unlock. Payroll can then be processed using this data.`}
            confirmLabel="Lock Attendance"
            variant="danger"
            onConfirm={(reason) => lockMut.mutate(reason)}
            onCancel={() => setShowLock(false)}
            isPending={lockMut.isPending}
          />
        )}
        {showUnlock && (
          <ConfirmModal
            title={`Unlock Attendance — ${monthLabel}`}
            description="This will unlock the attendance, reverting it to DRAFT. This may affect already-processed payroll cycles. A reason is mandatory."
            confirmLabel="Unlock"
            variant="warning"
            requireReason
            reasonLabel="Unlock reason (mandatory)"
            onConfirm={(reason) => unlockMut.mutate(reason!)}
            onCancel={() => setShowUnlock(false)}
            isPending={unlockMut.isPending}
          />
        )}
        {showValidate && (
          <ConfirmModal
            title={`Validate Attendance — ${monthLabel}`}
            description={`Validate attendance for ${recordedEmp} of ${totalEmp} employees. Validated attendance can still be edited (which reverts to DRAFT). Only locked attendance is payroll-authoritative.`}
            confirmLabel="Validate"
            variant="primary"
            onConfirm={() => validateMut.mutate()}
            onCancel={() => setShowValidate(false)}
            isPending={validateMut.isPending}
          />
        )}
        {showUploadPreview && uploadRows.length > 0 && (
          <UploadPreviewModal
            rows={uploadRows}
            employees={employees}
            month={month}
            totalDays={totalDays}
            onCancel={() => setShowUploadPreview(false)}
            onConfirm={() => uploadSaveMut.mutate()}
            isPending={uploadSaveMut.isPending}
          />
        )}
      </AnimatePresence>
        </>
      )}
    </div>
  );
}
