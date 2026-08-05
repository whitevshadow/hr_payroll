/**
 * ExcelRegisterImportModal.tsx
 * 4-step wizard that brings a payroll cycle to COMPUTED from an Excel
 * payroll register (Huntsman-style: Basic/DA/HRA/Bonus/Gross, ESIC/PF/PT,
 * Total Ded, Payment) instead of running the automated engine.
 *
 * Two modes:
 *   "prefilled" — every figure (incl. deductions & net) comes from the sheet.
 *   "compute"   — only earnings/attendance come from the sheet; the backend
 *                 computes PF/ESI/PT and net pay. For employees with no
 *                 CTC/salary structure in the system.
 *
 *   Step 1 — Choose mode + download pre-filled template
 *   Step 2 — Upload file (drag-and-drop)
 *   Step 3 — Preview: match names to employees, reconcile totals
 *   Step 4 — Import + result report
 */

import { useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  FileSpreadsheet, Download, Upload, CheckCircle2, AlertTriangle, X,
  ChevronRight, ChevronLeft, Loader2, AlertCircle, RefreshCw, Calculator,
  ClipboardCheck, UserCheck,
} from "lucide-react";
import { employeesApi } from "../api/employees";
import { payrollApi, type ImportRegisterMode, type ImportRegisterRow } from "../api/payroll";
import { extractErrorMessage } from "../lib/toast";
import type { Employee, PayrollCycle, RunSummary } from "../types";
import clsx from "clsx";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = ["Mode & Template", "Upload File", "Preview & Validate", "Import Results"];

const EARNING_HEADERS = [
  "Sr", "Name of Employee", "Present Days", "P.H", "Wo.ff", "Total Days",
  "Basic", "DA", "HRA", "Bonus", "Gross Wages",
];
const DEDUCTION_HEADERS = ["Esic 0.75%", "PF 12%", "PT", "Total Ded", "Payment"];

const TOLERANCE = 1; // ₹1 rounding tolerance on reconciliation checks

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RegRow {
  _rowNum: number;            // 1-based data row (header excluded)
  _parseErrors: string[];
  name: string;               // free-text name from the sheet
  employeeId: string | null;  // resolved match (null until confirmed)
  matchType: "exact" | "fuzzy" | "none";
  suggestionId: string | null;
  present: number | null;
  ph: number | null;
  wo: number | null;
  totalDays: number;
  basic: number;
  da: number;
  hra: number;
  bonus: number;
  gross: number;
  esi: number;
  pf: number;
  pt: number;
  totalDed: number;
  payment: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fullName = (e: Employee) => `${e.first_name} ${e.last_name}`.trim();
const normName = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i, ...new Array<number>(n).fill(0)];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** Parse a numeric cell, tolerating ₹, commas and blanks. */
function num(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[^0-9.-]/g, "");
  if (!s) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ─────────────────────────────────────────────────────────────────────────────
// Template generator
// ─────────────────────────────────────────────────────────────────────────────

