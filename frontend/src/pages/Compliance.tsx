import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { payrollApi } from "../api/payroll";
import { complianceApi } from "../api/compliance";
import { employeesApi } from "../api/employees";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { useClientContext } from "../lib/ClientContext";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { FullPageSpinner } from "../components/Spinner";
import { formatINR } from "../lib/money";
import { toCSV } from "../lib/csv";
import { Download, ShieldCheck } from "lucide-react";
import clsx from "clsx";

type CompTab = "pf" | "esi" | "pt";

export function Compliance() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<CompTab>("pf");
  const { selectedClientId } = useClientContext();

  const cycles = useQuery({ queryKey: qk.cycles, queryFn: () => payrollApi.listCycles() });

  const urlCycle = searchParams.get("cycle");
  const defaultCycle = cycles.data?.find((c) => c.status !== "DRAFT")?.id ?? "";
  const [cycleId, setCycleId] = useState(urlCycle || defaultCycle);

  const activeCycleId = cycleId || defaultCycle;

  const summary = useQuery({
    queryKey: qk.compliance(activeCycleId),
    queryFn: () => complianceApi.getSummary(activeCycleId),
    enabled: !!activeCycleId,
  });

  const employees = useQuery({
    queryKey: qk.employees({ page_size: 200 }),
    queryFn: () => employeesApi.list({ page_size: 200 }),
    staleTime: STALE_STABLE,
  });

  const filteredEmployees = selectedClientId
    ? (employees.data?.items ?? []).filter((e) => e.client_id === selectedClientId)
    : (employees.data?.items ?? []);

  const empMap = Object.fromEntries(
    filteredEmployees.map((e) => [
      e.id,
      `${e.first_name} ${e.last_name} (${e.emp_code})`,
    ])
  );
  const filteredEmpIds = new Set(filteredEmployees.map((e) => e.id));

  const t = summary.data?.totals;

  const TAB_LABELS: Record<CompTab, string> = {
    pf: "Provident Fund",
    esi: "ESI",
    pt: "Professional Tax",
  };

  return (
    <div>
      <PageHeader
        title="Compliance"
        subtitle="PF / ESI / PT statutory deductions by payroll cycle"
      >
        <button
          className="btn-ghost"
          disabled={!summary.data}
          onClick={() => exportCsv(tab, summary.data!, empMap)}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </PageHeader>

      {/* Cycle + Client selector */}
      <div className="mb-5 flex flex-wrap gap-3">
        <div>
          <label className="label">Cycle</label>
          <select
            className="input w-64"
            value={activeCycleId}
            onChange={(e) => setCycleId(e.target.value)}
          >
            {cycles.data
              ?.filter((c) => c.status !== "DRAFT")
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>
      </div>

      {/* Totals strip */}
      {t && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Employee PF", value: t.total_employee_pf, color: "text-accent-600", bg: "bg-accent-50 dark:bg-accent-900/30" },
            {
              label: "Employer PF",
              value: String(parseFloat(t.total_employer_pf) + parseFloat(t.total_employer_eps)),
              color: "text-violet-600",
              bg: "bg-violet-50 dark:bg-violet-900/30",
            },
            { label: "Employee ESI", value: t.total_employee_esi, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
            { label: "Employer ESI", value: t.total_employer_esi, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-900/30" },
            { label: "Prof. Tax", value: t.total_pt, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/30" },
            {
              label: "ESI Eligible",
              value: `${t.esi_eligible_count} employees`,
              color: "text-blue-600",
              bg: "bg-blue-50 dark:bg-blue-900/30",
              isText: true,
            },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card p-3"
            >
              <div className="kpi-label">{item.label}</div>
              <div className={clsx("mt-1 text-sm font-semibold font-numeric", item.color)}>
                {(item as any).isText ? item.value : formatINR(item.value)}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(["pf", "esi", "pt"] as CompTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "px-5 py-2.5 text-sm font-semibold uppercase tracking-wide transition-colors",
              tab === t
                ? "border-b-2 border-accent-600 text-accent-600 dark:text-accent-400"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {summary.isLoading && <FullPageSpinner />}
      {!summary.isLoading && !summary.data && (
        <EmptyState
          title="No compliance data"
          description="Run payroll for this cycle first."
        />
      )}

      {summary.data && tab === "pf" && (
        <PFTable rows={selectedClientId ? summary.data.pf.filter((r: any) => filteredEmpIds.has(r.employee_id)) : summary.data.pf} empMap={empMap} />
      )}
      {summary.data && tab === "esi" && (
        <ESITable rows={selectedClientId ? summary.data.esi.filter((r: any) => filteredEmpIds.has(r.employee_id)) : summary.data.esi} empMap={empMap} />
      )}
      {summary.data && tab === "pt" && (
        <PTTable rows={selectedClientId ? summary.data.pt.filter((r: any) => filteredEmpIds.has(r.employee_id)) : summary.data.pt} empMap={empMap} />
      )}
    </div>
  );
}

function PFTable({ rows, empMap }: { rows: any[]; empMap: Record<string, string> }) {
  return (
    <div className="card table-card overflow-hidden p-0">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
            <th className="th">Employee</th>
            <th className="th text-right">PF Wages</th>
            <th className="th text-right">Emp PF</th>
            <th className="th text-right">Emp EPS</th>
            <th className="th text-right">Emp EPF</th>
            <th className="th">Ceiling</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {rows.map((r) => (
            <tr key={r.employee_id} className="tr-hover">
              <td className="td text-slate-700 dark:text-slate-300">
                {empMap[r.employee_id] ?? r.employee_id.slice(0, 8)}
              </td>
              <td className="td text-right font-numeric font-medium text-slate-800 dark:text-slate-200">
                {formatINR(r.pf_wages)}
              </td>
              <td className="td text-right font-numeric text-slate-700 dark:text-slate-300">
                {formatINR(r.employee_pf)}
              </td>
              <td className="td text-right font-numeric text-slate-700 dark:text-slate-300">
                {formatINR(r.employer_eps)}
              </td>
              <td className="td text-right font-numeric text-slate-700 dark:text-slate-300">
                {formatINR(r.employer_epf)}
              </td>
              <td className="td">
                {r.is_ceiling_applied ? (
                  <span className="badge bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                    Capped
                  </span>
                ) : (
                  <span className="text-slate-300 dark:text-slate-700">—</span>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
            <td className="td text-slate-700 dark:text-slate-300">Totals</td>
            <td className="td text-right font-numeric text-slate-800 dark:text-slate-200">
              {formatINR(sum(rows, "pf_wages"))}
            </td>
            <td className="td text-right font-numeric text-slate-800 dark:text-slate-200">
              {formatINR(sum(rows, "employee_pf"))}
            </td>
            <td className="td text-right font-numeric text-slate-800 dark:text-slate-200">
              {formatINR(sum(rows, "employer_eps"))}
            </td>
            <td className="td text-right font-numeric text-slate-800 dark:text-slate-200">
              {formatINR(sum(rows, "employer_epf"))}
            </td>
            <td className="td" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ESITable({ rows, empMap }: { rows: any[]; empMap: Record<string, string> }) {
  return (
    <div className="card table-card overflow-hidden p-0">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
            <th className="th">Employee</th>
            <th className="th text-right">Gross Wages</th>
            <th className="th">Eligible</th>
            <th className="th text-right">Emp ESI</th>
            <th className="th text-right">Employer ESI</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {rows.map((r) => (
            <tr key={r.employee_id} className="tr-hover">
              <td className="td text-slate-700 dark:text-slate-300">
                {empMap[r.employee_id] ?? r.employee_id.slice(0, 8)}
              </td>
              <td className="td text-right font-numeric font-medium text-slate-800 dark:text-slate-200">
                {formatINR(r.gross_wages)}
              </td>
              <td className="td">
                {r.is_esi_eligible ? (
                  <StatusBadge status="ACTIVE" size="sm" />
                ) : (
                  <span className="text-slate-300 dark:text-slate-700">—</span>
                )}
              </td>
              <td className="td text-right font-numeric text-slate-700 dark:text-slate-300">
                {formatINR(r.employee_esi)}
              </td>
              <td className="td text-right font-numeric text-slate-700 dark:text-slate-300">
                {formatINR(r.employer_esi)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
            <td className="td text-slate-700 dark:text-slate-300">
              Totals ({rows.filter((r) => r.is_esi_eligible).length} eligible)
            </td>
            <td className="td text-right font-numeric">{formatINR(sum(rows, "gross_wages"))}</td>
            <td className="td" />
            <td className="td text-right font-numeric">{formatINR(sum(rows, "employee_esi"))}</td>
            <td className="td text-right font-numeric">{formatINR(sum(rows, "employer_esi"))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PTTable({ rows, empMap }: { rows: any[]; empMap: Record<string, string> }) {
  return (
    <div className="card table-card overflow-hidden p-0">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
            <th className="th">Employee</th>
            <th className="th">State</th>
            <th className="th text-right">PT Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
          {rows.map((r) => (
            <tr key={r.employee_id} className="tr-hover">
              <td className="td text-slate-700 dark:text-slate-300">
                {empMap[r.employee_id] ?? r.employee_id.slice(0, 8)}
              </td>
              <td className="td">
                <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-600 dark:text-slate-400">
                  {r.state}
                </span>
              </td>
              <td className="td text-right font-numeric font-medium text-slate-800 dark:text-slate-200">
                {formatINR(r.pt_amount)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold">
            <td className="td text-slate-700 dark:text-slate-300">Total</td>
            <td className="td" />
            <td className="td text-right font-numeric">{formatINR(sum(rows, "pt_amount"))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function sum(rows: any[], field: string): number {
  return rows.reduce((s, r) => s + parseFloat(r[field] || "0"), 0);
}

function exportCsv(tab: CompTab, data: any, empMap: Record<string, string>) {
  const name = (id: string) => empMap[id] ?? id.slice(0, 8);
  if (tab === "pf") {
    toCSV(
      data.pf,
      [
        { header: "Employee", value: (r: any) => name(r.employee_id) },
        { header: "PF Wages", value: (r: any) => r.pf_wages },
        { header: "Employee PF", value: (r: any) => r.employee_pf },
        { header: "Employer EPS", value: (r: any) => r.employer_eps },
        { header: "Employer EPF", value: (r: any) => r.employer_epf },
        { header: "Ceiling Applied", value: (r: any) => (r.is_ceiling_applied ? "Yes" : "No") },
      ],
      "pf-contributions.csv"
    );
  } else if (tab === "esi") {
    toCSV(
      data.esi,
      [
        { header: "Employee", value: (r: any) => name(r.employee_id) },
        { header: "Gross Wages", value: (r: any) => r.gross_wages },
        { header: "ESI Eligible", value: (r: any) => (r.is_esi_eligible ? "Yes" : "No") },
        { header: "Employee ESI", value: (r: any) => r.employee_esi },
        { header: "Employer ESI", value: (r: any) => r.employer_esi },
      ],
      "esi-contributions.csv"
    );
  } else {
    toCSV(
      data.pt,
      [
        { header: "Employee", value: (r: any) => name(r.employee_id) },
        { header: "State", value: (r: any) => r.state },
        { header: "PT Amount", value: (r: any) => r.pt_amount },
      ],
      "pt-deductions.csv"
    );
  }
}
