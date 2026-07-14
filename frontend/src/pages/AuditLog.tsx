import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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

const ROW_HEIGHT = 52;

export function AuditLog() {
  const [eventType, setEventType] = useState("");
  const [entityType, setEntityType] = useState("");
  const [traceId, setTraceId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [tab, setTab] = useState<"all" | "pii">("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeEventType = tab === "pii" ? "PII_ACCESSED" : eventType;

  // The key must match what the queryFn actually sends. entity_type / trace_id
  // are applied client-side in `filtered`, so keeping them in the key only
  // spawned a new cache entry and re-fetched the same 500 rows on every
  // keystroke.
  const logs = useQuery({
    queryKey: qk.audit({
      event_type: activeEventType || undefined,
      limit: 500,
    }),
    queryFn: () =>
      payrollApi.getAudit({
        event_type: activeEventType || undefined,
        limit: 500,
      }),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const raw = logs.data ?? [];
    return raw.filter((e) => {
      if (entityType && e.entity_type !== entityType) return false;
      if (traceId && !e.trace_id?.startsWith(traceId)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.event_type.toLowerCase().includes(q) ||
          (e.entity_id ?? "").toLowerCase().includes(q) ||
          (e.actor_id ?? "").toLowerCase().includes(q) ||
          (e.trace_id ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs.data, entityType, traceId, search]);

  // Virtualizer for large lists
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  return (
    <div className="flex gap-5">
      <div className="flex-1 min-w-0">
        <PageHeader
          title="Audit Log"
          subtitle={`Immutable record of all system events${filtered.length > 0 ? ` — ${filtered.length} entries` : ""}`}
        />

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {(
            [
              ["all", "All Events"],
              ["pii", "PII Access"],
            ] as const
          ).map(([t, l]) => (
            <button
              key={t}
              onClick={() => {
                setTab(t as "all" | "pii");
                setSelected(null);
              }}
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
        <div className="mb-4 flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8 w-48 text-sm"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {tab === "all" && (
            <>
              <div>
                <select
                  className="input text-sm"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t || "All events"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  className="input text-sm"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value)}
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t || "All entities"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-8 w-36 text-sm"
                  placeholder="Trace ID…"
                  value={traceId}
                  onChange={(e) => setTraceId(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {/* Virtualized table */}
        <div className="card table-card overflow-hidden p-0">
          {/* Fixed header */}
          <div className="sticky top-0 z-10">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 backdrop-blur-sm">
                  <th className="th w-[160px]">Time</th>
                  <th className="th w-[240px]">Event</th>
                  <th className="th w-[200px]">Entity</th>
                  <th className="th w-[100px]">Actor</th>
                  <th className="th w-[100px]">Trace</th>
                </tr>
              </thead>
            </table>
          </div>

          {logs.isLoading ? (
            <table className="w-full table-fixed">
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonRow key={i} cols={5} />
                ))}
              </tbody>
            </table>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No audit events"
              description={
                tab === "pii"
                  ? "No PII access events recorded."
                  : "No events match the current filters."
              }
            />
          ) : (
            <div
              ref={scrollRef}
              className="overflow-auto"
              style={{ height: Math.min(totalHeight + 2, 560) }}
            >
              <div style={{ height: totalHeight, position: "relative" }}>
                {virtualRows.map((virtualRow) => {
                  const e = filtered[virtualRow.index];
                  const isSelected = selected?.id === e.id;
                  return (
                    <div
                      key={e.id}
                      data-index={virtualRow.index}
                      style={{
                        position: "absolute",
                        top: virtualRow.start,
                        left: 0,
                        right: 0,
                        height: ROW_HEIGHT,
                      }}
                      onClick={() =>
                        setSelected(isSelected ? null : e)
                      }
                      className={clsx(
                        "flex items-center cursor-pointer border-b border-slate-50 dark:border-slate-800/50 px-0 transition-colors duration-75",
                        isSelected
                          ? "bg-accent-50/60 dark:bg-accent-900/12"
                          : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      )}
                    >
                      {/* Time */}
                      <div className="px-4 w-[160px] shrink-0 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        <Clock className="h-3 w-3 shrink-0" />
                        {formatDateTime(e.created_at)}
                      </div>

                      {/* Event */}
                      <div className="px-4 w-[240px] shrink-0">
                        <span
                          className={clsx(
                            "rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold",
                            EVENT_COLORS[e.event_type] ??
                              "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          )}
                        >
                          {e.event_type}
                        </span>
                      </div>

                      {/* Entity */}
                      <div className="px-4 w-[200px] shrink-0 text-xs">
                        <span className="text-slate-600 dark:text-slate-400">
                          {e.entity_type}
                        </span>
                        {e.entity_id && (
                          <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                            #{e.entity_id.slice(0, 8)}
                          </span>
                        )}
                      </div>

                      {/* Actor */}
                      <div className="px-4 w-[100px] shrink-0 font-mono text-xs text-slate-400">
                        {e.actor_id?.slice(0, 8) ?? "—"}
                      </div>

                      {/* Trace */}
                      <div className="px-4 w-[100px] shrink-0 font-mono text-xs text-slate-400">
                        {e.trace_id?.slice(0, 8) ?? "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Row count */}
        {filtered.length > 0 && (
          <div className="mt-2 text-xs text-slate-400">
            Showing {filtered.length} event{filtered.length !== 1 ? "s" : ""}{" "}
            {filtered.length < (logs.data?.length ?? 0) &&
              `(filtered from ${logs.data?.length})`}
          </div>
        )}
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
                <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Event Detail
                </span>
                <button
                  onClick={() => setSelected(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition-colors"
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
                    {selected.entity_type} /{" "}
                    {selected.entity_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="label">Actor ID</dt>
                  <dd className="font-mono text-slate-700 dark:text-slate-300 break-all">
                    {selected.actor_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="label">Trace ID</dt>
                  <dd className="font-mono text-slate-700 dark:text-slate-300 break-all">
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
                    <pre className="overflow-auto rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-[10px] text-slate-700 dark:text-slate-300 max-h-56 font-mono leading-relaxed">
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
