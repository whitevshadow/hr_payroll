import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { payrollApi } from "../api/payroll";
import api from "../lib/api";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { useClientContext } from "../lib/ClientContext";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { FullPageSpinner, Spinner } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { formatDateTime } from "../lib/format";
import { toastService, extractErrorMessage } from "../lib/toast";
import { STATUTORY_DEADLINES, daysUntil, nextOccurrence } from "../data/statutory-calendar";
import {
  FileText,
  Download,
  FilePlus,
  CalendarDays,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Users,
} from "lucide-react";
import { blobstoreApi } from "../api/blobstore";
import { employeesApi } from "../api/employees";
import clsx from "clsx";

export function Reports() {
  const qc = useQueryClient();
  const [cycleId, setCycleId] = useState("");
  const { selectedClientId } = useClientContext();
  const [reportType, setReportType] = useState("");
  const [fyId, setFyId] = useState("");

  const fys = useQuery({ queryKey: ["financial-years"], queryFn: employeesApi.financialYears });
  const activeFy = fyId || fys.data?.find((f: any) => f.is_active)?.id || "";

  const cycles = useQuery({ queryKey: qk.cycles, queryFn: () => payrollApi.listCycles() });
  const defaultCycle = cycles.data?.find((c) => c.status === "DISBURSED")?.id ?? "";
  const activeCycle = cycleId || defaultCycle;

  const reports = useQuery({
    queryKey: qk.generatedReports({ cycle_id: activeCycle || undefined, report_type: reportType || undefined }),
    queryFn: () =>
      api
        .get("/reports/generated", { params: { ...(activeCycle ? { cycle_id: activeCycle } : {}), ...(reportType ? { report_type: reportType } : {}) } })
        .then((r) => r.data as any[]),
  });

  // The reporting backend has no financial-year filter, so scope by FY on the
  // client via each report's cycle. activeFy is an FY id; cycles carry the FY
  // name, so resolve id -> name first.
  const activeFyName = fys.data?.find((f: any) => f.id === activeFy)?.name;
  const cycleFy = new Map((cycles.data ?? []).map((c) => [c.id, c.financial_year]));
  const fyCycles = (cycles.data ?? []).filter((c) => !activeFyName || c.financial_year === activeFyName);
  const visibleReports = (reports.data ?? []).filter(
    (r: any) => !activeFyName || cycleFy.get(r.cycle_id) === activeFyName,
  );

  const generateMut = useMutation({
    mutationFn: (type: string) => api.post("/reports/generate", { report_type: type, cycle_id: activeCycle || undefined }).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.generatedReports({}) });
      toastService.info(data.message ?? `${data.report_type} generation queued.`);
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const downloadBlob = async (blobId: string, type: string) => {
    try {
      const res = await blobstoreApi.getPresignedUrl(blobId);
      window.open(res.url, '_blank');
    } catch (e) {
      toastService.error("Could not download report file.");
    }
  };

  
  if (!selectedClientId) {
    return (
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center mt-6">
        <Users className="h-12 w-12 text-slate-300 mb-4" />
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">No Client Selected</h2>
        <p className="text-slate-500 mt-2 max-w-sm">Please select a client from the top navigation bar to proceed.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reports & Statutory Calendar"
        subtitle="Generate compliance reports and track upcoming deadlines"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Reports panel */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30">
              <FileText className="h-4 w-4 text-accent-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Generated Reports
            </h2>
          </div>

          {/* Cycle + Type selector */}
          <div className="mb-4 flex flex-wrap gap-3">
            <div>
              <label className="label">Financial Year</label>
              <select className="input min-w-[120px]" value={activeFy} onChange={e => setFyId(e.target.value)}>
                <option value="">All FYs</option>
                {fys.data?.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Payroll Cycle</label>
              <select
                className="input min-w-[160px]"
                value={activeCycle}
                onChange={(e) => setCycleId(e.target.value)}
              >
                <option value="">All cycles</option>
                {fyCycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Report Type</label>
              <select className="input min-w-[120px]" value={reportType} onChange={e => setReportType(e.target.value)}>
                <option value="">All Types</option>
                <option value="PAYSLIP">Payslips</option>
                <option value="PF_ECR">PF ECR</option>
                <option value="ESI_ECR">ESI ECR</option>
                <option value="PT_REPORT">PT Report</option>
                <option value="FORM_16">Form 16</option>
                <option value="BANK_ADVICE">Bank Advice</option>
              </select>
            </div>
          </div>

          {/* Quick actions */}
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              className="btn-ghost-sm"
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate("PF_ECR")}
            >
              <FilePlus className="h-3.5 w-3.5" /> PF ECR
            </button>
            <button
              className="btn-ghost-sm"
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate("ESI_ECR")}
            >
              <FilePlus className="h-3.5 w-3.5" /> ESI ECR
            </button>
            <button
              className="btn-ghost-sm"
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate("PT_REPORT")}
            >
              <FilePlus className="h-3.5 w-3.5" /> PT Report
            </button>
            <button
              className="btn-ghost-sm"
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate("BANK_ADVICE")}
            >
              <FilePlus className="h-3.5 w-3.5" /> Bank Advice
            </button>
            <button
              className="btn-ghost-sm"
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate("FORM_16")}
            >
              <Download className="h-3.5 w-3.5" /> Form 16
            </button>
          </div>

          <div className="card table-card overflow-hidden p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
                  <th className="th">Type</th>
                  <th className="th">Status</th>
                  <th className="th">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {reports.isLoading && (
                  <tr><td colSpan={3}><FullPageSpinner /></td></tr>
                )}
                {!reports.isLoading && visibleReports.length === 0 && (
                  <tr><td colSpan={3}><EmptyState title="No reports yet" description="Generate a report to get started." /></td></tr>
                )}
                {visibleReports.map((r: any) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="tr-hover"
                  >
                    <td className="td">
                      <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                        {r.report_type}
                      </span>
                      {r.file_path && r.status === "COMPLETED" && (
                        <button 
                          onClick={() => downloadBlob(r.file_path, r.report_type)}
                          className="ml-3 text-xs text-blue-600 hover:underline flex items-center gap-1 inline-flex"
                        >
                          <Download className="h-3 w-3" /> Download
                        </button>
                      )}
                    </td>
                    <td className="td">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="td text-xs text-slate-400 dark:text-slate-500">
                      {formatDateTime(r.created_at)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Statutory Calendar */}
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/30">
              <CalendarDays className="h-4 w-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Statutory Calendar
            </h2>
          </div>
          <div className="space-y-2">
            {STATUTORY_DEADLINES.map((d, idx) => {
              const days = daysUntil(d);
              const next = nextOccurrence(d);
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="card p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {d.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {d.description}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                      Next:{" "}
                      {next.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={clsx(
                        "rounded-lg px-3 py-1.5 text-xs font-bold",
                        days <= 3
                          ? "bg-danger-light text-danger-dark dark:bg-danger/10 dark:text-danger"
                          : days <= 7
                          ? "bg-warning-light text-warning-dark dark:bg-warning/10 dark:text-warning"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      )}
                    >
                      {days}d
                    </span>
                    {d.link && (
                      <Link
                        to={d.link}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
