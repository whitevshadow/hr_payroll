import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { employeesApi } from "../api/employees";
import { salaryApi } from "../api/salary";
import { qk } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { formatINR, computeSalaryPreview } from "../lib/money";
import { formatDate } from "../lib/format";
import { FullPageSpinner } from "../components/Spinner";
import { toastService, extractErrorMessage } from "../lib/toast";
import type { Employee, SalaryStructure } from "../types";
import { DollarSign, RefreshCw, TrendingUp, Building2, Calculator } from "lucide-react";
import clsx from "clsx";

const TODAY = new Date().toISOString().slice(0, 10);

export function Salary() {
  const qc = useQueryClient();
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [ctc, setCtc] = useState("");
  const [effFrom, setEffFrom] = useState(TODAY);
  const [formError, setFormError] = useState("");

  const employees = useQuery({
    queryKey: qk.employees({ page_size: 200, status: "ACTIVE" }),
    queryFn: () => employeesApi.list({ page_size: 200, status: "ACTIVE" }),
  });

  const selectedEmp = employees.data?.items.find((e) => e.id === selectedEmpId) as Employee | undefined;

  const structure = useQuery({
    queryKey: qk.salary(selectedEmpId),
    enabled: !!selectedEmpId,
    retry: false,
    queryFn: () => salaryApi.getActive(selectedEmpId),
  });

  const preview =
    ctc && parseFloat(ctc) > 0
      ? computeSalaryPreview(parseFloat(ctc), selectedEmp?.work_location)
      : null;

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selectedEmpId || !ctc) throw new Error("Select an employee and enter CTC");
      const body = {
        employee_id: selectedEmpId,
        ctc: parseFloat(ctc),
        effective_from: effFrom,
        work_location: selectedEmp?.work_location ?? null,
      };
      if (structure.data?.id) return salaryApi.revise(structure.data.id, body);
      return salaryApi.create(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.salary(selectedEmpId) });
      setCtc("");
      setFormError("");
      toastService.success("Salary structure saved.");
    },
    onError: (err) => setFormError(extractErrorMessage(err)),
  });

  return (
    <div>
      <PageHeader
        title="Salary Structures"
        subtitle="Manage and preview employee salary breakdowns"
      />

      {/* Employee selector */}
      <div className="mb-6 max-w-sm">
        <label className="label" htmlFor="emp-sel">Select Employee</label>
        <select
          id="emp-sel"
          className="input"
          value={selectedEmpId}
          onChange={(e) => { setSelectedEmpId(e.target.value); setCtc(""); }}
        >
          <option value="">Choose an employee…</option>
          {employees.data?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.emp_code} — {e.first_name} {e.last_name} ({e.work_location ?? "?"})
            </option>
          ))}
        </select>
      </div>

      {selectedEmpId && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Active Structure */}
          <div className="card">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
                <DollarSign className="h-4 w-4 text-emerald-600" />
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Active Structure</h2>
            </div>
            {structure.isLoading && <FullPageSpinner />}
            {structure.isError && (
              <div className="flex h-32 items-center justify-center text-sm text-slate-400">
                No active salary structure yet.
              </div>
            )}
            {structure.data && (
              <>
                <div className="space-y-2">
                  {[
                    { label: "Annual CTC", value: structure.data.ctc, highlight: true },
                    { label: "Monthly Gross", value: structure.data.breakdown.monthly_gross },
                    { label: `Basic (40%)`, value: structure.data.breakdown.basic, indent: true },
                    {
                      label: `HRA (${structure.data.breakdown.is_metro ? "Metro 50%" : "Non-Metro 40%"})`,
                      value: structure.data.breakdown.hra,
                      indent: true,
                    },
                    { label: "Special Allowance", value: structure.data.breakdown.special_allowance, indent: true },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className={clsx(
                        "flex items-center justify-between rounded-lg px-3 py-2",
                        row.highlight
                          ? "bg-accent-50 dark:bg-accent-900/20"
                          : row.indent
                          ? "bg-slate-50/50 dark:bg-slate-800/30 ml-3"
                          : ""
                      )}
                    >
                      <span className={clsx("text-sm", row.indent ? "text-slate-500 dark:text-slate-400" : "text-slate-700 dark:text-slate-300")}>
                        {row.label}
                      </span>
                      <span className={clsx("text-sm font-numeric font-semibold", row.highlight ? "text-accent-700 dark:text-accent-400" : "text-slate-800 dark:text-slate-200")}>
                        {formatINR(row.value)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                  Effective from {formatDate(structure.data.effective_from)}
                </p>
              </>
            )}
          </div>

          {/* Revise / Create form */}
          <div className="card">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30">
                {structure.data ? (
                  <RefreshCw className="h-4 w-4 text-accent-600" />
                ) : (
                  <Calculator className="h-4 w-4 text-accent-600" />
                )}
              </div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {structure.data ? "Revise Structure" : "Create Structure"}
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="ctc-input">Annual CTC (₹)</label>
                <input
                  id="ctc-input"
                  className="input"
                  type="number"
                  min="0"
                  step="1000"
                  value={ctc}
                  onChange={(e) => setCtc(e.target.value)}
                  placeholder="e.g. 1200000"
                />
              </div>
              <div>
                <label className="label" htmlFor="eff-input">Effective From</label>
                <input
                  id="eff-input"
                  className="input"
                  type="date"
                  value={effFrom}
                  onChange={(e) => setEffFrom(e.target.value)}
                />
              </div>

              {preview && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-accent-100 dark:border-accent-900/30 bg-accent-50/50 dark:bg-accent-900/10 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-accent-600 dark:text-accent-400" />
                    <div className="text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-400">
                      Live Preview — {preview.isMetro ? "Metro" : "Non-Metro"}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {[
                      ["Monthly Gross", preview.monthlyGross],
                      [`Basic (40%)`, preview.basic],
                      [`HRA (${preview.isMetro ? "50%" : "40%"})`, preview.hra],
                      ["Special Allowance", preview.specialAllowance],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex items-center justify-between">
                        <span className="text-xs text-accent-700 dark:text-accent-300">{label}</span>
                        <span className="text-xs font-numeric font-semibold text-accent-800 dark:text-accent-200">
                          {formatINR(val as number)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-accent-400 dark:text-accent-600">
                    Preview only — server-authoritative values shown after save
                  </p>
                </motion.div>
              )}

              {formError && <div className="alert-danger">{formError}</div>}

              <button
                className="btn w-full"
                disabled={!ctc || saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending ? (
                  <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Saving…</>
                ) : structure.data ? "Revise Structure" : "Create Structure"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
