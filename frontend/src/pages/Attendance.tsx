import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { employeesApi } from "../api/employees";
import { attendanceApi } from "../api/attendance";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { currentMonthValue, monthToFirst } from "../lib/format";
import { toastService, extractErrorMessage } from "../lib/toast";
import { Save, Calendar, CheckCircle2, AlertCircle } from "lucide-react";
import { SkeletonRow } from "../components/Spinner";
import clsx from "clsx";

interface RowState {
  employee_id: string;
  emp_code: string;
  name: string;
  total_days: number;
  present_days: number;
  saved: boolean;
  saving: boolean;
  error: string;
}

export function Attendance() {
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState<RowState[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [savingAll, setSavingAll] = useState(false);

  const employees = useQuery({
    queryKey: qk.employees({ status: "ACTIVE", page_size: 200 }),
    queryFn: () => employeesApi.list({ status: "ACTIVE", page_size: 200 }),
    staleTime: STALE_STABLE,
  });

  useEffect(() => {
    if (!employees.data) return;
    setLoadingRows(true);
    const emps = employees.data.items;

    Promise.all(
      emps.map(async (e) => {
        let total = 30;
        let present = 30;
        try {
          const rec = await attendanceApi.get(e.id, month);
          total = rec.total_days;
          present = parseFloat(rec.present_days);
        } catch {
          // 404 means no record yet
        }
        return {
          employee_id: e.id,
          emp_code: e.emp_code,
          name: `${e.first_name} ${e.last_name}`,
          total_days: total,
          present_days: present,
          saved: false,
          saving: false,
          error: "",
        };
      })
    ).then((r) => {
      setRows(r);
      setLoadingRows(false);
    });
  }, [employees.data, month]);

  function updateRow(i: number, patch: Partial<RowState>) {
    setRows((rs) =>
      rs.map((r, idx) => (idx === i ? { ...r, ...patch, saved: false } : r))
    );
  }

  async function saveRow(i: number) {
    const r = rows[i];
    updateRow(i, { saving: true, error: "" });
    try {
      await attendanceApi.upsert({
        employee_id: r.employee_id,
        month: monthToFirst(month),
        total_days: r.total_days,
        present_days: r.present_days,
      });
      updateRow(i, { saving: false, saved: true });
    } catch (err) {
      updateRow(i, { saving: false, error: extractErrorMessage(err) });
    }
  }

  async function saveAll() {
    setSavingAll(true);
    for (let i = 0; i < rows.length; i++) {
      await saveRow(i);
    }
    setSavingAll(false);
    toastService.success("All attendance records saved.");
  }

  const savedCount = rows.filter((r) => r.saved).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Enter and manage monthly attendance for all employees"
      >
        <button
          className="btn"
          onClick={saveAll}
          disabled={loadingRows || rows.length === 0 || savingAll}
        >
          {savingAll ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Saving All…
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save All
            </>
          )}
        </button>
      </PageHeader>

      {/* Controls + Summary */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="month-pick">
            Month
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="month-pick"
              className="input w-44 pl-9"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </div>

        {!loadingRows && rows.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            {savedCount > 0 && (
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {savedCount} saved
              </div>
            )}
            {errorCount > 0 && (
              <div className="flex items-center gap-1.5 text-danger">
                <AlertCircle className="h-4 w-4" />
                {errorCount} errors
              </div>
            )}
            <span className="text-slate-400">{rows.length} employees</span>
          </div>
        )}
      </div>

      <div className="card table-card overflow-hidden p-0">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <th className="th">Code</th>
              <th className="th">Employee</th>
              <th className="th text-right">Total Days</th>
              <th className="th text-right">Present</th>
              <th className="th text-right">LOP</th>
              <th className="th text-right">Payable</th>
              <th className="th w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {loadingRows &&
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}
            {!loadingRows && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="td py-8 text-center text-slate-400">
                  No active employees found.
                </td>
              </tr>
            )}
            {!loadingRows &&
              rows.map((r, i) => {
                const lop = Math.max(0, r.total_days - r.present_days);
                const payable = r.total_days - lop;
                return (
                  <tr
                    key={r.employee_id}
                    className={clsx(
                      "tr-hover",
                      r.saved && "bg-emerald-50/30 dark:bg-emerald-900/5",
                      r.error && "bg-danger-light/30 dark:bg-danger/5"
                    )}
                  >
                    <td className="td">
                      <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-600 dark:text-slate-400">
                        {r.emp_code}
                      </span>
                    </td>
                    <td className="td font-medium text-slate-800 dark:text-slate-200">
                      {r.name}
                    </td>
                    <td className="td">
                      <input
                        className="input w-20 text-right font-numeric"
                        type="number"
                        min="1"
                        max="31"
                        value={r.total_days}
                        onChange={(e) =>
                          updateRow(i, { total_days: parseInt(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="td">
                      <input
                        className="input w-20 text-right font-numeric"
                        type="number"
                        min="0"
                        step="0.5"
                        value={r.present_days}
                        onChange={(e) =>
                          updateRow(i, { present_days: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="td text-right">
                      <span
                        className={clsx(
                          "font-numeric font-medium text-sm",
                          lop > 0 ? "text-danger" : "text-slate-400"
                        )}
                      >
                        {lop}
                      </span>
                    </td>
                    <td className="td text-right font-numeric font-medium text-sm text-slate-700 dark:text-slate-300">
                      {payable}
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-2">
                        {r.error && (
                          <span className="text-xs text-danger truncate max-w-[80px]" title={r.error}>
                            Error
                          </span>
                        )}
                        <button
                          className={clsx(
                            r.saved
                              ? "flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                              : "btn-ghost-sm"
                          )}
                          disabled={r.saving}
                          onClick={() => saveRow(i)}
                        >
                          {r.saving ? (
                            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                          ) : r.saved ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Saved
                            </>
                          ) : (
                            "Save"
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
