import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, AlertTriangle, CheckCircle2, FileSpreadsheet, ExternalLink } from "lucide-react";
import { attendanceApi } from "../api/attendance";
import { payrollApi } from "../api/payroll";
import type { Employee, PayrollCycle } from "../types";

/**
 * EPFO ECR — Electronic Challan cum Return, the file uploaded at the EPFO
 * unified portal to generate the monthly PF challan.
 *
 * Eleven fields per member, "#~#" separated, no header row: that is the format
 * the portal parses. A CSV of the same rows is offered alongside for checking
 * the numbers before upload, since the delimited file is unreadable by eye.
 *
 * EPS and EDLI wages are capped at the statutory ceiling independently of EPF
 * wages, which is why they are derived here rather than reusing EPF wages: with
 * the ceiling disabled for PF they would otherwise be overstated.
 */

const CEILING = 15000;

/** The working sheet the client checks before uploading — their own column
 *  set, not EPFO's. It restates the same figures the way a PF clerk reads
 *  them: the employer's 12% split into its 8.33% and 3.67% halves, and the
 *  slice of wages above the statutory ceiling shown explicitly.
 *
 *  The upload file is NOT this. That stays the fixed 11-field EPFO order in
 *  `fields()` below — its layout is dictated by the portal's parser. */
const REVIEW_COLUMNS = [
  "UAN",
  "Member Name",
  "Gross Wages",
  "Basic",
  "Employee Share 12%",
  "Employer Share 8.33% (limit is 15000)",
  "Employer Share 3.67%",
  "Basic more than Rs.15000/-",
  "NCP Days",
] as const;

const EPFO_PORTAL = "https://unifiedportal-emp.epfindia.gov.in/epfo/";

const n = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};

/** EPFO rejects punctuation in the member name; it must match the UAN record. */
const cleanName = (s: string) => s.replace(/[^A-Za-z ]/g, " ").replace(/\s+/g, " ").trim();

interface PfRow {
  employee_id: string;
  pf_wages: string;
  employee_pf: string;
  employer_eps: string;
  employer_epf: string;
}

interface Line {
  employeeId: string;
  uan: string;
  name: string;
  gross: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfEe: number;
  eps: number;
  diff: number;
  ncpDays: number;
}

