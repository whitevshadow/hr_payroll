import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, AlertTriangle, CheckCircle2, FileSpreadsheet, ExternalLink } from "lucide-react";
import { attendanceApi } from "../api/attendance";
import type { Employee, PayrollCycle } from "../types";

/**
 * ESIC monthly contribution return — the upload file for esic.gov.in
 * (Monthly Contribution -> File Monthly Contribution -> upload Excel).
 *
 * ESIC computes both contribution shares itself from what is uploaded, so the
 * file carries only the base: days and wages. The six columns and their order
 * are fixed by the portal's template.
 *
 * Every insured person the cycle covered needs a row, including anyone paid for
 * zero days that month — omitting them is what the "reason code for zero
 * working days" column exists to prevent. The row set therefore follows the
 * cycle's own compliance rows, not the employee list.
 */

const COLUMNS = [
  "IP Number",
  "IP Name",
  "No of Days for which wages paid/payable during the month",
  "Total Monthly Wages",
  "Reason Code for Zero workings days",
  "Last Working Day",
] as const;

/** ESIC publishes the categories but not a numeric mapping we could verify, and
 *  filing a wrong code is worse than filing none — so the number is entered by
 *  the user against the portal's own reference link, with these as the prompt. */
const ZERO_DAY_REASONS = [
  "On leave",
  "Left service",
  "Retired",
  "Out of coverage",
  "Expired",
  "Non-implemented area",
  "Retrenchment",
];

const ESIC_PORTAL = "https://www.esic.gov.in/";

/** ESIC accepts letters and spaces only in IP Name and rejects the upload
 *  otherwise — initials with dots and digits are the usual culprits. */
const cleanName = (s: string) => s.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();

const asDDMMYYYY = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
};

interface EsiRow {
  employee_id: string;
  gross_wages: string;
  is_esi_eligible: boolean;
}

interface Line {
  employeeId: string;
  ipNumber: string;
  name: string;
  days: number;
  wages: number;
  lastWorkingDay: string;
  isZeroDay: boolean;
}

