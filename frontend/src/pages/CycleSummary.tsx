import { useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { payrollApi } from "../api/payroll";
import { reportingApi } from "../api/reporting";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow, Skeleton } from "../components/Spinner";
import { formatINR } from "../lib/money";
import { ChevronLeft, FileText, AlertTriangle, CheckCircle2, Eye, Download } from "lucide-react";
import type { PayrollResult } from "../types";
import clsx from "clsx";

const ROW_HEIGHT = 56;

export function CycleSummary() {
  const { cycleId } = useParams<{ cycleId: string }>();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const summary = useQuery({
    queryKey: qk.cycleSummary(cycleId!),
    queryFn: () => payrollApi.getCycleSummary(cycleId!),
    staleTime: 30_000,
  });

  const s = summary.data;
  const results = s?.results ?? [];

  const { computed, failed } = useMemo(
    () => ({
      computed: results.filter((r) => r.status !== "FAILED"),
      failed: results.filter((r) => r.status === "FAILED"),
    }),
    [results]
  );

  const rowVirtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  return (
    <div>
      <PageHeader title="Pay Run Summary">
        <Link to={`/cycles/${cycleId}`} className="btn-ghost">
          <ChevronLeft className="h-4 w-4" />
          Back to Cycle
        </Link>
      </PageHeader>

      {/* Cycle meta */}
      {s && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="font-display text-sm font-semibold text-slate-700 dark:text-slate-300">
            {s.cycle.name}
          </span>
          <StatusBadge status={s.cycle.status} />
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="text-sm text-slate-500">
            {s.totals.count} employees
          </span>
          {failed.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-light dark:bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
              <AlertTriangle className="h-3 w-3" />
              {failed.length} failed
            </span>
          )}
        </div>
      )}

      {/* Summary KPIs */}
      {s && (
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            {
              label: "Gross Earnings",
              value: formatINR(s.totals.gross),
              color: "text-slate-900 dark:text-slate-100",
            },
            {
              label: "Total Deductions",
              value: formatINR(s.totals.deductions),
              color: "text-danger",
            },
            {
              label: "Net Payout",
              value: formatINR(s.totals.net),
              color: "text-emerald-600 dark:text-emerald-400",
            },
            {
              label: "Success Rate",
              value:
                s.totals.count > 0
                  ? `${Math.round((computed.length / s.totals.count) * 100)}%`
                  : "—",
              color:
                failed.length === 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-danger",
            },
          ].map((kpi, i) => (
            <div key={kpi.label} className="card p-4">
              <div className="kpi-label">{kpi.label}</div>
              <div
                className={clsx(
                  "mt-1 font-display text-xl font-bold tabular-nums",
                  kpi.color
                )}
              >
                {summary.isLoading ? (
                  <Skeleton className="h-6 w-24 mt-1" />
                ) : (
                  kpi.value
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payroll Register Table */}
      <div className="card table-card overflow-hidden p-0">
        {/* Fixed sticky header */}
        <div className="sticky top-0 z-10 overflow-x-auto">
          <table className="w-full min-w-[800px] table-fixed">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 backdrop-blur-sm">
                <th className="th w-[180px] text-left sticky left-0 bg-slate-50/90 dark:bg-slate-800/60">
                  Employee
                </th>
                <th className="th w-[110px] text-right">Gross</th>
                <th className="th w-[90px] text-right">PF</th>
                <th className="th w-[90px] text-right">ESI</th>
                <th className="th w-[90px] text-right">PT</th>
                <th className="th w-[90px] text-right">TDS</th>
                <th className="th w-[80px] text-right">LOP</th>
                <th className="th w-[110px] text-right font-bold text-slate-700 dark:text-slate-300">
                  Net Pay
                </th>
                <th className="th w-[80px]" />
              </tr>
            </thead>
          </table>
        </div>

        {summary.isLoading ? (
          <table className="w-full min-w-[800px] table-fixed">
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonRow key={i} cols={9} />
              ))}
            </tbody>
          </table>
        ) : results.length === 0 ? (
          <EmptyState
            title="No results yet"
            description="Run payroll to see the breakdown."
          />
        ) : (
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={{ height: Math.min(totalHeight + 2, 520) }}
          >
            <div style={{ height: totalHeight, position: "relative" }}>
              {virtualRows.map((virtualRow) => {
                const r: PayrollResult = results[virtualRow.index];
                const d = r.breakdown_json?.deductions ?? {};
                const emp = r.breakdown_json?.employee ?? {};
                const name = (emp as any).name || r.employee_id.slice(0, 8);
                const isFailed = r.status === "FAILED";

                return (
                  <div
                    key={r.id}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: virtualRow.start,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT,
                    }}
                    className={clsx(
                      "flex items-center border-b border-slate-50 dark:border-slate-800/50 min-w-[800px]",
                      isFailed
                        ? "bg-danger-light/30 dark:bg-danger/5"
                        : "hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors duration-75"
                    )}
                  >
                    {/* Employee */}
                    <div className="px-4 w-[180px] shrink-0 sticky left-0">
                      <div className="flex items-center gap-2">
                        {isFailed ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-danger shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                            {name}
                          </div>
                          {(emp as any).emp_code && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              {(emp as any).emp_code}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Gross */}
                    <div className="px-4 w-[110px] shrink-0 text-right font-numeric text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                      {formatINR(r.gross_earnings)}
                    </div>

                    {/* PF */}
                    <div className="px-4 w-[90px] shrink-0 text-right font-numeric text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatINR(d.employee_pf)}
                    </div>

                    {/* ESI */}
                    <div className="px-4 w-[90px] shrink-0 text-right font-numeric text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatINR(d.employee_esi)}
                    </div>

                    {/* PT */}
                    <div className="px-4 w-[90px] shrink-0 text-right font-numeric text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatINR(d.pt)}
                    </div>

                    {/* TDS */}
                    <div className="px-4 w-[90px] shrink-0 text-right font-numeric text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatINR(d.tds)}
                    </div>

                    {/* LOP */}
                    <div className="px-4 w-[80px] shrink-0 text-right text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {parseFloat(d.lop || "0") > 0
                        ? formatINR(d.lop)
                        : "—"}
                    </div>

                    {/* Net Pay */}
                    <div
                      className={clsx(
                        "px-4 w-[110px] shrink-0 text-right font-numeric font-bold text-sm tabular-nums",
                        isFailed
                          ? "text-danger"
                          : "text-slate-900 dark:text-slate-100"
                      )}
                    >
                      {isFailed ? "—" : formatINR(r.net_pay)}
                    </div>

                    {/* Payslip link */}
                    <div className="px-4 w-[120px] shrink-0 flex items-center justify-end gap-3 text-right">
                      {!isFailed && (
                        <>
                          <button
                            onClick={() => navigate(`/payslips/${cycleId}/${r.employee_id}`)}
                            title="View Payslip"
                            className="inline-flex items-center text-accent-600 hover:text-accent-700 dark:text-accent-400 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await reportingApi.downloadPayslipPdf(cycleId!, r.employee_id);
                              } catch (e) {
                                alert("Failed to download payslip.");
                              }
                            }}
                            title="Download Payslip"
                            className="inline-flex items-center text-accent-600 hover:text-accent-700 dark:text-accent-400 transition-colors"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {isFailed && r.error && (
                        <span
                          title={r.error}
                          className="text-[10px] text-danger cursor-help truncate block max-w-[60px]"
                        >
                          {r.error.slice(0, 16)}…
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Totals row */}
        {s && results.length > 0 && (
          <div className="flex items-center border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-0 py-2 min-w-[800px]">
            <div className="px-4 w-[180px] shrink-0 text-sm font-bold text-slate-700 dark:text-slate-300">
              Totals ({s.totals.count})
            </div>
            <div className="px-4 w-[110px] shrink-0 text-right font-bold font-numeric text-sm text-slate-800 dark:text-slate-200 tabular-nums">
              {formatINR(s.totals.gross)}
            </div>
            <div className="px-4 w-[90px] shrink-0" />
            <div className="px-4 w-[90px] shrink-0" />
            <div className="px-4 w-[90px] shrink-0" />
            <div className="px-4 w-[90px] shrink-0" />
            <div className="px-4 w-[80px] shrink-0" />
            <div className="px-4 w-[110px] shrink-0 text-right font-bold font-numeric text-sm text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatINR(s.totals.net)}
            </div>
            <div className="px-4 w-[80px] shrink-0" />
          </div>
        )}
      </div>

      <div className="mt-2 text-xs text-slate-400">
        {results.length > 0 &&
          `${results.length} employee${results.length !== 1 ? "s" : ""} · Payroll Register`}
      </div>
    </div>
  );
}
