/**
 * BulkImportModal.tsx
 * 4-step wizard for bulk employee import:
 *   Step 1 — Download Excel Template
 *   Step 2 — Upload file (drag-and-drop)
 *   Step 3 — Validate & Preview
 *   Step 4 — Import + Result report
 */

import { useState, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";
import {
  FileSpreadsheet, Download, Upload, CheckCircle2, XCircle,
  AlertTriangle, X, ChevronRight, ChevronLeft, Loader2,
  Users, AlertCircle, FileDown, RefreshCw,
} from "lucide-react";
import { employeesApi, type BulkImportRow, type BulkImportResult, type RowResult } from "../api/employees";
import { salaryApi } from "../api/salary";
import { extractErrorMessage } from "../lib/toast";
import clsx from "clsx";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = ["Download Template", "Upload File", "Preview & Validate", "Import Results"];

const MANDATORY_HEADERS = [
  "Name", "Mobile", "Aadhaar Number",
  "Department", "Work Location", "Date of Joining",
  "Employment Type", "Basic Salary (Annual CTC)",
];
const OPTIONAL_HEADERS = [
  "Employee Code", "Email", "Designation", "PAN Number", "UAN Number", "Bank Account", "IFSC Code",
  "Gender", "Date of Birth", "State", "City", "Branch",
];
const ALL_HEADERS = [...MANDATORY_HEADERS, ...OPTIONAL_HEADERS];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE   = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE  = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedRow extends BulkImportRow {
  _rowNum: number;          // 1-based (skipping header)
  _errors: string[];
  _isValid: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template generator
// ─────────────────────────────────────────────────────────────────────────────

function downloadTemplate() {
  const sampleRows = [
    [
      "Rahul Sharma", "9876543210", "123456789012",
      "Engineering", "Pune", "2026-06-01", "Full Time", "540000",
      "E010", "rahul@company.com", "Developer", "ABCDE1234F", "", "12345678901", "HDFC0001234", "", "", "Maharashtra", "Mumbai", "",
    ],
    [
      "Priya Patil", "9876543211", "987654321098",
      "HR", "Mumbai", "2026-06-01", "Full Time", "420000",
      "", "priya@company.com", "Executive", "", "", "", "", "Female", "", "Maharashtra", "Mumbai", "",
    ],
  ];

  // Sheet 1 — Data
  const ws1 = XLSX.utils.aoa_to_sheet([ALL_HEADERS, ...sampleRows]);
  ws1["!cols"] = ALL_HEADERS.map((h) => ({ wch: Math.max(h.length + 4, 16) }));

  // Mark mandatory columns red (A–K = cols 0–10)
  const headerRange = XLSX.utils.decode_range(ws1["!ref"] ?? "A1:U1");
  for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws1[cellAddr]) continue;
    ws1[cellAddr].s = {
      font: { bold: true, color: { rgb: c < MANDATORY_HEADERS.length ? "CC0000" : "555555" } },
      fill: { patternType: "solid", fgColor: { rgb: c < MANDATORY_HEADERS.length ? "FFE8E8" : "F5F5F5" } },
    };
  }

  // Sheet 2 — Instructions
  const instructions: string[][] = [
    ["BULK EMPLOYEE IMPORT — INSTRUCTIONS"],
    [""],
    ["MANDATORY COLUMNS (marked in red in the Data sheet)"],
    ...MANDATORY_HEADERS.map((h, i) => [`  ${i + 1}. ${h}`]),
    [""],
    ["OPTIONAL COLUMNS"],
    ...OPTIONAL_HEADERS.map((h, i) => [`  ${i + 1}. ${h}`]),
    [""],
    ["FORMAT RULES"],
    ["  Employee Code   : Optional. If left blank, it will be auto-generated (e.g. EMP-1A2B3C)"],
    ["  Email           : Valid email format (e.g. name@company.com)"],
    ["  Mobile          : Exactly 10 digits"],
    ["  Aadhaar Number  : Exactly 12 digits"],
    ["  Date of Joining : YYYY-MM-DD (e.g. 2026-06-01) or DD-MM-YYYY"],
    ["  Employment Type : Full Time / Part Time / Contract"],
    ["  Basic Salary    : Annual CTC in INR, numbers only (e.g. 540000)"],
    ["  PAN Number      : 10-char alphanumeric (e.g. ABCDE1234F)"],
    ["  IFSC Code       : 11-char (e.g. HDFC0001234)"],
    [""],
    ["NOTES"],
    ["  • Duplicate Employee Codes or Emails will be skipped."],
    ["  • Missing departments will be auto-created."],
    ["  • Rows with validation errors will be skipped; a report can be downloaded."],
    ["  • Maximum 5000 rows per upload."],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(instructions);
  ws2["!cols"] = [{ wch: 70 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "Employee Data");
  XLSX.utils.book_append_sheet(wb, ws2, "Instructions");
  XLSX.writeFile(wb, "BulkEmployee_Import_Template.xlsx");
}

// ─────────────────────────────────────────────────────────────────────────────
// Excel / CSV parser
// ─────────────────────────────────────────────────────────────────────────────

function parseDate(raw: string | number | undefined): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  // XLSX serial number
  if (/^\d+$/.test(s) && Number(s) > 30000) {
    const d = XLSX.SSF.parse_date_code(Number(s));
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  return undefined;
}

function parseFile(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellText: true, cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];

        if (raw.length < 2) throw new Error("File has no data rows");

        // Map header → column index (case-insensitive partial match)
        const header = (raw[0] as string[]).map((h) => String(h).trim().toLowerCase());
        const colIdx = (target: string): number =>
          header.findIndex((h) => h.includes(target.toLowerCase().split(" ")[0]));

        const COL: Record<string, number> = {
          emp_code:       Math.max(colIdx("employee code"), colIdx("emp code"), colIdx("emp_code")),
          name:           colIdx("name"),
          email:          colIdx("email"),
          mobile:         colIdx("mobile"),
          department:     colIdx("department"),
          designation:    colIdx("designation"),
          work_location:  colIdx("work location"),
          joining_date:   colIdx("date of joining"),
          employment_type:colIdx("employment type"),
          basic_salary:   Math.max(colIdx("basic salary"), colIdx("ctc"), colIdx("salary")),
          pan_number:     colIdx("pan"),
          uan_number:     colIdx("uan"),
          bank_account:   colIdx("account number"),
          bank_ifsc:      colIdx("ifsc"),
          aadhaar_number: Math.max(colIdx("aadhaar"), colIdx("aadhar")),
          gender:         colIdx("gender"),
          date_of_birth:  colIdx("date of birth"),
          state:          colIdx("state"),
          city:           colIdx("city"),
          branch:         colIdx("branch"),
        };

        const get = (r: string[], key: string): string =>
          COL[key] >= 0 ? String(r[COL[key]] ?? "").trim() : "";

        const parsed: ParsedRow[] = [];
        const seenCodes = new Set<string>();
        const seenEmails = new Set<string>();

        for (let i = 1; i < raw.length; i++) {
          const r = raw[i] as string[];
          // Skip completely empty rows
          if (r.every((c) => !String(c).trim())) continue;

          const empCode  = get(r, "emp_code");
          const name     = get(r, "name");
          const email    = get(r, "email").toLowerCase();
          const mobile   = get(r, "mobile").replace(/\D/g, "");
          const salary   = parseFloat(get(r, "basic_salary")) || undefined;
          const joiningRaw = get(r, "joining_date");
          const joiningDate = parseDate(joiningRaw);
          const pan      = get(r, "pan_number").toUpperCase();
          const ifsc     = get(r, "bank_ifsc").toUpperCase();
          const aadhaar  = get(r, "aadhaar_number").replace(/\D/g, "");

          const errors: string[] = [];

          // Validation
          if (!name)       errors.push("Name is required");
          if (email && !EMAIL_RE.test(email)) errors.push(`Invalid email: ${email}`);
          if (mobile && mobile.length !== 10) errors.push("Mobile must be 10 digits");
          if (!aadhaar) errors.push("Aadhaar Number is required");
          else if (aadhaar.length !== 12) errors.push("Aadhaar must be 12 digits");
          if (!joiningDate && joiningRaw)  errors.push(`Cannot parse Joining Date: "${joiningRaw}"`);
          if (salary !== undefined && salary <= 0) errors.push("Basic Salary must be positive number");
          if (pan && !PAN_RE.test(pan))  errors.push(`Invalid PAN: ${pan}`);
          if (ifsc && !IFSC_RE.test(ifsc)) errors.push(`Invalid IFSC: ${ifsc}`);

          // Intra-file duplicate check
          if (empCode && seenCodes.has(empCode.toLowerCase())) {
            errors.push("Duplicate Employee Code in this file");
          } else if (empCode) {
            seenCodes.add(empCode.toLowerCase());
          }
          if (email && email !== "" && seenEmails.has(email)) {
            errors.push("Duplicate Email in this file");
          } else if (email) {
            seenEmails.add(email);
          }

          parsed.push({
            _rowNum: i,
            _errors: errors,
            _isValid: errors.length === 0,
            emp_code: empCode,
            name: name,
            email: email || undefined,
            mobile: mobile || undefined,
            department: get(r, "department") || undefined,
            designation: get(r, "designation") || undefined,
            work_location: get(r, "work_location") || undefined,
            joining_date: joiningDate,
            employment_type: get(r, "employment_type") || undefined,
            basic_salary: salary,
            pan_number: pan || undefined,
            uan_number: get(r, "uan_number") || undefined,
            aadhaar_number: aadhaar,
            bank_account: get(r, "bank_account") || undefined,
            bank_ifsc: ifsc || undefined,
            gender: get(r, "gender") || undefined,
            state: get(r, "state") || undefined,
            city: get(r, "city") || undefined,
            branch: get(r, "branch") || undefined,
          });
        }
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Error report download
// ─────────────────────────────────────────────────────────────────────────────

function downloadErrorReport(rows: RowResult[]) {
  const errorRows = rows.filter((r) => r.status !== "created");
  if (!errorRows.length) return;
  const data = [
    ["Row #", "Employee Code", "Name", "Status", "Error Message"],
    ...errorRows.map((r) => [
      r.row_index + 2,   // +2: header row + 1-based
      r.emp_code,
      r.name,
      r.status.toUpperCase(),
      r.error ?? "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 8 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Error Report");
  XLSX.writeFile(wb, `BulkImport_ErrorReport_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────────────────

function RowBadge({ status }: { status: "valid" | "error" | "duplicate" | "created" | "duplicate_server" }) {
  const cfg = {
    valid:            { cls: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40", label: "Valid" },
    error:            { cls: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-700/40", label: "Error" },
    duplicate:        { cls: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/40", label: "Duplicate" },
    created:          { cls: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700/40", label: "Imported ✓" },
    duplicate_server: { cls: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700/40", label: "Duplicate" },
  };
  const { cls, label } = cfg[status] ?? cfg.error;
  return <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", cls)}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI card
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
  onClose: () => void;
  onImported: () => void;
}

export function BulkImportModal({ onClose, onImported }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [salaryProgress, setSalaryProgress] = useState({ done: 0, total: 0 });
  const [salaryError, setSalaryError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Parse file whenever a new file is selected ──────────────────────────
  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setParseError("");
    setRows([]);
    try {
      const parsed = await parseFile(f);
      if (parsed.length > 5000) {
        setParseError("Maximum 5000 rows per upload. Please split the file.");
        return;
      }
      setRows(parsed);
      setStep(2);
    } catch (err: any) {
      setParseError(err.message ?? "Failed to parse file");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Import mutation ───────────────────────────────────────────────────────
  const importMut = useMutation({
    mutationFn: async () => {
      setSalaryError("");
      setSalaryProgress({ done: 0, total: 0 });
      const validRows = rows.filter((r) => r._isValid);
      const payload: BulkImportRow[] = validRows.map(({ _rowNum, _errors, _isValid, ...rest }) => rest);
      const res = await employeesApi.bulkImport(payload);

      // Auto-create salary structures for created employees that have basic_salary
      const salaryRows = res.rows.filter(
        (r) => (r.status === "created" || r.status === "duplicate") && r.employee_id
      );
      const salaryNeeded = salaryRows.filter((r) => {
        const src = validRows[r.row_index];
        return src && src.basic_salary && src.basic_salary > 0;
      });

      if (salaryNeeded.length > 0) {
        setSalaryProgress({ done: 0, total: salaryNeeded.length });
        const structures = salaryNeeded.flatMap((sr) => {
          const src = validRows[sr.row_index];
          if (!src || !src.basic_salary || !sr.employee_id) return [];
          return [{
            employee_id: sr.employee_id,
            ctc: src.basic_salary,
            effective_from: src.joining_date ?? new Date().toISOString().slice(0, 10),
            work_location: sr.work_location ?? src.work_location ?? null,
          }];
        });
        try {
          const salaryRes = await salaryApi.bulkCreate(structures);
          setSalaryProgress({ done: salaryRes.created, total: structures.length });
        } catch (err) {
          setSalaryProgress({ done: 0, total: structures.length });
          setSalaryError(extractErrorMessage(err));
        }
      }

      return res;
    },
    onSuccess: (res) => {
      setResult(res);
      setStep(3);
      qc.invalidateQueries({ queryKey: ["employees"] });
      if (res.created > 0) onImported();
    },
    onError: (err) => setParseError(extractErrorMessage(err)),
  });

  // ── Derived counts ────────────────────────────────────────────────────────
  const validCount = rows.filter((r) => r._isValid).length;
  const errorCount = rows.filter((r) => !r._isValid).length;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-10 w-full max-w-3xl max-h-[90vh] flex flex-col rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-50 dark:bg-accent-900/30">
              <FileSpreadsheet className="h-5 w-5 text-accent-600" />
            </div>
            <div>
              <div className="font-display font-bold text-[15px] text-[var(--text-primary)]">Bulk Import Employees</div>
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
            {/* ─── Step 0: Download Template ─── */}
            {step === 0 && (
              <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <div className="rounded-2xl border border-dashed border-accent-300 dark:border-accent-700 bg-accent-50/40 dark:bg-accent-900/10 p-6 text-center">
                  <FileSpreadsheet className="h-12 w-12 text-accent-400 mx-auto mb-3" />
                  <h3 className="font-display font-bold text-[15px] text-[var(--text-primary)] mb-1">Download Excel Template</h3>
                  <p className="text-[12px] text-[var(--text-muted)] mb-4 max-w-sm mx-auto">
                    Use our pre-formatted template to ensure all required fields are correctly filled.
                    The file includes sample data and detailed instructions.
                  </p>
                  <button onClick={downloadTemplate} className="btn mx-auto">
                    <Download className="h-4 w-4" />
                    Download Excel Template
                  </button>
                </div>

                <div className="rounded-xl border border-[var(--glass-border)] overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/40 border-b border-[var(--glass-border)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Template Columns</span>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-1">
                    <div>
                      <div className="text-[10.5px] font-semibold text-red-500 uppercase tracking-wider mb-1.5">Mandatory</div>
                      {MANDATORY_HEADERS.map((h) => (
                        <div key={h} className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] py-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                          {h}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Optional</div>
                      {OPTIONAL_HEADERS.map((h) => (
                        <div key={h} className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] py-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
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
                    {dragging ? "Drop to upload" : "Drag & drop your file here"}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-muted)]">or click to browse</div>
                  <div className="mt-3 text-[10.5px] text-[var(--text-muted)] bg-slate-100 dark:bg-slate-800 rounded-full px-3 py-1">
                    .xlsx · .xls · .csv — max 5000 rows
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

                <div className="text-center">
                  <button onClick={downloadTemplate} className="btn-ghost text-[12px] inline-flex items-center gap-1.5">
                    <Download className="h-3.5 w-3.5" />
                    Need the template? Download it here
                  </button>
                </div>
              </motion.div>
            )}

            {/* ─── Step 2: Preview & Validate ─── */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                {/* KPI summary */}
                <div className="grid grid-cols-4 gap-2">
                  <KPI label="Total" value={rows.length}
                    color="bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300" />
                  <KPI label="Valid" value={validCount}
                    color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-400" />
                  <KPI label="Invalid" value={errorCount}
                    color={clsx(
                      errorCount > 0
                        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-400"
                        : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400"
                    )} />
                  <KPI label="Ready to Import" value={validCount}
                    color="bg-accent-50 dark:bg-accent-900/20 border-accent-200 dark:border-accent-700/40 text-accent-700 dark:text-accent-400" />
                </div>

                {validCount === 0 && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2.5 text-[12px] text-red-700 dark:text-red-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    No valid rows found. Please fix errors and re-upload.
                  </div>
                )}

                {parseError && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 px-3 py-2.5 text-[12.5px] text-red-700 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {parseError}
                  </div>
                )}

                {/* Preview table */}
                <div className="rounded-xl border border-[var(--glass-border)] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/40 border-b border-[var(--glass-border)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Preview — {file?.name}
                    </span>
                    <button onClick={() => { setStep(1); setRows([]); setFile(null); }} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1">
                      <RefreshCw className="h-3 w-3" /> Change file
                    </button>
                  </div>
                  <div className="overflow-auto max-h-64">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-slate-50/90 dark:bg-slate-800/90 backdrop-blur-sm">
                        <tr className="border-b border-[var(--glass-border)]">
                          <th className="th text-left pl-4">#</th>
                          <th className="th text-left">Code</th>
                          <th className="th text-left">Name</th>
                          <th className="th text-left">Email</th>
                          <th className="th text-left">Department</th>
                          <th className="th text-left">Salary</th>
                          <th className="th text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                        {rows.map((row) => (
                          <tr key={row._rowNum} className={clsx("tr-hover", !row._isValid && "bg-red-50/30 dark:bg-red-900/5")}>
                            <td className="td pl-4 text-[var(--text-muted)]">{row._rowNum + 1}</td>
                            <td className="td font-mono">{row.emp_code || <span className="text-red-400">—</span>}</td>
                            <td className="td">{`${row.first_name} ${row.last_name}`.trim() || <span className="text-red-400">—</span>}</td>
                            <td className="td text-[10.5px] text-[var(--text-muted)] max-w-[140px] truncate">{row.email ?? "—"}</td>
                            <td className="td text-[var(--text-muted)]">{row.department ?? "—"}</td>
                            <td className="td font-numeric text-[var(--text-secondary)]">
                              {row.basic_salary ? `₹${row.basic_salary.toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td className="td">
                              {row._isValid ? (
                                <RowBadge status="valid" />
                              ) : (
                                <div className="space-y-0.5">
                                  <RowBadge status="error" />
                                  {row._errors.map((e, i) => (
                                    <div key={i} className="text-[10px] text-red-500 dark:text-red-400">{e}</div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {errorCount > 0 && (
                  <div className="flex items-center gap-2 text-[11.5px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {errorCount} row(s) have errors and will be <strong>skipped</strong>. Only {validCount} valid rows will be imported.
                  </div>
                )}
              </motion.div>
            )}

            {/* ─── Step 3: Results ─── */}
            {step === 3 && result && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                {/* Big result banner */}
                <div className={clsx(
                  "rounded-2xl border p-5 flex items-center gap-4",
                  result.errors === 0 && result.duplicates === 0
                    ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40"
                    : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40"
                )}>
                  {result.errors === 0 && result.duplicates === 0 ? (
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-8 w-8 text-amber-500 shrink-0" />
                  )}
                  <div>
                    <div className={clsx("font-display font-bold text-[16px]",
                      result.errors === 0 && result.duplicates === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"
                    )}>
                      {result.created === result.total ? "Import Successful!" : `${result.created} of ${result.total} Imported`}
                    </div>
                    <div className="text-[12px] mt-0.5 opacity-80">
                      {result.created} employees created successfully.
                      {result.duplicates > 0 && ` ${result.duplicates} duplicate(s) skipped.`}
                      {result.errors > 0 && ` ${result.errors} error(s) skipped.`}
                    </div>
                  </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-4 gap-2">
                  <KPI label="Total" value={result.total}
                    color="bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300" />
                  <KPI label="Imported" value={result.created}
                    color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-700 dark:text-emerald-400" />
                  <KPI label="Duplicates" value={result.duplicates}
                    color={clsx(result.duplicates > 0
                      ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-400"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400")} />
                  <KPI label="Errors" value={result.errors}
                    color={clsx(result.errors > 0
                      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-700 dark:text-red-400"
                      : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-400")} />
                </div>

                {/* Salary progress */}
                {salaryProgress.total > 0 && (
                  <div className="rounded-xl border border-[var(--glass-border)] p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span className="font-semibold text-[var(--text-secondary)]">Salary Structures</span>
                      <span className={clsx(salaryError ? "text-red-500" : "text-[var(--text-muted)]")}>
                        {salaryProgress.done}/{salaryProgress.total} created
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <motion.div
                        className={clsx("h-full rounded-full", salaryError ? "bg-red-500" : "bg-accent-500")}
                        initial={{ width: 0 }}
                        animate={{ width: `${(salaryProgress.done / salaryProgress.total) * 100}%` }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                    {salaryError && (
                      <div className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        Salary setup failed: {salaryError}
                      </div>
                    )}
                  </div>
                )}

                {/* Per-row results table */}
                <div className="rounded-xl border border-[var(--glass-border)] overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50/60 dark:bg-slate-800/40 border-b border-[var(--glass-border)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Import Results</span>
                  </div>
                  <div className="overflow-auto max-h-52">
                    <table className="w-full text-[11.5px]">
                      <thead className="sticky top-0 bg-slate-50/90 dark:bg-slate-800/90">
                        <tr className="border-b border-[var(--glass-border)]">
                          <th className="th pl-4">#</th>
                          <th className="th">Code</th>
                          <th className="th">Name</th>
                          <th className="th">Status</th>
                          <th className="th">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                        {result.rows.map((r) => (
                          <tr key={r.row_index} className="tr-hover">
                            <td className="td pl-4 text-[var(--text-muted)]">{r.row_index + 2}</td>
                            <td className="td font-mono">{r.emp_code}</td>
                            <td className="td">{r.name}</td>
                            <td className="td"><RowBadge status={r.status === "duplicate" ? "duplicate" : r.status as any} /></td>
                            <td className="td text-[10.5px] text-[var(--text-muted)]">{r.error ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Download error report */}
                {(result.errors > 0 || result.duplicates > 0) && (
                  <button
                    onClick={() => downloadErrorReport(result.rows)}
                    className="btn-ghost w-full flex items-center justify-center gap-2 text-[12.5px]"
                  >
                    <FileDown className="h-4 w-4" />
                    Download Error Report (.xlsx)
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--glass-border)]">
          <div>
            {step > 0 && step < 3 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="btn-ghost flex items-center gap-1.5 text-[12.5px]"
              >
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
                    <Users className="h-3.5 w-3.5" />
                    Import {validCount} Employee{validCount !== 1 ? "s" : ""}
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