export function ESICReturnPanel({
  cycle, esiRows, employees,
}: {
  cycle: PayrollCycle | null;
  esiRows: EsiRow[];
  employees: Employee[];
}) {
  // Reason codes are per employee and only for this screen — they are not part
  // of payroll, just something the filer states at upload time.
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const month = cycle ? cycle.period_start.slice(0, 7) : "";

  const attendance = useQuery({
    queryKey: ["attendance-monthly", month],
    queryFn: () => attendanceApi.getMonthly(month),
    enabled: !!month,
  });

  const wageByEmp = useMemo(
    () => new Map(esiRows.map((r) => [r.employee_id, r])),
    [esiRows]
  );
  const attByEmp = useMemo(
    () => new Map((attendance.data?.records ?? []).map((r) => [r.employee_id, r])),
    [attendance.data]
  );

  // The return covers whoever this cycle paid — including anyone it paid zero,
  // which is exactly the zero-day case the reason code exists for. Keying off
  // "holds an IP number" instead would drag in people who left in an earlier
  // month: they would appear with attendance days but no wages, a contradiction
  // ESIC rejects.
  const inCycle = useMemo(
    () => employees.filter((e) => wageByEmp.has(e.id)),
    [employees, wageByEmp]
  );
  // Without an IP number ESIC has nothing to match the row against and fails
  // the whole upload, so these are reported as a blocker rather than dropped.
  const withIp = inCycle.filter((e) => (e.ip_number ?? "").trim().length > 0);
  const missingIp = inCycle.filter((e) => !(e.ip_number ?? "").trim());

  const lines: Line[] = useMemo(
    () =>
      withIp
        .map((e) => {
          const esi = wageByEmp.get(e.id);
          const att = attByEmp.get(e.id);
          const days = parseFloat(String(att?.payable_days ?? "0")) || 0;
          const wages = parseFloat(String(esi?.gross_wages ?? "0")) || 0;
          return {
            employeeId: e.id,
            ipNumber: (e.ip_number ?? "").trim(),
            name: cleanName(`${e.first_name} ${e.last_name}`),
            days,
            wages,
            // ESIC only wants a leaving date for someone who actually left;
            // sending one for an active employee stops future contributions.
            lastWorkingDay: e.status === "SEPARATED" ? asDDMMYYYY(e.exit_date ?? null) : "",
            isZeroDay: days === 0,
          };
        })
        .sort((a, b) => a.ipNumber.localeCompare(b.ipNumber)),
    [withIp, wageByEmp, attByEmp]
  );

  const zeroDayLines = lines.filter((l) => l.isZeroDay);
  const blocked = missingIp.length > 0 || lines.length === 0;

  function download() {
    const body = lines.map((l) => [
      l.ipNumber,
      l.name,
      // Whole days: ESIC's template takes an integer here.
      String(Math.round(l.days)),
      l.wages.toFixed(0),
      l.isZeroDay ? (reasons[l.employeeId] || "0") : "0",
      l.lastWorkingDay,
    ]);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [COLUMNS as unknown as string[], ...body]
      .map((r) => r.map(esc).join(","))
      .join("\n");
    // BOM so Excel reads it as UTF-8 rather than mangling the names.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `esic-return-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!cycle) return null;

  return (
    <div className="card mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent-500" />
            <h3 className="text-[14px] font-bold text-slate-900 dark:text-slate-50">
              ESIC Monthly Contribution Return
            </h3>
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
            {cycle.name} · {lines.length} insured {lines.length === 1 ? "person" : "people"} ·
            upload at{" "}
            <a href={ESIC_PORTAL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent-600 hover:underline dark:text-accent-400">
              esic.gov.in <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <button onClick={download} disabled={blocked}
          className="btn disabled:cursor-not-allowed disabled:opacity-40">
          <Download className="h-4 w-4" /> Download Return (.csv)
        </button>
      </div>

      <div className="mt-4 space-y-2 text-[12.5px]">
        {/* IP numbers — the one hard blocker. ESIC matches on this, so a row
            without it fails the whole upload rather than just that line. */}
        {missingIp.length === 0 && lines.length > 0 ? (
          <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>All {lines.length} employees in this cycle have an IP Number.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-semibold">
                {missingIp.length} employee{missingIp.length === 1 ? "" : "s"} without an IP Number —
                register them on the ESIC portal, then add the number on their profile.
              </div>
              <div className="mt-1 text-slate-500 dark:text-slate-400">
                {missingIp.map((e) => `${e.first_name} ${e.last_name}`).join(", ")}
              </div>
            </div>
          </div>
        )}

        {attendance.isLoading ? (
          <div className="text-slate-400">Checking attendance…</div>
        ) : (
          <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Wages and paid days available for {lines.filter((l) => !l.isZeroDay).length} of {lines.length}.</span>
          </div>
        )}

        {/* Zero-day rows still have to be filed — that is what the reason code
            column is for. ESIC publishes the categories but not a numeric
            mapping we could verify, so the number is typed against the
            portal's reference rather than guessed here. */}
        {zeroDayLines.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/15">
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">
                  {zeroDayLines.length} row{zeroDayLines.length === 1 ? "" : "s"} with zero paid days —
                  each needs a reason code.
                </div>
                <p className="mt-0.5 text-[11.5px] text-amber-600 dark:text-amber-500">
                  Take the number from the reference link on the ESIC upload page.
                  Categories: {ZERO_DAY_REASONS.join(" · ")}.
                </p>
                <div className="mt-2 space-y-1.5">
                  {zeroDayLines.map((l) => (
                    <div key={l.employeeId} className="flex items-center gap-2">
                      <span className="min-w-[10rem] text-[12px] text-slate-700 dark:text-slate-300">
                        {l.name}
                      </span>
                      <input
                        className="input h-7 w-20 py-0 text-[12px]"
                        inputMode="numeric"
                        placeholder="0"
                        value={reasons[l.employeeId] ?? ""}
                        onChange={(e) =>
                          setReasons((r) => ({
                            ...r,
                            [l.employeeId]: e.target.value.replace(/\D/g, "").slice(0, 2),
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400 dark:border-slate-800">
        Days come from the locked attendance month; wages are the ESI wage base this
        cycle computed. ESIC derives both contribution shares from these figures — the
        file carries no amounts.
      </p>
    </div>
  );
}

export default ESICReturnPanel;
