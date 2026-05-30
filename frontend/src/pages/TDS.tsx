import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { tdsApi } from "../api/tds";
import { payrollApi } from "../api/payroll";
import { employeesApi } from "../api/employees";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { FullPageSpinner, Skeleton } from "../components/Spinner";
import { EmptyState } from "../components/EmptyState";
import { formatINR } from "../lib/money";
import { toastService, extractErrorMessage } from "../lib/toast";
import { Receipt, AlertTriangle, FileText } from "lucide-react";
import clsx from "clsx";

export function TDS() {
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [decl, setDecl] = useState({
    sec_80c: 0, sec_80d: 0, hra_claimed: 0, other_deductions: 0,
    regime_preference: "NEW",
  });

  const qc = useQueryClient();

  const cycles = useQuery({ queryKey: qk.cycles, queryFn: () => payrollApi.listCycles() });
  const employees = useQuery({
    queryKey: qk.employees({ page_size: 200 }),
    queryFn: () => employeesApi.list({ page_size: 200 }),
  });

  const latestCycle = cycles.data?.find((c) => c.status !== "DRAFT");

  const calcQ = useQuery({
    queryKey: qk.tdsCalc(latestCycle?.id ?? "", selectedEmpId),
    queryFn: () => tdsApi.getCalculation(latestCycle!.id, selectedEmpId),
    enabled: !!latestCycle && !!selectedEmpId,
    retry: false,
  });

  const declMut = useMutation({
    mutationFn: () =>
      tdsApi.submitDeclaration({
        employee_id: selectedEmpId,
        ...decl,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.audit({}) });
      toastService.success("Declaration submitted. " + (data.note ?? ""));
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const calc = calcQ.data;

  return (
    <div>
      <PageHeader
        title="TDS"
        subtitle="Tax Deducted at Source calculations and investment declarations"
      />

      {/* Employee selector */}
      <div className="mb-6 max-w-sm">
        <label className="label" htmlFor="tds-emp-sel">Select Employee</label>
        <select
          id="tds-emp-sel"
          className="input"
          value={selectedEmpId}
          onChange={(e) => setSelectedEmpId(e.target.value)}
        >
          <option value="">Choose an employee…</option>
          {employees.data?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.emp_code} — {e.first_name} {e.last_name}
            </option>
          ))}
        </select>
      </div>

      {selectedEmpId && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* TDS Calculation */}
          <div className="card">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30">
                <Receipt className="h-4 w-4 text-accent-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  TDS Calculation
                </h2>
                {latestCycle && (
                  <p className="text-xs text-slate-400">{latestCycle.name}</p>
                )}
              </div>
            </div>

            {calcQ.isLoading && <FullPageSpinner />}
            {calcQ.isError && (
              <EmptyState
                title="No TDS calculation"
                description="Run payroll for this employee first."
              />
            )}
            {calc && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {/* Key metrics */}
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {[
                    { label: "Taxable Income", value: formatINR(calc.taxable_income), color: "text-slate-800 dark:text-slate-200" },
                    { label: "Annual Tax", value: formatINR(calc.annual_tax), color: "text-danger" },
                    { label: "Monthly TDS", value: formatINR(calc.monthly_tds), color: "text-accent-700 dark:text-accent-400" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3 text-center"
                    >
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{item.label}</div>
                      <div className={clsx("mt-1 font-numeric font-bold text-sm", item.color)}>{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Regime: <span className="font-semibold">{calc.regime_applied}</span> ·
                  Std Deduction: <span className="font-semibold font-numeric">{formatINR(calc.tax_trace.std_deduction)}</span>
                </div>

                {/* Tax slabs */}
                <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
                        <th className="th">Slab</th>
                        <th className="th text-right">Rate</th>
                        <th className="th text-right">Taxable</th>
                        <th className="th text-right">Tax</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                      {calc.tax_trace.slabs.map((s: any, i: number) => (
                        <tr key={i} className="tr-hover">
                          <td className="td text-xs text-slate-600 dark:text-slate-400">
                            {formatINR(s.slab_from)} – {s.slab_to === "inf" ? "∞" : formatINR(s.slab_to)}
                          </td>
                          <td className="td text-right text-xs">
                            {(parseFloat(s.rate) * 100).toFixed(0)}%
                          </td>
                          <td className="td text-right font-numeric text-xs">
                            {formatINR(s.taxable_in_slab)}
                          </td>
                          <td className="td text-right font-numeric text-xs font-semibold">
                            {formatINR(s.tax)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[10px] text-slate-400">
                  + 4% Health & Education Cess applied to total
                </p>
              </motion.div>
            )}
          </div>

          {/* Investment Declaration */}
          <div className="card">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/30">
                <FileText className="h-4 w-4 text-amber-600" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Investment Declaration
              </h2>
            </div>

            <div className="mb-4 alert-warning flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Old-regime computation based on these declarations arrives in V2.
                Declarations are recorded for HR records.
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Regime Preference</label>
                <select
                  className="input"
                  value={decl.regime_preference}
                  onChange={(e) => setDecl({ ...decl, regime_preference: e.target.value })}
                >
                  <option value="NEW">New Regime</option>
                  <option value="OLD">Old Regime (V2)</option>
                  <option value="AUTO">Auto Select (V2)</option>
                </select>
              </div>

              {[
                { label: "Section 80C (₹)", key: "sec_80c" as const },
                { label: "Section 80D (₹)", key: "sec_80d" as const },
                { label: "HRA Claimed (₹)", key: "hra_claimed" as const },
                { label: "Other Deductions (₹)", key: "other_deductions" as const },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    className="input font-numeric"
                    type="number"
                    min="0"
                    value={decl[key]}
                    onChange={(e) =>
                      setDecl({ ...decl, [key]: parseFloat(e.target.value) || 0 })
                    }
                  />
                </div>
              ))}

              <button
                className="btn w-full"
                disabled={declMut.isPending}
                onClick={() => declMut.mutate()}
              >
                {declMut.isPending ? (
                  <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Submitting…</>
                ) : (
                  "Submit Declaration"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
