import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { payrollApi } from "../api/payroll";
import { payoutApi } from "../api/payout";
import { reportingApi } from "../api/reporting";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { Stepper } from "../components/Stepper";
import { StatusBadge } from "../components/StatusBadge";
import { Spinner } from "../components/Spinner";
import { formatDate } from "../lib/format";
import { formatINR } from "../lib/money";
import { toastService, extractErrorMessage } from "../lib/toast";
import { useAuth } from "../lib/auth";
import { canApprove as canApproveRole } from "../lib/roles";
import type { PayoutBatch } from "../types";
import {
  ArrowLeft,
  Play,
  CheckCircle,
  FileText,
  AlertTriangle,
  Loader2,
  DollarSign,
  Users,
  TrendingDown,
  Download,
} from "lucide-react";
import clsx from "clsx";

export function CycleDetail() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [polling, setPolling] = useState(false);

  const cycle = useQuery({
    queryKey: qk.cycle(cycleId!),
    queryFn: () => payrollApi.getCycle(cycleId!),
    refetchInterval: polling ? 2000 : false,
  });

  const c = cycle.data;

  useEffect(() => {
    if (c?.status === "COMPUTING" || c?.status === "LOCKED") {
      setPolling(true);
    } else {
      setPolling(false);
    }
  }, [c?.status]);

  const summaryQ = useQuery({
    queryKey: qk.cycleSummary(cycleId!),
    queryFn: () => payrollApi.getCycleSummary(cycleId!),
    enabled: !!c && c.status !== "DRAFT" && c.status !== "LOCKED",
  });

  const runMut = useMutation({
    mutationFn: () => payrollApi.runCycle(cycleId!),
    onSuccess: () => {
      setPolling(true);
      qc.invalidateQueries({ queryKey: qk.cycle(cycleId!) });
    },
    onError: (err) => {
      const msg = extractErrorMessage(err);
      const isConflict = (err as any)?.response?.status === 409;
      toastService.error(isConflict ? "Invalid action for current cycle state." : msg);
      qc.invalidateQueries({ queryKey: qk.cycle(cycleId!) });
    },
  });

  const approveMut = useMutation({
    mutationFn: () => payrollApi.approveCycle(cycleId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.cycle(cycleId!) });
      qc.invalidateQueries({ queryKey: qk.cycleSummary(cycleId!) });
      qc.invalidateQueries({ queryKey: qk.payoutBatches(cycleId!) });
      qc.invalidateQueries({ queryKey: qk.cycles });
      toastService.success("Cycle approved and disbursed!");
    },
    onError: (err) => {
      const isConflict = (err as any)?.response?.status === 409;
      toastService.error(
        isConflict ? "Invalid action for current cycle state." : extractErrorMessage(err)
      );
      qc.invalidateQueries({ queryKey: qk.cycle(cycleId!) });
    },
  });

  const bulkMut = useMutation({
    mutationFn: () => reportingApi.downloadBulkPayslips(cycleId!),
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const batches = useQuery({
    queryKey: qk.payoutBatches(cycleId!),
    queryFn: () => payoutApi.getBatches(cycleId!),
    enabled: c?.status === "DISBURSED",
  });

  if (cycle.isLoading)
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  if (!c)
    return (
      <div className="alert-danger">Cycle not found.</div>
    );

  const canRun = ["DRAFT", "COMPUTED", "FAILED"].includes(c.status);
  const roleCanApprove = canApproveRole(user);
  const stateCanApprove = c.status === "COMPUTED";
  const canApprove = stateCanApprove && roleCanApprove;
  const isDisbursed = c.status === "DISBURSED";
  const isComputing = c.status === "COMPUTING" || c.status === "LOCKED";

  const results = summaryQ.data?.results ?? [];
  const failedCount = results.filter((r) => r.status === "FAILED").length;
  const successCount = results.filter((r) => r.status !== "FAILED").length;
  const netTotal = results
    .filter((r) => r.status !== "FAILED")
    .reduce((s, r) => s + parseFloat(r.net_pay || "0"), 0);

  return (
    <div className="space-y-5">
      <PageHeader title={c.name} subtitle={`${formatDate(c.period_start)} → ${formatDate(c.period_end)}`}>
        <Link to="/cycles" className="btn-ghost">
          <ArrowLeft className="h-4 w-4" />
          Back to Cycles
        </Link>
      </PageHeader>

      {/* Status + Stepper */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StatusBadge status={c.status} />
            {isComputing && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Computing payroll… this may take a moment.
              </div>
            )}
          </div>
        </div>
        <Stepper status={c.status} />
      </div>

      {/* Summary KPIs (when available) */}
      {summaryQ.data && results.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            {
              label: "Employees",
              value: results.length,
              icon: Users,
              color: "text-accent-600",
              bg: "bg-accent-50 dark:bg-accent-900/30",
            },
            {
              label: "Successful",
              value: successCount,
              icon: CheckCircle,
              color: "text-emerald-600",
              bg: "bg-emerald-50 dark:bg-emerald-900/30",
            },
            {
              label: "Failed",
              value: failedCount,
              icon: AlertTriangle,
              color: failedCount > 0 ? "text-danger" : "text-slate-400",
              bg: failedCount > 0
                ? "bg-danger-light dark:bg-danger/10"
                : "bg-slate-50 dark:bg-slate-800",
            },
            {
              label: "Net Payout",
              value: formatINR(netTotal),
              icon: DollarSign,
              color: "text-blue-600",
              bg: "bg-blue-50 dark:bg-blue-900/30",
            },
          ].map((kpi) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="card flex flex-col gap-2"
            >
              <div className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", kpi.bg)}>
                <kpi.icon className={clsx("h-4 w-4", kpi.color)} />
              </div>
              <div>
                <div className="kpi-label">{kpi.label}</div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-50 font-numeric mt-0.5">
                  {kpi.value}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn"
            disabled={!canRun || runMut.isPending || isComputing}
            onClick={() => runMut.mutate()}
          >
            {runMut.isPending || isComputing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run Payroll
              </>
            )}
          </button>

          <Link
            to={`/cycles/${cycleId}/summary`}
            className={clsx(
              "btn-ghost",
              c.status === "DRAFT" && "pointer-events-none opacity-40"
            )}
          >
            <FileText className="h-4 w-4" />
            Review Summary
          </Link>

          <button
            className={clsx(
              "btn-ghost",
              (!isDisbursed && c.status !== "COMPUTED") && "pointer-events-none opacity-40"
            )}
            onClick={() => bulkMut.mutate()}
            disabled={bulkMut.isPending}
          >
            {bulkMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download ZIP
          </button>

          <span
            title={
              !roleCanApprove
                ? "Requires PAYROLL_ADMIN or ORG_ADMIN role"
                : !stateCanApprove
                ? "Cycle must be COMPUTED to approve"
                : undefined
            }
          >
            <button
              className={clsx("btn", canApprove && "bg-emerald-600 hover:bg-emerald-700")}
              disabled={!canApprove || approveMut.isPending}
              onClick={() => approveMut.mutate()}
            >
              {approveMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Disbursing…
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Approve & Disburse
                </>
              )}
            </button>
          </span>
        </div>

        {!roleCanApprove && (
          <p className="mt-3 text-xs text-slate-400">
            Approve & Disburse requires PAYROLL_ADMIN or ORG_ADMIN role.
          </p>
        )}

        {runMut.data && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50 dark:bg-blue-900/10 p-4"
          >
            <div className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">
              Run complete
            </div>
            <p className="text-sm text-blue-700 dark:text-blue-400">
              {runMut.data.computed} computed, {runMut.data.failed} failed (
              {runMut.data.total_employees} total)
            </p>
            {(runMut.data.errors?.length ?? 0) > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-danger-dark dark:text-danger space-y-0.5">
                {runMut.data.errors?.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </div>

      {/* Payout summary when disbursed */}
      {isDisbursed && batches.data && batches.data.length > 0 && (
        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">
            Payout Summary
          </h2>
          <div className="space-y-2">
            {batches.data.map((b: PayoutBatch) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <DollarSign className="h-4 w-4 text-slate-400" />
                  <div>
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Batch{" "}
                      <span className="font-mono text-xs text-slate-400">
                        #{b.id.slice(0, 8)}
                      </span>
                    </div>
                    <StatusBadge status={b.status} size="sm" />
                  </div>
                </div>
                <div className="font-numeric font-semibold text-slate-800 dark:text-slate-200">
                  {formatINR(b.total_amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
