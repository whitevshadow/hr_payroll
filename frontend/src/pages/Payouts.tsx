import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payrollApi } from "../api/payroll";
import { payoutApi } from "../api/payout";
import api from "../lib/api";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { FullPageSpinner, SkeletonRow } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { formatINR } from "../lib/money";
import { toastService, extractErrorMessage } from "../lib/toast";
import { motion } from "framer-motion";
import { CreditCard, CheckCircle2, AlertTriangle, DollarSign, RefreshCw } from "lucide-react";
import clsx from "clsx";

export function Payouts() {
  const qc = useQueryClient();

  const cycles = useQuery({ queryKey: qk.cycles, queryFn: () => payrollApi.listCycles() });
  const latestDisbursed = cycles.data?.find((c) => c.status === "DISBURSED");
  const [cycleId, setCycleId] = useState<string>(() => latestDisbursed?.id ?? "");

  const activeCycle = cycleId || latestDisbursed?.id || "";

  const batchesQ = useQuery({
    queryKey: qk.payoutBatches(activeCycle),
    queryFn: () => payoutApi.getBatches(activeCycle),
    enabled: !!activeCycle,
  });

  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const activeBatch = selectedBatch || batchesQ.data?.[0]?.id || "";

  const txnsQ = useQuery({
    queryKey: qk.payoutTransactions(activeBatch),
    queryFn: () => payoutApi.getTransactions(activeBatch),
    enabled: !!activeBatch,
  });

  const retryMut = useMutation({
    mutationFn: (txnId: string) =>
      api.post(`/payouts/transactions/${txnId}/retry`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.payoutTransactions(activeBatch) });
      toastService.success("Transaction retried successfully.");
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const txns = txnsQ.data ?? [];
  const success = txns.filter((t) => t.status === "SUCCESS").length;
  const failed = txns.filter((t) => t.status === "FAILED" || t.status === "MANUAL_REVIEW").length;
  const total = txns.reduce((s, t) => s + parseFloat(t.amount || "0"), 0);

  return (
    <div>
      <PageHeader title="Payouts" subtitle="Disbursement batches and transaction status" />

      {/* Selectors */}
      <div className="mb-5 flex flex-wrap gap-3">
        <div>
          <label className="label">Cycle</label>
          <select
            className="input w-64"
            value={activeCycle}
            onChange={(e) => { setCycleId(e.target.value); setSelectedBatch(""); }}
          >
            {cycles.data
              ?.filter((c) => ["DISBURSED", "APPROVED"].includes(c.status))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>
        {batchesQ.data && batchesQ.data.length > 1 && (
          <div>
            <label className="label">Batch</label>
            <select
              className="input w-56"
              value={activeBatch}
              onChange={(e) => setSelectedBatch(e.target.value)}
            >
              {batchesQ.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batch_type} — {formatINR(b.total_amount)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary KPIs */}
      {txns.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-4">
          {[
            {
              label: "Successful",
              value: success,
              icon: CheckCircle2,
              color: "text-emerald-600",
              bg: "bg-emerald-50 dark:bg-emerald-900/30",
            },
            {
              label: "Failed / Review",
              value: failed,
              icon: AlertTriangle,
              color: failed > 0 ? "text-danger" : "text-slate-400",
              bg: failed > 0 ? "bg-danger-light dark:bg-danger/10" : "bg-slate-50 dark:bg-slate-800",
            },
            {
              label: "Total Disbursed",
              value: formatINR(total),
              icon: DollarSign,
              color: "text-blue-600",
              bg: "bg-blue-50 dark:bg-blue-900/30",
            },
          ].map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="card flex items-center gap-4"
            >
              <div className={clsx("flex h-10 w-10 items-center justify-center rounded-xl", kpi.bg)}>
                <kpi.icon className={clsx("h-5 w-5", kpi.color)} />
              </div>
              <div>
                <div className="kpi-label">{kpi.label}</div>
                <div className="text-xl font-bold text-slate-900 dark:text-slate-50 font-numeric mt-0.5">
                  {kpi.value}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Transactions table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Employee</th>
              <th className="th text-right">Amount</th>
              <th className="th">Status</th>
              <th className="th">Bank Reference</th>
              <th className="th">Idempotency Key</th>
              <th className="th w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {txnsQ.isLoading && (
              <tr>
                <td colSpan={6} className="td text-center">
                  <FullPageSpinner />
                </td>
              </tr>
            )}
            {!txnsQ.isLoading && txns.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    title="No transactions"
                    description="Select a disbursed cycle to view transactions."
                  />
                </td>
              </tr>
            )}
            {txns.map((t, idx) => (
              <motion.tr
                key={t.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.02 }}
                className={clsx(
                  "tr-hover",
                  (t.status === "FAILED" || t.status === "MANUAL_REVIEW") &&
                    "bg-danger-light/20 dark:bg-danger/5"
                )}
              >
                <td className="td">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {t.employee_id.slice(0, 8)}…
                  </span>
                </td>
                <td className="td text-right">
                  <span className="font-numeric font-semibold text-slate-800 dark:text-slate-200">
                    {formatINR(t.amount)}
                  </span>
                </td>
                <td className="td">
                  <StatusBadge status={t.status} />
                </td>
                <td className="td font-mono text-xs text-slate-400">
                  {t.bank_reference ?? "—"}
                </td>
                <td className="td font-mono text-xs text-slate-400">
                  {t.idempotency_key.slice(0, 12)}…
                </td>
                <td className="td">
                  {(t.status === "FAILED" || t.status === "MANUAL_REVIEW") && (
                    <button
                      className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 disabled:opacity-50"
                      disabled={retryMut.isPending}
                      onClick={() => retryMut.mutate(t.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </button>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
