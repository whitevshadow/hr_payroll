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
} from "lucide-react";
import clsx from "clsx";

export function Reports() {
  const qc = useQueryClient();
  const [cycleId, setCycleId] = useState("");
  const { selectedClientId } = useClientContext();

  const cycles = useQuery({ queryKey: qk.cycles, queryFn: () => payrollApi.listCycles() });
  const defaultCycle = cycles.data?.find((c) => c.status === "DISBURSED")?.id ?? "";
  const activeCycle = cycleId || defaultCycle;

  const reports = useQuery({
    queryKey: qk.generatedReports({ cycle_id: activeCycle || undefined }),
    queryFn: () =>
      api
        .get("/reports/generated", { params: activeCycle ? { cycle_id: activeCycle } : {} })
        .then((r) => r.data as any[]),
  });

  const form16Mut = useMutation({
    mutationFn: () =>
      api.post(`/reports/form-16/${new Date().getFullYear()}`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.generatedReports({}) });
      toastService.info(data.reason ?? "Form 16 request queued.");
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const pfecrMut = useMutation({
    mutationFn: () =>
      api.post(`/reports/pf-ecr/${activeCycle}`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.generatedReports({}) });
      toastService.info(data.reason ?? "PF ECR request queued.");
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

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

          {/* Cycle + Client selector */}
          <div className="mb-4 flex flex-wrap gap-3">
            <div>
              <label className="label">Payroll Cycle</label>
              <select
                className="input w-56"
                value={activeCycle}
                onChange={(e) => setCycleId(e.target.value)}
              >
                <option value="">All cycles</option>
                {cycles.data?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick actions */}
          <div className="mb-4 flex flex-wrap gap-2">
            {activeCycle && (
              <Link
                to={`/cycles/${activeCycle}/summary`}
                className="btn-ghost-sm"
              >
                <FileText className="h-3.5 w-3.5" />
                Payslips
              </Link>
            )}
            <button
              className="btn-ghost-sm"
              disabled={!activeCycle || pfecrMut.isPending}
              onClick={() => pfecrMut.mutate()}
            >
              {pfecrMut.isPending ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <FilePlus className="h-3.5 w-3.5" />
              )}
              Generate PF ECR
            </button>
            <button
              className="btn-ghost-sm"
              disabled={form16Mut.isPending}
              onClick={() => form16Mut.mutate()}
            >
              {form16Mut.isPending ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Generate Form 16
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
                {!reports.isLoading && (reports.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={3}><EmptyState title="No reports yet" description="Generate a report to get started." /></td></tr>
                )}
                {reports.data?.map((r: any) => (
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
                      {(r.report_type === "FORM_16" || r.report_type === "PF_ECR") && (
                        <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">
                          Coming in V2
                        </span>
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