export function ECRReturnPanel({
  cycle, pfRows, employees,
}: {
  cycle: PayrollCycle | null;
  pfRows: PfRow[];
  employees: Employee[];
}) {
  const month = cycle ? cycle.period_start.slice(0, 7) : "";

  const attendance = useQuery({
    queryKey: ["attendance-monthly", month],
    queryFn: () => attendanceApi.getMonthly(month),
    enabled: !!month,
  });

  // Gross wages is an ECR field in its own right and is not part of the PF
  // register, so it comes from the payroll result rather than compliance.
  const payroll = useQuery({
    queryKey: ["cycle-summary", cycle?.id ?? ""],
    queryFn: () => payrollApi.getCycleSummary(cycle!.id),
    enabled: !!cycle?.id,
  });

  const pfByEmp = useMemo(() => new Map(pfRows.map((r) => [r.employee_id, r])), [pfRows]);
  const attByEmp = useMemo(
    () => new Map((attendance.data?.records ?? []).map((r) => [r.employee_id, r])),
    [attendance.data]
  );
  const grossByEmp = useMemo(
    () => new Map((payroll.data?.results ?? []).map((r) => [r.employee_id, n(r.gross_earnings)])),
    [payroll.data]
  );

  // Same rule as the ESIC return: the file covers whoever this cycle paid, not
  // whoever happens to hold a UAN — otherwise someone who left in an earlier
  // month files with attendance days and no wages.
  const inCycle = useMemo(
    () => employees.filter((e) => pfByEmp.has(e.id)),
    [employees, pfByEmp]
  );
  const withUan = inCycle.filter((e) => (e.uan_number ?? "").trim().length > 0);
  const missingUan = inCycle.filter((e) => !(e.uan_number ?? "").trim());

  const lines: Line[] = useMemo(
    () =>
      withUan
        .map((e) => {
          const pf = pfByEmp.get(e.id)!;
          const att = attByEmp.get(e.id);
          const epfWages = n(pf.pf_wages);
          // EPS and EDLI are capped at the ceiling regardless of the PF ceiling
          // setting, so they are not simply a copy of EPF wages.
          const capped = Math.min(epfWages, CEILING);
          return {
            employeeId: e.id,
            uan: (e.uan_number ?? "").trim(),
            name: cleanName(`${e.first_name} ${e.last_name}`),
            gross: grossByEmp.get(e.id) ?? 0,
            epfWages,
            epsWages: capped,
            edliWages: capped,
            epfEe: n(pf.employee_pf),
            eps: n(pf.employer_eps),
            diff: n(pf.employer_epf),
            // Non-contributing period: days in the month carrying no wages.
            ncpDays: n(att?.lop_days),
          };
        })
        .sort((a, b) => a.uan.localeCompare(b.uan)),
    [withUan, pfByEmp, attByEmp, grossByEmp]
  );

  const blocked = missingUan.length > 0 || lines.length === 0;

  /** The 11 values in EPFO's order, rounded to whole rupees as the ECR expects.
   *
   *  The EPF/EPS difference is derived from the two rounded figures rather than
   *  rounded from its own stored value. EPFO validates field 9 == field 7 -
   *  field 8 on the whole rupees in the file, and rounding all three
   *  independently breaks that whenever the paise fall the wrong way: on this
   *  cycle 1590.63 / 1104.16 / 486.47 rounds to 1591 / 1104 / 486, and
   *  1591 - 1104 is 487. Three of six rows failed the check. */
  const fields = (l: Line) => {
    const ee = Math.round(l.epfEe);
    const eps = Math.round(l.eps);
    return [
      l.uan,
      l.name,
      String(Math.round(l.gross)),
      String(Math.round(l.epfWages)),
      String(Math.round(l.epsWages)),
      String(Math.round(l.edliWages)),
      String(ee),
      String(eps),
      String(ee - eps),
      String(Math.round(l.ncpDays)),
      "0", // refund of advances — not tracked; EPFO expects a literal 0
    ];
  };

  /** One working-sheet row. Shares fields()'s rounding so the review sheet and
   *  the upload file can never disagree: the 3.67% share is the difference of
   *  the two rounded figures, never rounded from its own value. */
  const reviewRow = (l: Line) => {
    const ee = Math.round(l.epfEe);
    const eps = Math.round(l.eps);
    return {
      uan: l.uan,
      name: l.name,
      gross: Math.round(l.gross),
      basic: Math.round(l.epfWages),
      ee,
      eps,
      // Whatever the employer's 12% is not sending to the pension scheme.
      epf: ee - eps,
      // The client shows the slice above the ceiling as its own column; it is
      // zero for anyone at or under it, which is most daily-rated staff.
      aboveCeiling: Math.max(0, Math.round(l.epfWages) - CEILING),
      ncp: Math.round(l.ncpDays),
    };
  };

  function save(name: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** The upload file itself: no header, fields joined by #~#. */
  function downloadEcr() {
    save(
      `ecr-${month}.txt`,
      lines.map((l) => fields(l).join("#~#")).join("\n"),
      "text/plain;charset=utf-8;"
    );
  }

  /** Readable copy for checking the figures before uploading. */
  function downloadCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const body = lines.map((l) => {
      const r = reviewRow(l);
      return [r.uan, r.name, String(r.gross), String(r.basic), String(r.ee),
              String(r.eps), String(r.epf), String(r.aboveCeiling), String(r.ncp)];
    });
    const csv = [REVIEW_COLUMNS as unknown as string[], ...body]
      .map((r) => r.map(esc).join(","))
      .join("\n");
    save(`ecr-${month}-review.csv`, "﻿" + csv, "text/csv;charset=utf-8;");
  }

  if (!cycle) return null;

  return (
    <div className="card mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-accent-500" />
            <h3 className="text-[14px] font-bold text-slate-900 dark:text-slate-50">
              EPFO ECR (Electronic Challan cum Return)
            </h3>
          </div>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
            {cycle.name} · {lines.length} member{lines.length === 1 ? "" : "s"} · upload at{" "}
            <a href={EPFO_PORTAL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent-600 hover:underline dark:text-accent-400">
              EPFO unified portal <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadCsv} disabled={blocked}
            className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40">
            <Download className="h-4 w-4" /> Review CSV
          </button>
          <button onClick={downloadEcr} disabled={blocked}
            className="btn disabled:cursor-not-allowed disabled:opacity-40">
            <Download className="h-4 w-4" /> Download ECR (.txt)
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-[12.5px]">
        {/* UAN is field 1 and what EPFO matches the member on, so a row without
            one fails the upload rather than just that line. */}
        {missingUan.length === 0 && lines.length > 0 ? (
          <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>All {lines.length} members in this cycle have a UAN.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-semibold">
                {missingUan.length} member{missingUan.length === 1 ? "" : "s"} without a UAN —
                add it on their profile before filing.
              </div>
              <div className="mt-1 text-slate-500 dark:text-slate-400">
                {missingUan.map((e) => `${e.first_name} ${e.last_name}`).join(", ")}
              </div>
            </div>
          </div>
        )}

        {lines.some((l) => l.ncpDays > 0) && (
          <div className="flex items-start gap-2 text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span>
              NCP days set for {lines.filter((l) => l.ncpDays > 0).length} member
              {lines.filter((l) => l.ncpDays > 0).length === 1 ? "" : "s"} from the month's LOP.
            </span>
          </div>
        )}
      </div>

      {/* The working sheet, on screen. Same figures as the download and the
          same rounding, so what is checked here is what gets uploaded. */}
      {lines.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="ps-table border-collapse text-[12px]">
            <colgroup>
              {/* Sums to 100. NCP needs enough room for its two-line header —
                  at 3% the column was narrower than the words and got cut. */}
              {[14, 20, 9, 9, 11, 12, 9, 10, 6].map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/60">
                <th className="ps-head" colSpan={5}>&nbsp;</th>
                <th className="ps-head" colSpan={2}>Employer Share</th>
                <th className="ps-head" colSpan={2}>&nbsp;</th>
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800/60">
                <th className="ps-th text-left">UAN</th>
                <th className="ps-th text-left">Member Name</th>
                <th className="ps-th text-right">Gross Wages</th>
                <th className="ps-th text-right">Basic</th>
                <th className="ps-th text-right">Employee Share 12%</th>
                <th className="ps-th text-right">8.33% (limit is 15000)</th>
                <th className="ps-th text-right">3.67%</th>
                <th className="ps-th text-right">Basic more than ₹15000/-</th>
                <th className="ps-th text-right">NCP Days</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const r = reviewRow(l);
                const rupee = (v: number) =>
                  v === 0 ? "0" : v.toLocaleString("en-IN");
                return (
                  <tr key={l.employeeId} className="tr-hover">
                    <td className="ps-td font-mono">{r.uan}</td>
                    <td className="ps-td ps-td-name text-left font-medium text-slate-800 dark:text-slate-200">
                      {r.name}
                    </td>
                    <td className="ps-td text-right font-numeric">{rupee(r.gross)}</td>
                    <td className="ps-td text-right font-numeric">{rupee(r.basic)}</td>
                    <td className="ps-td text-right font-numeric font-semibold">{rupee(r.ee)}</td>
                    <td className="ps-td text-right font-numeric">{rupee(r.eps)}</td>
                    <td className="ps-td text-right font-numeric">{rupee(r.epf)}</td>
                    <td className="ps-td text-right font-numeric">{rupee(r.aboveCeiling)}</td>
                    <td className="ps-td text-right font-numeric">{r.ncp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400 dark:border-slate-800">
        The table and the Review CSV are the working sheet — the employer's 12% split
        into its 8.33% and 3.67% halves, with wages above the ceiling shown separately.
        The .txt is the upload file itself: 11 fields per member separated by #~#, no
        header, in EPFO's fixed order. EPS and EDLI wages are capped at
        ₹{CEILING.toLocaleString("en-IN")}.
      </p>
    </div>
  );
}

export default ECRReturnPanel;
