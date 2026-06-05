import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { employeesApi } from "../api/employees";
import { salaryApi } from "../api/salary";
import { attendanceApi } from "../api/attendance";
import { payrollApi } from "../api/payroll";
import api from "../lib/api";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { FullPageSpinner } from "../components/Spinner";
import { EmployeeDocumentsPanel } from "../components/EmployeeDocumentsPanel";
import { formatINR } from "../lib/money";
import { formatDate, formatMonth, firstToMonth } from "../lib/format";
import { maskPii, type PiiType } from "../lib/pii";
import { toastService, extractErrorMessage } from "../lib/toast";
import clsx from "clsx";

type Tab = "profile" | "salary" | "attendance" | "payslips" | "documents";

export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("profile");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const empQ = useQuery({
    queryKey: qk.employee(id!),
    queryFn: () => employeesApi.get(id!),
  });

  const emp = empQ.data;

  async function reveal(field: string, type: PiiType) {
    if (revealed.has(field)) return;
    try {
      await api.post(`/employees/${id}/pii-access`, { fields: [field] });
      setRevealed((s) => new Set([...s, field]));
      qc.invalidateQueries({ queryKey: qk.audit({}) });
      toastService.info("PII access recorded in audit log.");
    } catch (err) {
      toastService.error(extractErrorMessage(err));
    }
  }

  if (empQ.isLoading) return <FullPageSpinner />;
  if (!emp) return <div className="text-red-600">Employee not found.</div>;

  const fullName = `${emp.first_name} ${emp.last_name}`;

  return (
    <div>
      <PageHeader title={fullName} subtitle={emp.designation ?? emp.emp_code}>
        <Link to="/employees" className="btn-ghost">← Employees</Link>
      </PageHeader>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(["profile", "salary", "attendance", "payslips", "documents"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "border-b-2 border-accent-600 text-accent-600 dark:text-accent-400"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab emp={emp} revealed={revealed} onReveal={reveal} />}
      {tab === "salary" && <SalaryTab employeeId={id!} />}
      {tab === "attendance" && <AttendanceTab employeeId={id!} />}
      {tab === "payslips" && <PayslipsTab employeeId={id!} />}
      {tab === "documents" && <DocumentsTab employeeId={id!} />}
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────
function ProfileTab({
  emp,
  revealed,
  onReveal,
}: {
  emp: any;
  revealed: Set<string>;
  onReveal: (field: string, type: PiiType) => void;
}) {
  function PiiField({ label, field, value, type }: { label: string; field: string; value: string | null | undefined; type: PiiType }) {
    const masked = maskPii(value, type);
    const isRevealed = revealed.has(field);
    return (
      <div className="flex items-center justify-between">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{isRevealed ? (value ?? "—") : masked}</span>
          {value && !isRevealed && (
            <button
              className="text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 hover:underline"
              onClick={() => onReveal(field, type)}
            >
              Reveal
            </button>
          )}
        </div>
      </div>
    );
  }

  const rows = [
    { label: "Employee Code", value: emp.emp_code },
    { label: "Email", value: emp.email },
    { label: "Status", value: <StatusBadge status={emp.status} /> },
    { label: "Designation", value: emp.designation },
    { label: "Work Location", value: emp.work_location ? `${emp.work_location} (${emp.city}, ${emp.state})` : "—" },
    { label: "Joining Date", value: formatDate(emp.joining_date) },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card table-card">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Basic Information</h3>
        <div className="space-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">{r.label}</span>
              <span className="text-slate-800 dark:text-slate-200">{r.value ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
          Sensitive Information
          <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">🔒 Reveal audits access</span>
        </h3>
        <div className="space-y-2 text-sm">
          <PiiField label="PAN" field="pan_number" value={emp.pan_number} type="pan" />
          <PiiField label="Bank Account" field="bank_account" value={emp.bank_account} type="account" />
          <PiiField label="IFSC" field="bank_ifsc" value={emp.bank_ifsc} type="ifsc" />
          <PiiField label="UAN" field="uan_number" value={emp.uan_number} type="generic" />
        </div>
      </div>
    </div>
  );
}

// ── Salary Tab ────────────────────────────────────────────────────────────
function SalaryTab({ employeeId }: { employeeId: string }) {
  const active = useQuery({
    queryKey: qk.salary(employeeId),
    queryFn: () => salaryApi.getActive(employeeId),
    retry: false,
  });

  const history = useQuery({
    queryKey: qk.salaryHistory(employeeId),
    queryFn: () => api.get(`/salary/structures/${employeeId}/history`).then((r) => r.data as any[]),
  });

  if (active.isLoading) return <FullPageSpinner />;

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Active Structure</h3>
        {active.isError ? (
          <div className="text-sm text-slate-400 dark:text-slate-500">No active salary structure.</div>
        ) : active.data ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {[
                ["Annual CTC", formatINR(active.data.ctc)],
                ["Monthly Gross", formatINR(active.data.breakdown.monthly_gross)],
                ["Basic (40%)", formatINR(active.data.breakdown.basic)],
                [`HRA (${active.data.breakdown.is_metro ? "Metro 50%" : "Non-Metro 40%"})`, formatINR(active.data.breakdown.hra)],
                ["Special Allowance", formatINR(active.data.breakdown.special_allowance)],
                ["Effective From", formatDate(active.data.effective_from)],
              ].map(([l, v]) => (
                <tr key={l}>
                  <td className="td text-slate-500 dark:text-slate-400">{l}</td>
                  <td className="td text-right font-numeric font-semibold text-slate-800 dark:text-slate-200">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Revision History</h3>
        {history.isLoading && <FullPageSpinner />}
        {!history.isLoading && (history.data?.length ?? 0) === 0 && (
          <div className="text-sm text-slate-400 dark:text-slate-500">No history</div>
        )}
        <div className="relative ml-3 space-y-3 border-l-2 border-slate-100 dark:border-slate-800 pl-4">
          {history.data?.map((s: any) => (
            <div key={s.id} className="relative">
              <div className="absolute -left-[21px] mt-1 h-3 w-3 rounded-full border-2 border-accent-500 bg-white dark:bg-slate-900" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 font-numeric">{formatINR(s.ctc)} CTC</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {formatDate(s.effective_from)} {s.is_active && <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-semibold">• Active</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Attendance Tab ────────────────────────────────────────────────────────
function AttendanceTab({ employeeId }: { employeeId: string }) {
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
            const q = queries[i];
            const r = q.data;
            const lop = r?.lop_days;
            return (
              <tr key={m} className="tr-hover">
                <td className="td font-medium text-slate-700 dark:text-slate-300">{formatMonth(m + "-01")}</td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">{r?.total_days ?? "—"}</td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">{r?.present_days ?? "—"}</td>
                <td className={clsx("td text-right font-numeric", lop && parseFloat(String(lop)) > 0 ? "text-danger font-semibold" : "text-slate-400")}>{lop ?? "—"}</td>
                <td className="td text-right font-numeric text-slate-600 dark:text-slate-400">{r?.payable_days ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Payslips Tab ──────────────────────────────────────────────────────────
function PayslipsTab({ employeeId }: { employeeId: string }) {
  const cycles = useQuery({
    queryKey: qk.cycles,
    queryFn: () => payrollApi.listCycles(),
  });

  const disbursed = cycles.data?.filter((c) => c.status === "DISBURSED") ?? [];

  return (
    <div className="card table-card overflow-hidden p-0">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
            <th className="th">Cycle</th>
            <th className="th">Period</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {disbursed.length === 0 && (
            <tr>
              <td colSpan={3} className="td py-8 text-center text-slate-400">No payslips yet</td>
            </tr>
          )}
          {disbursed.map((c) => (
            <tr key={c.id} className="tr-hover">
              <td className="td font-medium text-slate-800 dark:text-slate-200">{c.name}</td>
              <td className="td text-sm text-slate-500 dark:text-slate-400">{formatDate(c.period_start)} → {formatDate(c.period_end)}</td>
              <td className="td text-right">
                <Link to={`/payslips/${c.id}/${employeeId}`} className="text-sm font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 hover:underline">
                  View payslip →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Documents Tab ────────────────────────────────────────────────────────
function DocumentsTab({ employeeId }: { employeeId: string }) {
  return (
    <EmployeeDocumentsPanel
      employeeId={employeeId}
      title="Employee Documents"
      description="Upload and track identity, banking, and employment documents for this employee."
    />
  );
}
