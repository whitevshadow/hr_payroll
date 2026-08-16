import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, Download, FileSpreadsheet } from "lucide-react";
import { useClientContext } from "../lib/ClientContext";
import { clientsApi } from "../api/clients";
import { payrollApi } from "../api/payroll";
import { attendanceApi } from "../api/attendance";
import { employeesApi } from "../api/employees";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { FullPageSpinner } from "../components/Spinner";
import { qk, STALE_STABLE } from "../lib/queryClient";
import type { PayrollResult, BreakdownEarnings, BreakdownDeductions } from "../types";
import clsx from "clsx";

/**
 * Paysheet — the monthly wage register, in the layout the client files.
 *
 * Reconstructed from two sources rather than a new backend report: the payroll
 * cycle summary carries the money (breakdown_json.earnings / .deductions), and
 * the attendance month carries the day counts the register splits into Present
 * / P.H / Wo.f. Payroll's own breakdown only keeps present, payable and LOP
 * days, so the holiday and weekly-off columns have to come from attendance.
 *
 * Joining live attendance is safe here because a month is locked when its
 * payroll runs, so the counts cannot drift away from what was paid.
 */

// ── Formatting ───────────────────────────────────────────────────────────────
// The register prints whole rupees with thousands separators and a dash for
// nil, so the sheet reads the way the filed copy does.
const n = (v: string | number | null | undefined): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};
const rupees = (v: number) =>
  v === 0 ? "-" : v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const days = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

const MONTH_LABEL = (iso: string) => {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return `${d.toLocaleString("en-GB", { month: "short" })}-${String(d.getFullYear()).slice(2)}`;
};

interface SheetRow {
  employeeId: string;
  name: string;
  presentDays: number;
  holidayDays: number;
  woDays: number;
  totalDays: number;
  basic: number;
  da: number;
  hra: number;
  bonus: number;
  gross: number;
  esi: number;
  pf: number;
  pt: number;
  lwf: number;
  totalDed: number;
  payment: number;
}

