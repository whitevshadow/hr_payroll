import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { employeesApi } from "../api/employees";
import { payrollApi } from "../api/payroll";
import { tdsApi } from "../api/tds";
import { attendanceApi } from "../api/attendance";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { FullPageSpinner } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { EmployeeDocumentsPanel } from "../components/EmployeeDocumentsPanel";
import { formatINR } from "../lib/money";
import { formatDate, formatMonth } from "../lib/format";
import { toastService, extractErrorMessage } from "../lib/toast";
import type { Employee } from "../types";
import {
  FileText,
  Calendar,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  X,
} from "lucide-react";
import clsx from "clsx";

export function MyProfile() {
  const qc = useQueryClient();
  const [showDecl, setShowDecl] = useState(false);
  const [decl, setDecl] = useState({
    sec_80c: 0,
    sec_80d: 0,
    hra_claimed: 0,
    other_deductions: 0,
    regime_preference: "NEW",
  });

  const meQ = useQuery({
    queryKey: qk.myEmployee,
    queryFn: () => employeesApi.me(),
    staleTime: STALE_STABLE,
    retry: false,
  });

  const me = meQ.data;

  const cycles = useQuery({
    queryKey: qk.cycles,
    queryFn: () => payrollApi.listCycles(),
    enabled: !!me,
  });

  const disbursed = (cycles.data ?? []).filter((c) => c.status === "DISBURSED");
  const latestCycle = disbursed[0];

  const declMut = useMutation({
    mutationFn: () => tdsApi.submitDeclaration({ employee_id: me!.id, ...decl }),
    onSuccess: (data) => {
      toastService.success("Declaration submitted. " + (data.note ?? ""));
      setShowDecl(false);
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  if (meQ.isLoading) return <FullPageSpinner />;
  if (meQ.isError || !me) {
    return (
      <div>
        <PageHeader title="My Profile" />
        <EmptyState
          title="No employee record linked"
          description="Your user account isn't linked to an employee record yet. Contact your HR admin."
        />
      </div>
    );
  }

  const initials = `${me.first_name.charAt(0)}${me.last_name.charAt(0)}`.toUpperCase();

  return (
    <div className="space-y-5">
      {/* Profile header */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-400 to-violet-600 text-xl font-bold text-white shadow-glass">
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                {me.first_name} {me.last_name}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {me.designation ?? me.emp_code} · <span className="font-mono">{me.emp_code}</span>
              </p>
              {me.status && (
                <div className="mt-1.5">
                  <StatusBadge status={me.status} size="sm" />
                </div>
              )}
            </div>
          </div>
          <button
            className="btn-ghost"
            onClick={() => setShowDecl((s) => !s)}
          >
            <FileText className="h-4 w-4" />
            Investment Declaration
          </button>
        </div>
      </div>

      {/* Latest payslip highlight */}
      {latestCycle ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card flex items-center justify-between gap-4 border-accent-100 dark:border-accent-900/30 bg-gradient-to-r from-accent-50/50 to-violet-50/50 dark:from-accent-900/10 dark:to-violet-900/10"
        >
          <div>
            <div className="kpi-label">Latest Payslip</div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-50 mt-1">
              {latestCycle.name}
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {formatDate(latestCycle.period_start)} → {formatDate(latestCycle.period_end)}
            </div>
          </div>
          <Link
            to={`/payslips/${latestCycle.id}/${me.id}`}
            className="btn"
          >
            <FileText className="h-4 w-4" />
            View Payslip
          </Link>
        </motion.div>
      ) : (
        <EmptyState
          title="No payslips yet"
          description="Your payslips will appear here after payroll is disbursed."
        />
      )}

      <EmployeeDocumentsPanel
        employeeId={me.id}
        title="My Documents"
        description="Upload identity, banking, and employment documents for HR review."
      />

      {/* Investment declaration form (collapsible) */}
      <AnimatePresence>
        {showDecl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Investment Declaration
                </h2>
                <button
                  onClick={() => setShowDecl(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="alert-warning mb-4 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="text-xs">
                  Old-regime computation arrives in V2. Your declaration is recorded for HR records.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Regime Preference</label>
                  <select
                    className="input"
                    value={decl.regime_preference}
                    onChange={(e) => setDecl({ ...decl, regime_preference: e.target.value })}
                  >
                    <option value="NEW">New Regime</option>
                    <option value="OLD">Old Regime (V2)</option>
                    <option value="AUTO">Auto (V2)</option>
                  </select>
                </div>
                {[
                  ["Section 80C (₹)", "sec_80c"],
                  ["Section 80D (₹)", "sec_80d"],
                  ["HRA Claimed (₹)", "hra_claimed"],
                  ["Other (₹)", "other_deductions"],
                ].map(([label, key]) => (
                  <div key={key}>
                    <label className="label">{label}</label>
                    <input
                      className="input font-numeric"
                      type="number"
                      min="0"
                      value={(decl as any)[key]}
                      onChange={(e) =>
                        setDecl({ ...decl, [key]: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <button className="btn-ghost" onClick={() => setShowDecl(false)}>Cancel</button>
                <button
                  className="btn"
                  disabled={declMut.isPending}
                  onClick={() => declMut.mutate()}
                >
                  {declMut.isPending ? (
                    <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Submitting…</>
                  ) : "Submit Declaration"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payslip history table */}
      <div className="card table-card overflow-hidden p-0">
        <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Payslip History
          </h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Cycle</th>
              <th className="th">Period</th>
              <th className="th">Status</th>
              <th className="th w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {disbursed.length === 0 && (
              <tr>
                <td colSpan={4} className="td py-8 text-center text-slate-400">
                  No payslips yet
                </td>
              </tr>
            )}
            {disbursed.slice(0, 6).map((c, idx) => (
              <motion.tr
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                className="tr-hover"
              >
                <td className="td font-medium text-slate-800 dark:text-slate-200">{c.name}</td>
                <td className="td text-slate-500 dark:text-slate-400">
                  {formatMonth(c.period_start)}
                </td>
                <td className="td">
                  <StatusBadge status={c.status} size="sm" />
                </td>
                <td className="td">
                  <Link
                    to={`/payslips/${c.id}/${me.id}`}
                    className="flex items-center justify-end gap-1 text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400"
                  >
                    View <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* My attendance */}
      <MyAttendance employeeId={me.id} />
    </div>
  );
}

function MyAttendance({ employeeId }: { employeeId: string }) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }).reverse();

  const queries = months.map((m) =>
    useQuery({
      queryKey: qk.attendance(employeeId, m),
      queryFn: () => attendanceApi.get(employeeId, m),
      retry: false,
    })
  );

  return (
    <div className="card table-card overflow-hidden p-0">
      <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          My Attendance (6 months)
        </h2>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
            <th className="th">Month</th>
            <th className="th text-right">Total</th>
            <th className="th text-right">Present</th>
            <th className="th text-right">LOP</th>
            <th className="th text-right">Payable</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {months.map((m, i) => {
            const r = queries[i].data;
            const lop = r?.lop_days;
            return (
              <tr key={m} className="tr-hover">
                <td className="td font-medium text-slate-700 dark:text-slate-300">
                  {formatMonth(m + "-01")}
                </td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">
                  {r?.total_days ?? "—"}
                </td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">
                  {r?.present_days ?? "—"}
                </td>
                <td className={clsx(
                  "td text-right font-numeric",
                  lop && parseFloat(String(lop)) > 0
                    ? "text-danger font-semibold"
                    : "text-slate-400"
                )}>
                  {lop ?? "—"}
                </td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">
                  {r?.payable_days ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
