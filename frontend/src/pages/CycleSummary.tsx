import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { payrollApi } from "../api/payroll";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRow } from "../components/Spinner";
import { formatINR } from "../lib/money";
import type { PayrollResult } from "../types";

export function CycleSummary() {
  const { cycleId } = useParams<{ cycleId: string }>();

  const summary = useQuery({
    queryKey: qk.cycleSummary(cycleId!),
    queryFn: () => payrollApi.getCycleSummary(cycleId!),
  });

  const s = summary.data;

  return (
    <div>
      <PageHeader title="Pay Run Summary">
        <Link to={`/cycles/${cycleId}`} className="btn-ghost">
          ← Cycle
        </Link>
      </PageHeader>

      {s && (
        <div className="mb-4 flex items-center gap-3 text-sm text-gray-500">
          <span>{s.cycle.name}</span>
          <StatusBadge status={s.cycle.status} />
          <span className="text-gray-400">·</span>
          <span>{s.totals.count} employees</span>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="th sticky left-0 bg-gray-50">Employee</th>
              <th className="th text-right">Gross</th>
              <th className="th text-right">PF</th>
              <th className="th text-right">ESI</th>
              <th className="th text-right">PT</th>
              <th className="th text-right">TDS</th>
              <th className="th text-right">LOP</th>
              <th className="th text-right font-semibold">Net Pay</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {summary.isLoading &&
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={9} />)}
            {!summary.isLoading && s?.results.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title="No results yet"
                    description="Run payroll to see the breakdown."
                  />
                </td>
              </tr>
            )}
            {s?.results.map((r: PayrollResult) => {
              const d = r.breakdown_json?.deductions ?? {};
              const emp = r.breakdown_json?.employee ?? {};
              const name = emp.name || r.employee_id.slice(0, 8);
              return (
                <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                  <td className="td sticky left-0 bg-inherit">
                    <div className="font-medium">{name}</div>
                    {emp.emp_code && (
                      <div className="text-[10px] text-gray-400">{emp.emp_code}</div>
                    )}
                    {r.status === "FAILED" && (
                      <span className="text-xs text-red-600">FAILED</span>
                    )}
                  </td>
                  <td className="td text-right font-mono">{formatINR(r.gross_earnings)}</td>
                  <td className="td text-right font-mono">{formatINR(d.employee_pf)}</td>
                  <td className="td text-right font-mono">{formatINR(d.employee_esi)}</td>
                  <td className="td text-right font-mono">{formatINR(d.pt)}</td>
                  <td className="td text-right font-mono">{formatINR(d.tds)}</td>
                  <td className="td text-right font-mono">{formatINR(d.lop)}</td>
                  <td className="td text-right font-mono font-semibold">{formatINR(r.net_pay)}</td>
                  <td className="td text-right">
                    {r.status !== "FAILED" && (
                      <Link
                        to={`/payslips/${cycleId}/${r.employee_id}`}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Payslip
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {s && s.results.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="td">Totals ({s.totals.count})</td>
                <td className="td text-right font-mono">{formatINR(s.totals.gross)}</td>
                <td className="td" colSpan={5}></td>
                <td className="td text-right font-mono">{formatINR(s.totals.net)}</td>
                <td className="td"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