export function Paysheet() {
  const { selectedClientId } = useClientContext();
  const [selectedCycleId, setSelectedCycleId] = useState("");

  const clients = useQuery({
    queryKey: qk.clients(),
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  const cycles = useQuery({
    queryKey: ["cycles", selectedClientId],
    queryFn: () => payrollApi.listCycles(selectedClientId || undefined),
    enabled: !!selectedClientId,
  });

  // A paysheet only exists once the cycle has produced results, so DRAFT and
  // LOCKED cycles are not offered — picking one would render an empty register.
  const runCycles = useMemo(
    () =>
      (cycles.data ?? [])
        .filter((c) => ["COMPUTED", "APPROVED", "DISBURSED"].includes(c.status))
        .sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [cycles.data]
  );

  const activeCycleId = selectedCycleId || runCycles[0]?.id || "";
  const cycle = runCycles.find((c) => c.id === activeCycleId) ?? null;
  const month = cycle ? cycle.period_start.slice(0, 7) : "";

  const summary = useQuery({
    queryKey: ["cycle-summary", activeCycleId],
    queryFn: () => payrollApi.getCycleSummary(activeCycleId),
    enabled: !!activeCycleId,
  });

  const attendance = useQuery({
    queryKey: ["attendance-monthly", month],
    queryFn: () => attendanceApi.getMonthly(month),
    enabled: !!month,
  });

  const employees = useQuery({
    queryKey: ["employees", selectedClientId],
    queryFn: () => employeesApi.list({ client_id: selectedClientId || undefined, page_size: 500 }),
    enabled: !!selectedClientId,
  });

  const client = (clients.data?.items ?? []).find((c) => c.id === selectedClientId) ?? null;

  // The site the workers are deployed to. Employees carry it as work_location;
  // a register covers one site, so the single distinct value is the unit. More
  // than one means the sheet would mix sites, which is worth saying out loud.
  const units = useMemo(() => {
    const set = new Set(
      (employees.data?.items ?? []).map((e) => e.work_location?.trim()).filter(Boolean) as string[]
    );
    return [...set];
  }, [employees.data]);

  const rows: SheetRow[] = useMemo(() => {
    const results = summary.data?.results ?? [];
    const att = new Map(
      (attendance.data?.records ?? []).map((r) => [r.employee_id, r])
    );

    return results
      .map((r: PayrollResult) => {
        const b = r.breakdown_json ?? ({} as PayrollResult["breakdown_json"]);
        const e = b.earnings ?? ({} as BreakdownEarnings);
        const d = b.deductions ?? ({} as BreakdownDeductions);
        const a = att.get(r.employee_id);

        const esi = n(d.employee_esi);
        const pf = n(d.employee_pf);
        const pt = n(d.pt);
        const lwf = n(d.lwf);

        return {
          employeeId: r.employee_id,
          name: b.employee?.name ?? r.employee_id.slice(0, 8),
          presentDays: n(a?.present_days),
          holidayDays: n(a?.holiday_days),
          woDays: n(a?.wo_days),
          // Payable days is what the money was actually computed on, so it is
          // the honest "Total Days" even when attendance is missing.
          totalDays: n(b.attendance?.payable_days ?? a?.payable_days),
          basic: n(e.basic),
          da: n(e.da),
          hra: n(e.hra),
          bonus: n(e.bonus),
          gross: n(e.gross ?? r.gross_earnings),
          esi,
          pf,
          pt,
          lwf,
          totalDed: n(r.total_deductions),
          payment: n(r.net_pay),
        };
      })
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [summary.data, attendance.data]);

  const totals = useMemo(() => {
    const key = <K extends keyof SheetRow>(k: K) =>
      rows.reduce((s, r) => s + (r[k] as number), 0);
    return {
      presentDays: key("presentDays"), holidayDays: key("holidayDays"),
      woDays: key("woDays"), totalDays: key("totalDays"),
      basic: key("basic"), da: key("da"), hra: key("hra"), bonus: key("bonus"),
      gross: key("gross"), esi: key("esi"), pf: key("pf"), pt: key("pt"),
      lwf: key("lwf"), totalDed: key("totalDed"), payment: key("payment"),
    };
  }, [rows]);

  // Any LWF at all means a June/December cycle; the column is hidden the rest
  // of the year rather than printing a column of dashes.
  const showLwf = totals.lwf > 0;
  const monthlyDays = rows.length ? n(summary.data?.results?.[0]?.breakdown_json?.attendance?.total_days) : 0;

  function exportCsv() {
    const head = [
      "Sr", "Name of Employee", "Present Days", "P.H", "Wo.f", "Total Days",
      "Basic", "DA", "HRA", "Bonus", "Gross Wages",
      "ESIC 0.75%", "PF 12%", "PT", ...(showLwf ? ["LWF"] : []), "Total Ded", "Payment",
    ];
    const body = rows.map((r, i) => [
      i + 1, r.name, days(r.presentDays), days(r.holidayDays), days(r.woDays), days(r.totalDays),
      r.basic.toFixed(2), r.da.toFixed(2), r.hra.toFixed(2), r.bonus.toFixed(2), r.gross.toFixed(2),
      r.esi.toFixed(2), r.pf.toFixed(2), r.pt.toFixed(2),
      ...(showLwf ? [r.lwf.toFixed(2)] : []), r.totalDed.toFixed(2), r.payment.toFixed(2),
    ]);
    const total = [
      "", "TOTAL", days(totals.presentDays), days(totals.holidayDays), days(totals.woDays), days(totals.totalDays),
      totals.basic.toFixed(2), totals.da.toFixed(2), totals.hra.toFixed(2), totals.bonus.toFixed(2), totals.gross.toFixed(2),
      totals.esi.toFixed(2), totals.pf.toFixed(2), totals.pt.toFixed(2),
      ...(showLwf ? [totals.lwf.toFixed(2)] : []), totals.totalDed.toFixed(2), totals.payment.toFixed(2),
    ];
    const meta = [
      [client?.client_name ?? ""],
      [[client?.address?.line1, client?.address?.area, client?.address?.city,
        client?.address?.pincode].filter(Boolean).join(", ")],
      [units.length ? `UNIT: ${units.join(" / ")}` : ""],
      [cycle ? MONTH_LABEL(cycle.period_start) : "", "", "MONTHLY DAYS", String(monthlyDays)],
      [],
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [...meta, head, ...body, total].map((r) => r.map(esc).join(",")).join("\n");
    // BOM so Excel opens the rupee figures and names in UTF-8.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paysheet-${client?.client_name ?? "client"}-${month}.csv`.replace(/\s+/g, "-");
    a.click();
    URL.revokeObjectURL(url);
  }

  if (clients.isLoading) return <FullPageSpinner />;

  if (!selectedClientId) {
    return (
      <>
        <PageHeader title="Paysheet" subtitle="Monthly wage register" />
        <EmptyState
          title="Select a client"
          description="The paysheet covers one client company. Pick an Active Client Account from the top bar."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Paysheet"
        subtitle="Monthly wage register — available once a payroll cycle has been run"
      >
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={exportCsv} disabled={!rows.length} className="btn-ghost disabled:opacity-40">
            <Download className="h-4 w-4" /> Export
          </button>
          <button onClick={() => window.print()} disabled={!rows.length} className="btn disabled:opacity-40">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <select
          className="input max-w-xs"
          value={activeCycleId}
          onChange={(e) => setSelectedCycleId(e.target.value)}
        >
          {runCycles.length === 0 && <option value="">No cycle has been run yet</option>}
          {runCycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.status}
            </option>
          ))}
        </select>
        {units.length > 1 && (
          <span className="text-[12px] text-amber-600 dark:text-amber-400">
            {units.length} work locations in this cycle — the register normally covers one site.
          </span>
        )}
      </div>

      {runCycles.length === 0 ? (
        <EmptyState
          title="No payroll run yet"
          description="Run a payroll cycle for this client and its paysheet will appear here."
        />
      ) : summary.isLoading || attendance.isLoading ? (
        <FullPageSpinner />
      ) : rows.length === 0 ? (
        <EmptyState
          title="This cycle produced no results"
          description="The cycle ran but computed nothing — usually no attendance was recorded for the month."
        />
      ) : (
        <div className="card overflow-hidden">
          {/* Register letterhead, mirroring the filed sheet */}
          <div className="border-b border-slate-200 dark:border-slate-700 px-5 py-4 text-center">
            <div className="text-[15px] font-bold uppercase tracking-wide text-slate-900 dark:text-slate-50">
              {client?.client_name}
            </div>
            {client?.address?.line1 && (
              <div className="text-[12px] font-medium text-slate-600 dark:text-slate-400">
                {[client.address.line1, client.address.area, client.address.city, client.address.pincode]
                  .filter(Boolean).join(", ")}
              </div>
            )}
            {units.length > 0 && (
              <div className="mt-0.5 text-[12px] font-semibold uppercase text-slate-700 dark:text-slate-300">
                Unit: {units.join(" / ")}
              </div>
            )}
            <div className="mt-2 flex items-center justify-center gap-8 text-[13px]">
              <span className="font-bold text-red-600 dark:text-red-400">
                {cycle ? MONTH_LABEL(cycle.period_start) : ""}
              </span>
              <span className="font-semibold text-accent-600 dark:text-accent-400">
                MONTHLY DAYS <span className="ml-2 text-slate-800 dark:text-slate-200">{monthlyDays || "—"}</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="ps-table border-collapse text-[12px]">
              {/* Widths are fixed rather than content-derived so all 17 columns
                  land on screen; they total 100% with and without LWF. */}
              <colgroup>
                {(showLwf
                  ? [3, 17, 5.5, 3.5, 3.5, 5, 5.5, 5.5, 5, 5, 7, 5.5, 5.5, 4, 4.5, 7, 8]
                  : [3, 17.5, 5.5, 3.5, 3.5, 5, 6, 6, 5.5, 5.5, 7, 6, 6, 4.5, 6.5, 9]
                ).map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <thead>
                {/* Grouped header, as in the register: attendance, then
                    earnings, then deductions, then the net. */}
                <tr className="bg-slate-50 dark:bg-slate-800/60">
                  <th className="ps-head" colSpan={6}>Attendance</th>
                  <th className="ps-head" colSpan={5}>Earnings</th>
                  <th className="ps-head" colSpan={showLwf ? 5 : 4}>Deductions</th>
                  <th className="ps-head">&nbsp;</th>
                </tr>
                <tr className="bg-slate-50 dark:bg-slate-800/60">
                  <th className="ps-th">Sr</th>
                  <th className="ps-th text-left">Name of Employee</th>
                  <th className="ps-th">Present Days</th>
                  <th className="ps-th">P.H</th>
                  <th className="ps-th">Wo.f</th>
                  <th className="ps-th">Total Days</th>
                  <th className="ps-th text-right">Basic</th>
                  <th className="ps-th text-right">DA</th>
                  <th className="ps-th text-right">HRA</th>
                  <th className="ps-th text-right">Bonus</th>
                  <th className="ps-th text-right">Gross Wages</th>
                  <th className="ps-th text-right">Esic 0.75%</th>
                  <th className="ps-th text-right">PF 12%</th>
                  <th className="ps-th text-right">PT</th>
                  {showLwf && <th className="ps-th text-right">LWF</th>}
                  <th className="ps-th text-right">Total Ded</th>
                  <th className="ps-th text-right">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.employeeId} className="tr-hover">
                    <td className="ps-td text-center">{i + 1}</td>
                    <td className="ps-td ps-td-name text-left font-medium text-slate-800 dark:text-slate-200">{r.name}</td>
                    <td className="ps-td text-center">{days(r.presentDays)}</td>
                    <td className="ps-td text-center">{days(r.holidayDays)}</td>
                    <td className="ps-td text-center">{days(r.woDays)}</td>
                    <td className="ps-td text-center font-semibold">{days(r.totalDays)}</td>
                    <td className="ps-td text-right font-numeric">{rupees(r.basic)}</td>
                    <td className="ps-td text-right font-numeric">{rupees(r.da)}</td>
                    <td className="ps-td text-right font-numeric">{rupees(r.hra)}</td>
                    <td className="ps-td text-right font-numeric">{rupees(r.bonus)}</td>
                    <td className="ps-td text-right font-numeric font-semibold bg-amber-50/60 dark:bg-amber-900/10">
                      {rupees(r.gross)}
                    </td>
                    <td className="ps-td text-right font-numeric">{rupees(r.esi)}</td>
                    <td className="ps-td text-right font-numeric">{rupees(r.pf)}</td>
                    <td className="ps-td text-right font-numeric">{rupees(r.pt)}</td>
                    {showLwf && <td className="ps-td text-right font-numeric">{rupees(r.lwf)}</td>}
                    <td className="ps-td text-right font-numeric">{rupees(r.totalDed)}</td>
                    <td className="ps-td text-right font-numeric font-semibold">{rupees(r.payment)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 font-bold">
                  <td className="ps-td" />
                  <td className="ps-td text-left">TOTAL</td>
                  <td className="ps-td text-center">{days(totals.presentDays)}</td>
                  <td className="ps-td text-center">{days(totals.holidayDays)}</td>
                  <td className="ps-td text-center">{days(totals.woDays)}</td>
                  <td className="ps-td text-center">{days(totals.totalDays)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.basic)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.da)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.hra)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.bonus)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.gross)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.esi)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.pf)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.pt)}</td>
                  {showLwf && <td className="ps-td text-right font-numeric">{rupees(totals.lwf)}</td>}
                  <td className="ps-td text-right font-numeric">{rupees(totals.totalDed)}</td>
                  <td className="ps-td text-right font-numeric">{rupees(totals.payment)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 px-5 py-3 text-[11px] text-slate-400">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Attendance columns are read from the locked attendance month; earnings and
            deductions are the figures this payroll cycle actually computed.
          </div>
        </div>
      )}
    </>
  );
}

export default Paysheet;
