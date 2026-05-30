import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { payrollApi } from "../api/payroll";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Spinner";
import { formatDateTime } from "../lib/format";
import { Search, Shield, X, Clock, Hash } from "lucide-react";
import clsx from "clsx";

const EVENT_TYPES = [
  "",
  "PAYROLL_RESULT_COMPUTED",
  "PAYOUT_BATCH_CREATED",
  "PAYSLIPS_GENERATED",
  "PAYROLL_CYCLE_DISBURSED",
  "PII_ACCESSED",
  "DEPARTMENT_UPDATED",
  "TDS_DECLARATION_SUBMITTED",
  "PAYOUT_TRANSACTION_RETRIED",
  "REPORT_GENERATION_REQUESTED",
  "NOTIFICATION_DISPATCHED",
];

const ENTITY_TYPES = [
  "",
  "payroll_result",
  "payroll_cycle",
  "payout_batch",
  "employee",
  "report",
  "department",
];

const EVENT_COLORS: Record<string, string> = {
  PAYROLL_RESULT_COMPUTED: "bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400",
  PAYOUT_BATCH_CREATED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  PAYSLIPS_GENERATED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  PAYROLL_CYCLE_DISBURSED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  PII_ACCESSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  DEPARTMENT_UPDATED: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  TDS_DECLARATION_SUBMITTED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  PAYOUT_TRANSACTION_RETRIED: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

export function AuditLog() {
  const [eventType, setEventType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [traceId, setTraceId] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [tab, setTab] = useState<"all" | "pii">("all");

  const activeEventType = tab === "pii" ? "PII_ACCESSED" : eventType;

  const logs = useQuery({
    queryKey: qk.audit({
      event_type: activeEventType || undefined,
      entity_type: entityType || undefined,
      trace_id: traceId || undefined,
      limit: 200,
    }),
    queryFn: () =>
      payrollApi.getAudit({
        event_type: activeEventType || undefined,
        limit: 200,
      }),
  });

  const filtered = (logs.data ?? []).filter((e) => {
    if (entityType && e.entity_type !== entityType) return false;
    if (traceId && !e.trace_id?.startsWith(traceId)) return false;
    return true;
  });

  return (
    <div className="flex gap-5">
      <div className="flex-1 min-w-0">
        <PageHeader
          title="Audit Log"
          subtitle="Immutable record of all system events"
        />

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {([["all", "All Events"], ["pii", "PII Access"]] as const).map(([t, l]) => (
            <button
              key={t}
              onClick={() => { setTab(t as "all" | "pii"); setSelected(null); }}
              className={clsx(
                "px-4 py-2.5 text-sm font-medium transition-colors",
                tab === t
                  ? "border-b-2 border-accent-600 text-accent-600 dark:text-accent-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              {l}
              {t === "pii" && (
                <Shield className="ml-1.5 inline-block h-3.5 w-3.5" />
              )}
            </button>
          ))}
        </div>

        {/* Filters */}
        {tab === "all" && (
          <div className="mb-4 flex flex-wrap gap-3">
            <div>
              <label className="label">Event Type</label>
              <select
                className="input text-sm"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t || "All events"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Entity Type</label>
              <select
                className="input text-sm"
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>{t || "All entities"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Trace ID (prefix)</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-8 w-40 text-sm"
                  placeholder="8 chars…"
                  value={traceId}
                  onChange={(e) => setTraceId(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
                <th className="th">Time</th>
                <th className="th">Event</th>
                <th className="th">Entity</th>
                <th className="th">Actor</th>
                <th className="th">Trace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
              {logs.isLoading &&
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
              {!logs.isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      title="No audit events"
                      description={
                        tab === "pii"
                          ? "No PII access events recorded."
                          : "No events match the current filters."
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  className={clsx(
                    "cursor-pointer tr-hover",
                    selected?.id === e.id && "bg-accent-50/50 dark:bg-accent-900/10"
                  )}
                  onClick={() => setSelected(selected?.id === e.id ? null : e)}
                >
                  <td className="td">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(e.created_at)}
                    </div>
                  </td>
                  <td className="td">
                    <span
                      className={clsx(
                        "rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold",
                        EVENT_COLORS[e.event_type] ??
                          "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      )}
                    >
                      {e.event_type}
                    </span>
                  </td>
                  <td className="td text-xs">
                    <span className="text-slate-600 dark:text-slate-400">{e.entity_type}</span>
                    {e.entity_id && (
                      <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                        #{e.entity_id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="td font-mono text-xs text-slate-400">
                    {e.actor_id?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="td font-mono text-xs text-slate-400">
                    {e.trace_id?.slice(0, 8) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail drawer */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.2 }}
            className="w-80 shrink-0"
          >
            <div className="card sticky top-0">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Event Detail
                </span>
                <button
                  onClick={() => setSelected(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <dl className="space-y-3 text-xs">
                <div>
                  <dt className="label">Event Type</dt>
                  <dd>
                    <span
                      className={clsx(
                        "rounded-md px-2 py-0.5 font-mono font-semibold",
                        EVENT_COLORS[selected.event_type] ??
                          "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      )}
                    >
                      {selected.event_type}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="label">Entity</dt>
                  <dd className="font-mono text-slate-700 dark:text-slate-300">
                    {selected.entity_type} / {selected.entity_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="label">Actor ID</dt>
                  <dd className="font-mono text-slate-700 dark:text-slate-300">
                    {selected.actor_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="label">Trace ID</dt>
                  <dd className="font-mono text-slate-700 dark:text-slate-300">
                    {selected.trace_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="label">Timestamp</dt>
                  <dd className="text-slate-600 dark:text-slate-400">
                    {formatDateTime(selected.created_at)}
                  </dd>
                </div>
                <div>
                  <dt className="label mb-2">Payload</dt>
                  <dd>
                    <pre className="overflow-auto rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-[10px] text-slate-700 dark:text-slate-300 max-h-64 font-mono">
                      {JSON.stringify(selected.payload, null, 2)}
                    </pre>
                  </dd>
                </div>
              </dl>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
