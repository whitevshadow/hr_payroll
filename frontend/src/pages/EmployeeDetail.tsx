import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { EmptyState } from "../components/EmptyState";
import { formatINR } from "../lib/money";
import { formatDate, formatMonth } from "../lib/format";
import { toastService, extractErrorMessage } from "../lib/toast";
import clsx from "clsx";

type Tab = "personal" | "employment" | "bank" | "documents" | "compliance" | "salary" | "notes";

export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("personal");
  // Maps a revealed field to its unmasked value returned by the audited
  // pii-access endpoint. The detail response itself only contains masked PII.
  const [revealedValues, setRevealedValues] = useState<Record<string, string | null>>({});

  const empQ = useQuery({
    queryKey: qk.employee(id!),
    queryFn: () => employeesApi.get(id!),
  });

  const emp = empQ.data;

  async function reveal(field: string) {
    if (field in revealedValues) return;
    try {
      const { data } = await api.post<{ values: Record<string, string | null> }>(
        `/employees/${id}/pii-access`,
        { fields: [field] },
      );
      setRevealedValues((s) => ({ ...s, [field]: data.values?.[field] ?? null }));
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
      <div className="mb-6 flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar">
        {(["personal", "employment", "bank", "documents", "compliance", "salary", "notes"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium capitalize transition-colors whitespace-nowrap",
              tab === t
                ? "border-b-2 border-accent-600 text-accent-600 dark:text-accent-400"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "personal" && <PersonalTab emp={emp} revealedValues={revealedValues} onReveal={reveal} />}
      {tab === "employment" && <EmploymentTab emp={emp} />}
      {tab === "bank" && <BankTab emp={emp} revealedValues={revealedValues} onReveal={reveal} />}
      {tab === "documents" && <DocumentsTab employeeId={id!} />}
      {tab === "compliance" && <ComplianceTab emp={emp} revealedValues={revealedValues} onReveal={reveal} />}
      {tab === "salary" && <SalaryTab employeeId={id!} />}
      {tab === "notes" && <NotesTab />}
    </div>
  );
}

// ── Shared PII Field Component ─────────────────────────────────────────────
// `value` is the server-masked value from the detail response. Clicking Reveal
// calls the audited pii-access endpoint and shows the unmasked value it returns.
function PiiField({ label, field, value, revealedValues, onReveal }: { label: string; field: string; value: string | null | undefined; revealedValues: Record<string, string | null>; onReveal: (field: string) => void; }) {
  const isRevealed = field in revealedValues;
  const display = isRevealed ? (revealedValues[field] ?? "—") : (value ?? "—");
  return (
    <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{display}</span>
        {value && !isRevealed && (
          <button
            className="text-xs font-semibold text-accent-600 hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
            onClick={() => onReveal(field)}
          >
            Reveal
          </button>
        )}
      </div>
    </div>
  );
}

// ── Personal Tab ─────────────────────────────────────────────────────────
function PersonalTab({ emp, revealedValues, onReveal }: any) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card table-card">
        <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Basic Information</h3>
        <div className="space-y-3 text-sm px-1">
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Employee Code</span>
            <span className="text-slate-800 dark:text-slate-200 font-mono font-medium">{emp.emp_code}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Email</span>
            <span className="text-slate-800 dark:text-slate-200">{emp.email ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Mobile</span>
            <span className="text-slate-800 dark:text-slate-200">{emp.mobile ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Gender</span>
            <span className="text-slate-800 dark:text-slate-200">{emp.gender ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Date of Birth</span>
            <span className="text-slate-800 dark:text-slate-200">{formatDate(emp.date_of_birth)}</span>
          </div>
        </div>
      </div>
      
      <div className="card table-card">
        <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
          Identity Information
          <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">Audited</span>
        </h3>
        <div className="space-y-3 px-1">
          <PiiField label="PAN Number" field="pan_number" value={emp.pan_number} revealedValues={revealedValues} onReveal={onReveal} />
          <PiiField label="Aadhaar Number" field="aadhaar_number" value={emp.aadhaar_number} revealedValues={revealedValues} onReveal={onReveal} />
        </div>
      </div>
    </div>
  );
}

// ── Employment Tab ───────────────────────────────────────────────────────
function EmploymentTab({ emp }: any) {
  const depts = useQuery({ queryKey: qk.departments, queryFn: () => employeesApi.departments() });
  const clients = useQuery({ queryKey: qk.clients(), queryFn: () => employeesApi.clients?.() ?? [] }); // optional lookup
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card table-card">
        <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Job Details</h3>
        <div className="space-y-3 text-sm px-1">
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Status</span>
            <StatusBadge status={emp.status} />
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Designation</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">{emp.designation ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Department</span>
            <span className="text-slate-800 dark:text-slate-200">{depts.data?.find(d => d.id === emp.department_id)?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Employment Type</span>
            <span className="text-slate-800 dark:text-slate-200">{emp.employment_type ?? "Full Time"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Joining Date</span>
            <span className="text-slate-800 dark:text-slate-200">{formatDate(emp.joining_date)}</span>
          </div>
        </div>
      </div>
      
      <div className="card table-card">
        <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">Placement & Hierarchy</h3>
        <div className="space-y-3 text-sm px-1">
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Client / Project</span>
            <span className="text-slate-800 dark:text-slate-200">{emp.client_id ? "Assigned" : "Internal"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Work Location</span>
            <span className="text-slate-800 dark:text-slate-200">{emp.work_location ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2">
            <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Reporting Manager</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">
              {emp.reporting_manager_id ? (
                <Link to={`/employees/${emp.reporting_manager_id}`} className="text-accent-600 hover:underline">
                  View Manager Profile →
                </Link>
              ) : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bank Tab ─────────────────────────────────────────────────────────────
function BankTab({ emp, revealedValues, onReveal }: any) {
  return (
    <div className="max-w-2xl card table-card">
      <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
        Bank Account Details
        <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">Audited</span>
      </h3>
      <div className="space-y-3 px-1">
        <PiiField label="Bank Account Number" field="bank_account" value={emp.bank_account} revealedValues={revealedValues} onReveal={onReveal} />
        {/* IFSC is a public branch code, not sensitive PII — shown in full. */}
        <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-800/50 pb-2 last:border-0 last:pb-0">
          <span className="text-slate-500 dark:text-slate-400 text-[13px] font-medium">Bank IFSC Code</span>
          <span className="font-mono text-sm text-slate-800 dark:text-slate-200">{emp.bank_ifsc ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

// ── Compliance Tab ───────────────────────────────────────────────────────
function ComplianceTab({ emp, revealedValues, onReveal }: any) {
  return (
    <div className="max-w-2xl card table-card">
      <h3 className="mb-4 text-sm font-bold text-slate-900 dark:text-white">
        Statutory & Compliance
        <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">Audited</span>
      </h3>
      <div className="space-y-3 px-1">
        <PiiField label="Universal Account Number (UAN)" field="uan_number" value={emp.uan_number} revealedValues={revealedValues} onReveal={onReveal} />
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

  if (active.isLoading) return <FullPageSpinner />;

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Active Salary Structure</h3>
        {active.isError ? (
          <EmptyState title="No active salary structure" description="Please assign a salary structure." />
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

// ── Notes Tab ────────────────────────────────────────────────────────────
function NotesTab() {
  return (
    <EmptyState
      title="Employee Notes"
      description="This feature is coming soon. You will be able to add performance notes, warnings, and internal remarks."
      illustration="folder"
    />
  );
}