function downloadTemplate(mode: ImportRegisterMode, cycleName: string, employees: Employee[]) {
  const headers = mode === "prefilled" ? [...EARNING_HEADERS, ...DEDUCTION_HEADERS] : EARNING_HEADERS;
  const rows = employees.map((e, i) => [i + 1, fullName(e)]);
  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws1["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, h === "Name of Employee" ? 28 : 12) }));

  const instructions: string[][] = [
    ["PAYROLL REGISTER IMPORT — INSTRUCTIONS"],
    [""],
    [`Cycle: ${cycleName}`],
    [`Mode: ${mode === "prefilled" ? "Pre-calculated register (all figures from this sheet)" : "Earnings only (system computes PF/ESI/PT and net pay)"}`],
    [""],
    ["  • Employee names are pre-filled — fill in only the numeric cells."],
    ["  • Amounts are monthly figures in INR. Blank cells are treated as 0."],
    ["  • Present Days / P.H (paid holiday) / Wo.ff (weekly off) are optional."],
    ...(mode === "prefilled"
      ? [
          ["  • Basic + DA + HRA + Bonus should add up to Gross Wages."],
          ["  • Gross Wages − Total Ded should equal Payment (net pay)."],
        ]
      : [
          ["  • Leave Gross Wages blank to auto-fill it as Basic + DA + HRA + Bonus."],
          ["  • Do NOT add deduction columns — PF/ESI/PT are computed by the system."],
        ]),
    ["  • Delete the rows of employees who are not part of this cycle."],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instructions);
  ws2["!cols"] = [{ wch: 80 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Payroll Register");
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");
  XLSX.writeFile(wb, `PayrollRegister_${cycleName.replace(/[^\w-]+/g, "_")}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// File parser + employee matcher
// ─────────────────────────────────────────────────────────────────────────────

function parseRegisterFile(file: File, mode: ImportRegisterMode, employees: Employee[]): Promise<RegRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellText: true, cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
        if (raw.length < 2) throw new Error("File has no data rows");

        const header = (raw[0] as unknown[]).map((h) => String(h).trim().toLowerCase());
        const idx = (pred: (h: string) => boolean) => header.findIndex(pred);
        const COL = {
          name:      idx((h) => h.includes("name")),
          present:   idx((h) => h.includes("present")),
          ph:        idx((h) => h === "p.h" || h === "ph" || h.includes("p.h") || h.includes("holiday")),
          wo:        idx((h) => h.startsWith("wo")),
          totalDays: idx((h) => h.includes("total") && h.includes("day")),
          basic:     idx((h) => h.includes("basic")),
          da:        idx((h) => h === "da" || h.startsWith("da ") || h.includes("dearness")),
          hra:       idx((h) => h.includes("hra")),
          bonus:     idx((h) => h.includes("bonus")),
          gross:     idx((h) => h.includes("gross")),
          esi:       idx((h) => h.includes("esi")),
          pf:        idx((h) => h.startsWith("pf") || h.includes("provident")),
          pt:        idx((h) => h === "pt" || h.startsWith("pt ") || h.includes("professional")),
          totalDed:  idx((h) => h.includes("ded")),
          payment:   idx((h) => h.includes("payment") || h.includes("net")),
        };
        if (COL.name < 0) throw new Error('Could not find a "Name of Employee" column');
        if (COL.basic < 0) throw new Error('Could not find a "Basic" column');

        const cell = (r: unknown[], c: number) => (c >= 0 ? r[c] : "");
        const byNormName = new Map<string, Employee[]>();
        for (const emp of employees) {
          const k = normName(fullName(emp));
          byNormName.set(k, [...(byNormName.get(k) ?? []), emp]);
        }

        const rows: RegRow[] = [];
        for (let i = 1; i < raw.length; i++) {
          const r = raw[i];
          if (r.every((c) => !String(c).trim())) continue;
          const name = String(cell(r, COL.name)).trim();
          if (!name) continue;

          const errors: string[] = [];
          const totalDays = num(cell(r, COL.totalDays)) ?? 0;
          const basic = num(cell(r, COL.basic)) ?? 0;
          const da = num(cell(r, COL.da)) ?? 0;
          const hra = num(cell(r, COL.hra)) ?? 0;
          const bonus = num(cell(r, COL.bonus)) ?? 0;
          let gross = num(cell(r, COL.gross)) ?? 0;
          const esi = num(cell(r, COL.esi)) ?? 0;
          const pf = num(cell(r, COL.pf)) ?? 0;
          const pt = num(cell(r, COL.pt)) ?? 0;
          const totalDedRaw = num(cell(r, COL.totalDed));
          const paymentRaw = num(cell(r, COL.payment));

          if (mode === "compute" && gross <= 0) gross = basic + da + hra + bonus;

          if (totalDays <= 0) errors.push("Total Days must be a positive number");
          if (gross <= 0) errors.push("Gross Wages must be a positive amount");
          if ([basic, da, hra, bonus, esi, pf, pt].some((v) => v < 0)) errors.push("Amounts cannot be negative");
          if (mode === "prefilled") {
            if (totalDedRaw === null) errors.push("Total Ded is required");
            if (paymentRaw === null) errors.push("Payment is required");
          }

          // Name → employee match (exact auto-accepts, fuzzy only suggests)
          const exact = byNormName.get(normName(name)) ?? [];
          let employeeId: string | null = null;
          let matchType: RegRow["matchType"] = "none";
          let suggestionId: string | null = null;
          if (exact.length === 1) {
            employeeId = exact[0].id;
            matchType = "exact";
          } else if (exact.length === 0) {
            let best: Employee | null = null;
            let bestDist = 3;
            for (const emp of employees) {
              const d = levenshtein(normName(name), normName(fullName(emp)));
              if (d < bestDist) { best = emp; bestDist = d; }
            }
            if (best) { suggestionId = best.id; matchType = "fuzzy"; }
          }
          // exact.length > 1 → ambiguous, keep unmatched for manual pick

          rows.push({
            _rowNum: i,
            _parseErrors: errors,
            name, employeeId, matchType, suggestionId,
            present: num(cell(r, COL.present)),
            ph: num(cell(r, COL.ph)),
            wo: num(cell(r, COL.wo)),
            totalDays, basic, da, hra, bonus, gross, esi, pf, pt,
            totalDed: totalDedRaw ?? 0,
            payment: paymentRaw ?? 0,
          });
        }
        if (!rows.length) throw new Error("No data rows with an employee name found");
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI bits
// ─────────────────────────────────────────────────────────────────────────────

function KPI({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={clsx("flex flex-col items-center rounded-xl border px-4 py-3", color)}>
      <div className="text-2xl font-bold font-display tabular-nums">{value}</div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider mt-0.5 opacity-70">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main modal
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  cycle: PayrollCycle;
  onClose: () => void;
  onImported: () => void;
}

export function ExcelRegisterImportModal({ cycle, onClose, onImported }: Props) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ImportRegisterMode>("prefilled");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState("");
  const [rows, setRows] = useState<RegRow[]>([]);
  const [result, setResult] = useState<RunSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const employeesQ = useQuery({
    queryKey: ["employees", "register-import", cycle.client_id ?? "all"],
    queryFn: () =>
      employeesApi.list({
        status: "ACTIVE",
        page_size: 200,
        client_id: cycle.client_id ?? undefined,
      }),
  });
  const employees = useMemo(() => employeesQ.data?.items ?? [], [employeesQ.data]);
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  // ── Upload / parse ────────────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setParseError("");
    setRows([]);
    try {
      const parsed = await parseRegisterFile(f, mode, employees);
      setRows(parsed);
      setStep(2);
    } catch (err: any) {
      setParseError(err.message ?? "Failed to parse file");
    }
  }, [mode, employees]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Row-level validation (derived, so employee re-selection updates it) ──
  const checkedRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.employeeId) counts.set(r.employeeId, (counts.get(r.employeeId) ?? 0) + 1);
    return rows.map((r) => {
      const errors = [...r._parseErrors];
      const warnings: string[] = [];
      if (!r.employeeId) {
        errors.push(r.matchType === "fuzzy" ? "Confirm the suggested employee match" : "No employee matched — select one");
      } else if ((counts.get(r.employeeId) ?? 0) > 1) {
        errors.push("Same employee appears in multiple rows");
      }
      const compSum = r.basic + r.da + r.hra + r.bonus;
      if (r.gross > 0 && Math.abs(compSum - r.gross) > TOLERANCE) {
        warnings.push(`Basic+DA+HRA+Bonus (${inr(compSum)}) ≠ Gross (${inr(r.gross)})`);
      }
      if (mode === "prefilled") {
        const dedSum = r.esi + r.pf + r.pt;
        if (r.totalDed > 0 && dedSum > 0 && dedSum - r.totalDed > TOLERANCE) {
          warnings.push(`ESIC+PF+PT (${inr(dedSum)}) exceeds Total Ded (${inr(r.totalDed)})`);
        }
        if (Math.abs(r.gross - r.totalDed - r.payment) > TOLERANCE) {
          warnings.push(`Gross − Total Ded (${inr(r.gross - r.totalDed)}) ≠ Payment (${inr(r.payment)})`);
        }
      }
      return { ...r, errors, warnings, valid: errors.length === 0 };
    });
  }, [rows, mode]);

  const validCount = checkedRows.filter((r) => r.valid).length;
  const errorCount = checkedRows.length - validCount;
  const warnCount = checkedRows.filter((r) => r.valid && r.warnings.length > 0).length;

  const setRowEmployee = (rowNum: number, employeeId: string | null) =>
    setRows((prev) => prev.map((r) => (r._rowNum === rowNum ? { ...r, employeeId } : r)));

  // ── Import mutation ───────────────────────────────────────────────────────
  const importMut = useMutation({
    mutationFn: () => {
      const payload: ImportRegisterRow[] = checkedRows
        .filter((r) => r.valid)
        .map((r) => ({
          employee_id: r.employeeId!,
          present_days: r.present,
          holiday_days: r.ph,
          wo_days: r.wo,
          total_days: Math.round(r.totalDays),
          basic: r.basic,
          da: r.da,
          hra: r.hra,
          bonus: r.bonus,
          gross: r.gross,
          ...(mode === "prefilled"
            ? {
                employee_esi: r.esi,
                employee_pf: r.pf,
                pt: r.pt,
                total_deductions: r.totalDed,
                net_pay: r.payment,
              }
            : {}),
        }));
      return payrollApi.importRegister(cycle.id, mode, payload);
    },
    onSuccess: (res) => {
      setResult(res);
      setStep(3);
      onImported();
    },
    onError: (err) => setParseError(extractErrorMessage(err)),
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-50 dark:bg-accent-900/30">
              <FileSpreadsheet className="h-5 w-5 text-accent-600" />
            </div>
            <div>
              <div className="font-display font-bold text-[15px] text-[var(--text-primary)]">Import Excel Register — {cycle.name}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{STEPS[step]}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-[var(--accent-soft)] transition-colors">
            <X className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Step progress bar */}
        <div className="px-6 pt-3 pb-2">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={clsx(
                  "h-1.5 flex-1 rounded-full transition-all duration-500",
                  i <= step ? "bg-accent-500" : "bg-slate-200 dark:bg-slate-700"
                )} />
                {i < STEPS.length - 1 && (
                  <div className={clsx("h-1.5 w-1.5 rounded-full", i < step ? "bg-accent-500" : "bg-slate-200 dark:bg-slate-700")} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {STEPS.map((s, i) => (
              <span key={s} className={clsx(
                "text-[9.5px] font-semibold uppercase tracking-wider transition-colors",
                i === step ? "text-accent-600 dark:text-accent-400" : "text-[var(--text-muted)]"
              )}>{s}</span>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <AnimatePresence mode="wait">
            {/* ─── Step 0: Mode & Template ─── */}
            {step === 0 && (
              <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {([
                    {
                      value: "prefilled" as const,
                      icon: ClipboardCheck,
                      title: "Pre-calculated register",
                      desc: "The sheet already has ESIC / PF / PT, Total Ded and Payment. Figures are stored exactly as entered.",
                    },
                    {
                      value: "compute" as const,
                      icon: Calculator,
                      title: "System calculates deductions",
                      desc: "Fill in only days and earnings (Basic / DA / HRA / Bonus). PF, ESI, PT and net pay are computed automatically — no CTC setup needed.",
                    },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setMode(opt.value)}
                      className={clsx(
                        "rounded-2xl border-2 p-4 text-left transition-all",
                        mode === opt.value
                          ? "border-accent-500 bg-accent-50/50 dark:bg-accent-900/20"
                          : "border-slate-200 dark:border-slate-700 hover:border-accent-300"
                      )}
                    >
                      <opt.icon className={clsx("h-5 w-5 mb-2", mode === opt.value ? "text-accent-600" : "text-slate-400")} />
                      <div className="font-semibold text-[13px] text-[var(--text-primary)] mb-1">{opt.title}</div>
                      <div className="text-[11.5px] text-[var(--text-muted)] leading-relaxed">{opt.desc}</div>
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-dashed border-accent-300 dark:border-accent-700 bg-accent-50/40 dark:bg-accent-900/10 p-6 text-center">
                  <FileSpreadsheet className="h-10 w-10 text-accent-400 mx-auto mb-3" />
                  <h3 className="font-display font-bold text-[15px] text-[var(--text-primary)] mb-1">Download Register Template</h3>
                  <p className="text-[12px] text-[var(--text-muted)] mb-4 max-w-md mx-auto">
                    Pre-filled with the {employees.length} active employee{employees.length !== 1 ? "s" : ""} of this cycle
                    {cycle.client_id ? "'s client" : ""} — fill in only the numeric cells.
                  </p>
                  <button
                    onClick={() => downloadTemplate(mode, cycle.name, employees)}
                    disabled={employeesQ.isLoading}
                    className="btn mx-auto"
                  >
                    {employeesQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download Excel Template
                  </button>
                </div>

                <div className="text-[11.5px] text-[var(--text-muted)] leading-relaxed">
                  Columns: {(mode === "prefilled" ? [...EARNING_HEADERS, ...DEDUCTION_HEADERS] : EARNING_HEADERS).join(" · ")}
                </div>
              </motion.div>
            )}

            {/* ─── Step 1: Upload ─── */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current?.click()}
                  className={clsx(
                    "relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 cursor-pointer transition-all duration-200",
                    dragging
                      ? "border-accent-400 bg-accent-50/50 dark:bg-accent-900/20 scale-[1.01]"
                      : "border-slate-200 dark:border-slate-700 hover:border-accent-300 hover:bg-accent-50/30 dark:hover:bg-accent-900/10"
                  )}
                >
                  <motion.div animate={dragging ? { scale: 1.1 } : { scale: 1 }}>
                    <Upload className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-3 mx-auto" />
                  </motion.div>
                  <div className="font-semibold text-[13px] text-[var(--text-primary)] mb-1">
                    {dragging ? "Drop to upload" : "Drag & drop the filled register here"}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-muted)]">or click to browse</div>
                  <div className="mt-3 text-[10.5px] text-[var(--text-muted)] bg-slate-100 dark:bg-slate-800 rounded-full px-3 py-1">
                    .xlsx · .xls · .csv — {mode === "prefilled" ? "pre-calculated register" : "earnings only, deductions computed"}
                  </div>
                  {file && (
                    <div className="mt-3 flex items-center gap-2 text-[11.5px] text-accent-600 dark:text-accent-400 font-semibold">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      {file.name}
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  />
                </div>

                {parseError && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-3 text-[12.5px] text-red-700 dark:text-red-300">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {parseError}
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── Step 2: Preview & Validate ─── */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  <KPI label="Total Rows" value={checkedRows.length}
                    color="bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300" />
                  <KPI label="Ready" value={validCount}
                    color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-400" />
                  <KPI label="Warnings" value={warnCount}
                    color={clsx(warnCount > 0
                      ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-400"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400")} />
                  <KPI label="Blocked" value={errorCount}
                    color={clsx(errorCount > 0
                      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-400"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400")} />
                </div>

                {mode === "compute" && (
                  <div className="flex items-center gap-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 px-3 py-2.5 text-[12px] text-blue-700 dark:text-blue-300">
                    <Calculator className="h-4 w-4 shrink-0" />
                    PF, ESI, PT and net pay will be computed by the system from these earnings on import.
                  </div>
                )}

                {parseError && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2.5 text-[12.5px] text-red-700 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {parseError}
                  </div>
                )}

                <div className="rounded-xl border border-[var(--glass-border)] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/40 border-b border-[var(--glass-border)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Preview — {file?.name}
                    </span>
                    <button onClick={() => { setStep(1); setRows([]); setFile(null); setParseError(""); }} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" /> Change file
                    </button>
                  </div>
                  <div className="overflow-auto max-h-72">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-slate-50/90 dark:bg-slate-800/90 backdrop-blur-sm z-10">
                        <tr className="border-b border-[var(--glass-border)]">
                          <th className="th text-left pl-4">#</th>
                          <th className="th text-left">Name in Sheet</th>
                          <th className="th text-left min-w-[180px]">Matched Employee</th>
                          <th className="th text-right">Days</th>
                          <th className="th text-right">Gross</th>
                          {mode === "prefilled" && <th className="th text-right">Total Ded</th>}
                          {mode === "prefilled" && <th className="th text-right">Payment</th>}
                          <th className="th text-left">Checks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                        {checkedRows.map((row) => {
                          const suggestion = row.suggestionId ? empById.get(row.suggestionId) : undefined;
                          return (
                            <tr key={row._rowNum} className={clsx("tr-hover align-top", !row.valid && "bg-red-50/30 dark:bg-red-900/5")}>
                              <td className="td pl-4 text-[var(--text-muted)]">{row._rowNum + 1}</td>
                              <td className="td">{row.name}</td>
                              <td className="td">
                                <select
                                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 text-[11.5px]"
                                  value={row.employeeId ?? ""}
                                  onChange={(e) => setRowEmployee(row._rowNum, e.target.value || null)}
                                >
                                  <option value="">— select employee —</option>
                                  {employees.map((e) => (
                                    <option key={e.id} value={e.id}>
                                      {fullName(e)} ({e.emp_code})
                                    </option>
                                  ))}
                                </select>
                                {row.matchType === "exact" && row.employeeId && (
                                  <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                                    <UserCheck className="h-3 w-3" /> exact match
                                  </span>
                                )}
                                {!row.employeeId && suggestion && (
                                  <button
                                    onClick={() => setRowEmployee(row._rowNum, suggestion.id)}
                                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
                                  >
                                    Did you mean {fullName(suggestion)}? Click to use
                                  </button>
                                )}
                              </td>
                              <td className="td text-right font-numeric">{row.totalDays || "—"}</td>
                              <td className="td text-right font-numeric">{inr(row.gross)}</td>
                              {mode === "prefilled" && <td className="td text-right font-numeric">{inr(row.totalDed)}</td>}
                              {mode === "prefilled" && <td className="td text-right font-numeric">{inr(row.payment)}</td>}
                              <td className="td">
                                {row.valid && row.warnings.length === 0 && (
                                  <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="h-3 w-3" /> OK
                                  </span>
                                )}
                                {row.errors.map((e, i) => (
                                  <div key={`e${i}`} className="text-[10px] text-red-500 dark:text-red-400">{e}</div>
                                ))}
                                {row.warnings.map((w, i) => (
                                  <div key={`w${i}`} className="text-[10px] text-amber-600 dark:text-amber-400">⚠ {w}</div>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {errorCount > 0 && (
                  <div className="flex items-center gap-2 text-[11.5px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {errorCount} row(s) are blocked and will be <strong>skipped</strong> — resolve the employee match or fix the sheet. Warnings don't block the import.
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── Step 3: Results ─── */}
            {step === 3 && result && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className={clsx(
                  "rounded-2xl border p-5 flex items-center gap-4",
                  result.failed === 0
                    ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40"
                    : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40"
                )}>
                  {result.failed === 0 ? (
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-amber-500 shrink-0" />
                  )}
                  <div>
                    <div className={clsx("font-display font-bold text-[16px]",
                      result.failed === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"
                    )}>
                      {result.failed === 0
                        ? "Register Imported — Cycle Computed!"
                        : `${result.computed} of ${result.total_employees} rows imported`}
                    </div>
                    <div className="text-[12px] mt-0.5 opacity-80">
                      Cycle is now <strong>{result.status}</strong>. {result.computed} payroll result(s) written
                      {mode === "compute" ? " with system-computed deductions" : " from the sheet's figures"}.
                      {result.status === "COMPUTED" && " You can now Review Summary and Approve & Disburse to generate payslips."}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <KPI label="Rows Sent" value={result.total_employees}
                    color="bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300" />
                  <KPI label="Imported" value={result.computed}
                    color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-400" />
                  <KPI label="Failed" value={result.failed}
                    color={clsx(result.failed > 0
                      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-400"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400")} />
                </div>

                {result.errors.length > 0 && (
                  <div className="rounded-xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1.5">Errors</div>
                    <ul className="list-disc pl-5 space-y-0.5 text-[11.5px] text-red-700 dark:text-red-300">
                      {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--glass-border)]">
          <div>
            {step > 0 && step < 3 && (
              <button onClick={() => setStep((s) => s - 1)} className="btn-ghost flex items-center gap-1.5 text-[12.5px]">
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step === 3 ? (
              <button onClick={onClose} className="btn">
                <CheckCircle2 className="h-3.5 w-3.5" /> Done
              </button>
            ) : step === 2 ? (
              <button
                onClick={() => importMut.mutate()}
                disabled={importMut.isPending || validCount === 0}
                className="btn"
              >
                {importMut.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    Import {validCount} Row{validCount !== 1 ? "s" : ""}
                  </>
                )}
              </button>
            ) : step === 1 ? null : (
              <button onClick={() => setStep(1)} className="btn">
                Next — Upload File <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
