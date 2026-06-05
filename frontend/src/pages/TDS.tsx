import {
  useState, useMemo, useRef, useEffect, useCallback, memo,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Receipt, TrendingDown, TrendingUp, Wallet, Percent, Award,
  ChevronDown, Info, AlertCircle, CheckCircle2, XCircle,
  FileText, Home, GraduationCap, Heart, Gift,
  Users, Search, ArrowRight, Zap, ShieldCheck,
  Calendar, Scale, PiggyBank, IndianRupee,
} from "lucide-react";
import { tdsApi } from "../api/tds";
import { salaryApi } from "../api/salary";
import { payrollApi } from "../api/payroll";
import { employeesApi } from "../api/employees";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { PageHeader } from "../components/PageHeader";
import { formatINR } from "../lib/money";
import { toastService, extractErrorMessage } from "../lib/toast";
import { useAuth } from "../lib/auth";
import { isEmployeeOnly, hasRole } from "../lib/roles";
import clsx from "clsx";

// ═══════════════════════════════════════════════════════════════════════════════
// § 1 — CLIENT-SIDE TAX ENGINE
// Mirrors services/tds-service/app/logic.py — FY 2025-26 (ITA 1961 v2025)
// ═══════════════════════════════════════════════════════════════════════════════

function m(n: number) { return Math.round(n * 100) / 100; }
function cap(n: number, limit: number) { return Math.max(0, Math.min(n, limit)); }

interface SlabSpec { lower: number; upper: number | null; rate: number }
interface SlabRow { from: number; to: number | null; rate: number; taxable: number; tax: number }

function slabTax(income: number, slabs: SlabSpec[]): { tax: number; trace: SlabRow[] } {
  let total = 0;
  const trace: SlabRow[] = [];
  for (const s of slabs) {
    const top = s.upper === null ? income : Math.min(income, s.upper);
    const taxable = Math.max(0, top - s.lower);
    const tax = income > s.lower ? m(taxable * s.rate) : 0;
    total += tax;
    trace.push({ from: s.lower, to: s.upper, rate: s.rate, taxable, tax });
  }
  return { tax: m(total), trace };
}

const OLD_SLABS: SlabSpec[] = [
  { lower: 0, upper: 250_000, rate: 0 },
  { lower: 250_000, upper: 500_000, rate: 0.05 },
  { lower: 500_000, upper: 1_000_000, rate: 0.20 },
  { lower: 1_000_000, upper: null, rate: 0.30 },
];
const NEW_SLABS: SlabSpec[] = [
  { lower: 0, upper: 300_000, rate: 0 },
  { lower: 300_000, upper: 700_000, rate: 0.05 },
  { lower: 700_000, upper: 1_000_000, rate: 0.10 },
  { lower: 1_000_000, upper: 1_200_000, rate: 0.15 },
  { lower: 1_200_000, upper: 1_500_000, rate: 0.20 },
  { lower: 1_500_000, upper: null, rate: 0.30 },
];

function computeHRAExempt(basicM: number, hraM: number, rentM: number, metro: boolean): number {
  if (rentM <= 0 || hraM <= 0) return 0;
  return Math.max(0, Math.min(
    hraM * 12,
    rentM * 12 - 0.1 * basicM * 12,
    basicM * 12 * (metro ? 0.5 : 0.4),
  ));
}

interface Declarations {
  regime: "OLD" | "NEW" | "AUTO";
  // 80C (cap ₹1,50,000)
  epf: number; ppf: number; elss: number; lic: number;
  nsc: number; taxSaverFD: number; homeLoanPrincipal: number;
  // 80CCD(1B) NPS extra cap ₹50,000
  nps80ccd: number;
  // 80D
  mediclaim_self: number; mediclaim_parents: number; parents_senior: boolean;
  // HRA
  rent_monthly: number; is_metro: boolean; landlord_pan: string;
  // 24B Home Loan Interest (cap ₹2,00,000)
  homeLoanInterest: number;
  // 80E Education Loan (no cap)
  eduLoanInterest: number;
  // 80G
  donations100: number; donations50: number;
  // Other
  lta: number; professional_tax: number;
}

interface DetailLine { label: string; amount: number; section: string }

interface TaxResult {
  annualGross: number;
  totalExemptions: number;
  totalDeductions: number;
  taxableIncome: number;
  taxBeforeRebate: number;
  rebate: number;
  surcharge: number;
  cess: number;
  annualTax: number;
  remainingTax: number;
  monthlyTDS: number;
  effectiveRate: number;
  slabs: SlabRow[];
  deductions: DetailLine[];
  exemptions: DetailLine[];
}

function computeTax(
  annualGross: number,
  basicM: number,
  hraM: number,
  decl: Declarations,
  regime: "OLD" | "NEW",
  remainingMonths: number,
  ytdTDS = 0,
): TaxResult {
  const deds: DetailLine[] = [];
  const exes: DetailLine[] = [];

  if (regime === "NEW") {
    const std = 75_000;
    deds.push({ label: "Standard Deduction", amount: std, section: "16(ia)" });
    const taxableIncome = Math.max(0, annualGross - std);
    const { tax, trace } = slabTax(taxableIncome, NEW_SLABS);
    const rebate = taxableIncome <= 700_000 ? Math.min(tax, 25_000) : 0;
    const net = Math.max(0, tax - rebate);
    const cess = m(net * 0.04);
    const annualTax = m(net + cess);
    const remainingTax = Math.max(0, annualTax - ytdTDS);
    return {
      annualGross, totalExemptions: 0, totalDeductions: std,
      taxableIncome, taxBeforeRebate: tax, rebate, surcharge: 0, cess,
      annualTax, remainingTax, monthlyTDS: m(remainingTax / Math.max(remainingMonths, 1)),
      effectiveRate: annualGross > 0 ? (annualTax / annualGross) * 100 : 0,
      slabs: trace, deductions: deds, exemptions: exes,
    };
  }

  // OLD REGIME
  deds.push({ label: "Standard Deduction", amount: 50_000, section: "16(ia)" });

  const c80C_raw = (decl.epf||0)+(decl.ppf||0)+(decl.elss||0)+(decl.lic||0)+
    (decl.nsc||0)+(decl.taxSaverFD||0)+(decl.homeLoanPrincipal||0);
  const c80C = cap(c80C_raw, 150_000);
  if (c80C > 0) deds.push({ label: `80C (${fmtL(c80C_raw)} declared)`, amount: c80C, section: "80C" });

  const nps = cap(decl.nps80ccd||0, 50_000);
  if (nps > 0) deds.push({ label: "80CCD(1B) – NPS", amount: nps, section: "80CCD(1B)" });

  const d80D = cap(decl.mediclaim_self||0, 25_000) +
    cap(decl.mediclaim_parents||0, decl.parents_senior ? 50_000 : 25_000);
  if (d80D > 0) deds.push({ label: "80D – Medical Insurance", amount: d80D, section: "80D" });

  const hliAmt = cap(decl.homeLoanInterest||0, 200_000);
  if (hliAmt > 0) deds.push({ label: "24B – Home Loan Interest", amount: hliAmt, section: "24(b)" });

  const edu = decl.eduLoanInterest||0;
  if (edu > 0) deds.push({ label: "80E – Education Loan", amount: edu, section: "80E" });

  const g80 = (decl.donations100||0) + m((decl.donations50||0) * 0.5);
  if (g80 > 0) deds.push({ label: "80G – Donations", amount: g80, section: "80G" });

  const pt = cap(decl.professional_tax||0, 2_500);
  if (pt > 0) deds.push({ label: "Professional Tax", amount: pt, section: "16(iii)" });

  const hraEx = computeHRAExempt(basicM, hraM, decl.rent_monthly||0, decl.is_metro);
  if (hraEx > 0) exes.push({ label: "HRA Exemption", amount: hraEx, section: "10(13A)" });

  const lta = decl.lta||0;
  if (lta > 0) exes.push({ label: "LTA", amount: lta, section: "10(5)" });

  const totalDeductions = deds.reduce((s, d) => s + d.amount, 0);
  const totalExemptions = exes.reduce((s, e) => s + e.amount, 0);
  const taxableIncome = Math.max(0, annualGross - totalExemptions - totalDeductions);
  const { tax, trace } = slabTax(taxableIncome, OLD_SLABS);
  const rebate = taxableIncome <= 500_000 ? Math.min(tax, 12_500) : 0;
  const net = Math.max(0, tax - rebate);
  const cess = m(net * 0.04);
  const annualTax = m(net + cess);
  const remainingTax = Math.max(0, annualTax - ytdTDS);

  return {
    annualGross, totalExemptions, totalDeductions,
    taxableIncome, taxBeforeRebate: tax, rebate, surcharge: 0, cess,
    annualTax, remainingTax, monthlyTDS: m(remainingTax / Math.max(remainingMonths, 1)),
    effectiveRate: annualGross > 0 ? (annualTax / annualGross) * 100 : 0,
    slabs: trace, deductions: deds, exemptions: exes,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtL(n: number): string {
  if (Math.abs(n) >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(n) >= 100_000) return `₹${(n / 100_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function getRemainingMonths(): number {
  const now = new Date();
  const mo = now.getMonth() + 1; // 1-12
  const fyMo = mo >= 4 ? mo - 3 : mo + 9; // 1=Apr … 12=Mar
  // In March (fyMo=12), 12-12=0 → clamp to 1 so monthly TDS isn't infinity
  return Math.max(1, 13 - fyMo);
}

function getFYMonthIndex(): number {
  const mo = new Date().getMonth() + 1;
  return mo >= 4 ? mo - 4 : mo + 8; // 0=Apr … 11=Mar
}

const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

// ═══════════════════════════════════════════════════════════════════════════════
// § 2 — UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

function useAnimatedNumber(target: number, duration = 700): number {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (prev.current === target) return;
    const from = prev.current;
    const to = target;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * ease);
      if (t < 1) requestAnimationFrame(tick);
      else { prev.current = to; setVal(to); }
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return val;
}

const AnimatedINR = memo(({ value }: { value: number }) => {
  const v = useAnimatedNumber(value);
  return <>{formatINR(v)}</>;
});

const AnimatedPct = memo(({ value }: { value: number }) => {
  const v = useAnimatedNumber(value);
  return <>{v.toFixed(2)}%</>;
});

// ─── KPI Card ─────────────────────────────────────────────────────────────────
interface KPIProps {
  icon: React.ElementType;
  label: string;
  value: ReactNode;
  sub?: string;
  accent?: string;
  tooltip: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
}

function KPICard({ icon: Icon, label, value, sub, accent = "#5A52E5", tooltip, trend, trendLabel }: KPIProps) {
  const [tip, setTip] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-glass relative p-4 flex flex-col gap-2 overflow-hidden"
    >
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ background: `radial-gradient(circle at 80% 20%, ${accent}, transparent 70%)` }}
      />
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${accent}22` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
        <div className="relative">
          <button
            onMouseEnter={() => setTip(true)}
            onMouseLeave={() => setTip(false)}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <AnimatePresence>
            {tip && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-6 z-50 w-52 rounded-xl bg-[var(--glass-panel-bg)] border border-[var(--glass-border)] backdrop-blur-xl shadow-xl p-3 text-xs text-[var(--text-secondary)]"
              >
                {tooltip}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
        <div className="mt-0.5 font-display font-bold text-lg text-[var(--text-primary)] tabular-nums">{value}</div>
        {sub && <div className="text-[11px] text-[var(--text-muted)]">{sub}</div>}
      </div>
      {trend && trendLabel && (
        <div className={clsx("flex items-center gap-1 text-[11px] font-medium",
          trend === "down" ? "text-emerald-500" : trend === "up" ? "text-red-400" : "text-[var(--text-muted)]"
        )}>
          {trend === "down" ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
          {trendLabel}
        </div>
      )}
    </motion.div>
  );
}

// ─── Regime Card ─────────────────────────────────────────────────────────────
function RegimeCard({
  regime, result, isBetter, savings, isActive, onSelect,
}: {
  regime: "OLD" | "NEW";
  result: TaxResult;
  isBetter: boolean;
  savings: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className={clsx(
        "relative w-full rounded-2xl border p-5 text-left transition-all",
        isActive
          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-lg"
          : "border-[var(--glass-border)] bg-[var(--glass-card-bg)] hover:border-[var(--accent)]/40",
      )}
    >
      {isBetter && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-0.5 text-[10px] font-bold text-white shadow">
          <Award className="h-3 w-3" /> RECOMMENDED
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            {regime === "OLD" ? "Old Regime" : "New Regime"}
          </div>
          <div className="text-sm text-[var(--text-secondary)] mt-0.5">
            {regime === "OLD" ? "With deductions & exemptions" : "Simplified flat slabs"}
          </div>
        </div>
        <div className={clsx(
          "h-5 w-5 rounded-full border-2 flex-shrink-0",
          isActive ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--glass-border)]"
        )}>
          {isActive && <CheckCircle2 className="h-4 w-4 text-white" />}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Annual Tax", value: formatINR(result.annualTax) },
          { label: "Monthly TDS", value: formatINR(result.monthlyTDS) },
          { label: "Effective Rate", value: `${result.effectiveRate.toFixed(2)}%` },
          { label: savings > 0 ? "You save" : "Extra cost", value: formatINR(Math.abs(savings)) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">{label}</div>
            <div className="font-numeric font-bold text-sm text-[var(--text-primary)] mt-0.5">{value}</div>
          </div>
        ))}
      </div>
    </motion.button>
  );
}

// ─── Accordion Section ────────────────────────────────────────────────────────
function AccordionSection({
  icon: Icon,
  title,
  badge,
  taxSaved,
  isOpen,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  taxSaved?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 bg-[var(--glass-card-bg)] hover:bg-[var(--glass-panel-bg)] transition-colors text-left"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] flex-shrink-0">
          <Icon className="h-4 w-4 text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-[var(--text-primary)]">{title}</div>
          {badge && <div className="text-xs text-[var(--text-muted)]">{badge}</div>}
        </div>
        {taxSaved != null && taxSaved > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-emerald-600 dark:text-emerald-400 text-xs font-semibold shrink-0">
            <TrendingDown className="h-3 w-3" /> saves {fmtL(taxSaved)}
          </div>
        )}
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ overflow: "hidden" }}
          >
            <div className="px-5 pb-5 pt-2 bg-[var(--glass-card-bg)]/50 space-y-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Declaration Input ────────────────────────────────────────────────────────
function DeclInput({
  label, value, onChange, max, section, hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  section?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
        <div className="flex items-center gap-2">
          {section && <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded">{section}</span>}
          {max && <span className="text-[10px] text-[var(--text-muted)]">Limit: {fmtL(max)}</span>}
        </div>
      </div>
      <div className="relative">
        <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
        <input
          type="number"
          min={0}
          max={max}
          value={value || ""}
          placeholder="0"
          onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
          className="input pl-8 font-numeric text-sm"
        />
      </div>
      {max != null && value > 0 && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
            <span>{fmtL(Math.min(value, max))} used</span>
            <span>{fmtL(Math.max(0, max - Math.min(value, max)))} remaining</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--glass-border)] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (Math.min(value, max) / max) * 100)}%` }}
              transition={{ type: "spring", stiffness: 200, damping: 25 }}
              className={clsx("h-full rounded-full", value > max ? "bg-amber-500" : "bg-[var(--accent)]")}
            />
          </div>
        </div>
      )}
      {hint && <div className="text-[10px] text-[var(--text-muted)] mt-1">{hint}</div>}
    </div>
  );
}

// ─── Trace Step ───────────────────────────────────────────────────────────────
function TraceStep({
  label, value, type, section, note, isLast = false,
}: {
  label: string;
  value: number;
  type: "income" | "minus" | "equals" | "tax" | "final";
  section?: string;
  note?: string;
  isLast?: boolean;
}) {
  const colors = {
    income: "text-[var(--text-primary)] font-bold",
    minus: "text-emerald-600 dark:text-emerald-400",
    equals: "text-[var(--accent)] font-bold",
    tax: "text-red-500 font-semibold",
    final: "text-red-600 dark:text-red-400 font-bold text-base",
  };
  const prefixes = { income: "", minus: "−", equals: "=", tax: "+", final: "=" };

  return (
    <div className={clsx("flex items-center gap-3 py-2.5", !isLast && "border-b border-[var(--glass-border-subtle)]")}>
      <div className={clsx("w-5 text-center text-sm font-bold flex-shrink-0", colors[type])}>
        {prefixes[type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--text-secondary)]">{label}</div>
        {note && <div className="text-[10px] text-[var(--text-muted)]">{note}</div>}
      </div>
      {section && (
        <span className="text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] px-1.5 py-0.5 rounded shrink-0 hidden sm:block">
          §{section}
        </span>
      )}
      <div className={clsx("font-numeric text-sm shrink-0", colors[type])}>
        {formatINR(Math.abs(value))}
      </div>
    </div>
  );
}

// ─── Alert Badge ──────────────────────────────────────────────────────────────
function AlertBadge({ type, message }: { type: "warning" | "info" | "success" | "danger"; message: string }) {
  const cfg = {
    warning: { cls: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40 text-amber-800 dark:text-amber-300", icon: AlertCircle },
    info: { cls: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/40 text-blue-800 dark:text-blue-300", icon: Info },
    success: { cls: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/40 text-emerald-800 dark:text-emerald-300", icon: CheckCircle2 },
    danger: { cls: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-800 dark:text-red-300", icon: XCircle },
  };
  const { cls, icon: Icon } = cfg[type];
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className={clsx("flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm", cls)}
    >
      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>{message}</span>
    </motion.div>
  );
}

// ─── Custom tooltip for recharts ─────────────────────────────────────────────
const CustomChartTooltip = memo(({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-xl p-3 text-xs">
      <div className="font-semibold text-[var(--text-primary)] mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-[var(--text-secondary)]">
          <span className="h-2 w-2 rounded-full" style={{ background: p.fill || p.color }} />
          <span>{p.name}:</span>
          <span className="font-numeric font-semibold text-[var(--text-primary)]">{formatINR(p.value)}</span>
        </div>
      ))}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// § 3 — DEFAULTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_DECL: Declarations = {
  regime: "AUTO",
  epf: 0, ppf: 0, elss: 0, lic: 0, nsc: 0, taxSaverFD: 0, homeLoanPrincipal: 0,
  nps80ccd: 0,
  mediclaim_self: 0, mediclaim_parents: 0, parents_senior: false,
  rent_monthly: 0, is_metro: false, landlord_pan: "",
  homeLoanInterest: 0,
  eduLoanInterest: 0,
  donations100: 0, donations50: 0,
  lta: 0, professional_tax: 0,
};

type TabId = "overview" | "declarations" | "trace";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Scale },
  { id: "declarations", label: "Declarations", icon: FileText },
  { id: "trace", label: "Tax Trace", icon: Zap },
];

// ═══════════════════════════════════════════════════════════════════════════════
// § 4 — MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function TDS() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const empOnly = isEmployeeOnly(user);
  const isHR = hasRole(user, "SUPER_ADMIN", "ORG_ADMIN", "HR_MANAGER", "PAYROLL_ADMIN");

  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [decl, setDecl] = useState<Declarations>(EMPTY_DECL);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [openSection, setOpenSection] = useState<string | null>("80C");
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Data queries ─────────────────────────────────────────────────────────
  const myEmpQ = useQuery({
    queryKey: qk.myEmployee,
    queryFn: () => employeesApi.me(),
    staleTime: STALE_STABLE,
    enabled: empOnly,
  });

  const employeesQ = useQuery({
    queryKey: qk.employees({ page_size: 200, status: "ACTIVE" }),
    queryFn: () => employeesApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
    enabled: isHR,
  });

  const salaryQ = useQuery({
    queryKey: qk.salary(selectedEmpId),
    queryFn: () => salaryApi.getActive(selectedEmpId),
    enabled: !!selectedEmpId,
    staleTime: STALE_STABLE,
    retry: false,
  });

  const cyclesQ = useQuery({
    queryKey: qk.cycles,
    queryFn: () => payrollApi.listCycles(),
    staleTime: STALE_STABLE,
  });

  // ── Fetch saved declarations ──────────────────────────────────────────────
  const declQ = useQuery({
    queryKey: qk.tdsDeclarations(selectedEmpId),
    queryFn: () => tdsApi.getDeclarations(selectedEmpId),
    enabled: !!selectedEmpId,
    staleTime: STALE_STABLE,
    retry: false,
  });

  // ── Auto-select own employee for EMPLOYEE role ────────────────────────────
  useEffect(() => {
    if (empOnly && myEmpQ.data && !selectedEmpId) {
      setSelectedEmpId(myEmpQ.data.id);
    }
  }, [empOnly, myEmpQ.data, selectedEmpId]);

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowEmpDrop(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Derived salary/tax inputs ─────────────────────────────────────────────
  const salary = salaryQ.data;
  const annualGross = salary ? parseFloat(salary.ctc) : 0;
  const basicM   = salary ? parseFloat(salary.breakdown.basic) : 0;
  const hraM     = salary ? parseFloat(salary.breakdown.hra) : 0;
  const isMetro  = salary?.breakdown.is_metro ?? false;
  const remaining = getRemainingMonths();
  const fyMonthIdx = getFYMonthIndex();

  // update is_metro from salary location when employee changes
  useEffect(() => {
    if (salary?.breakdown.is_metro !== undefined) {
      setDecl((d) => ({ ...d, is_metro: salary.breakdown.is_metro }));
    }
  }, [salary?.breakdown.is_metro]);

  // ── Auto-populate EPF from salary (12% of basic annually) ─────────────────
  useEffect(() => {
    if (basicM > 0) {
      const epfAnnual = Math.round(basicM * 12 * 0.12);
      setDecl((d) => (d.epf === 0 ? { ...d, epf: epfAnnual } : d));
    }
  }, [basicM]);

  // ── Load saved declarations when available ────────────────────────────────
  useEffect(() => {
    if (declQ.data?.has_declaration && declQ.data.declaration_json) {
      const dj = declQ.data.declaration_json as Record<string, any>;
      const sec80c = (dj.sec_80c || {}) as Record<string, number>;
      const sec80d = (dj.sec_80d || {}) as Record<string, number>;
      const hra = (dj.hra || {}) as Record<string, any>;
      const other = (dj.other || {}) as Record<string, number>;
      const donations = (dj.donations_80g || {}) as Record<string, number>;

      setDecl((d) => ({
        ...d,
        regime: (dj.regime_preference || "AUTO") as "OLD" | "NEW" | "AUTO",
        epf: sec80c.epf ?? d.epf ?? 0,
        ppf: sec80c.ppf ?? 0,
        elss: sec80c.elss ?? 0,
        lic: sec80c.lic ?? 0,
        nsc: sec80c.nsc ?? 0,
        taxSaverFD: sec80c.tax_saver_fd ?? 0,
        homeLoanPrincipal: sec80c.home_loan_principal ?? 0,
        nps80ccd: dj.nps_80ccd_1b ?? 0,
        mediclaim_self: sec80d.self ?? 0,
        mediclaim_parents: sec80d.parents ?? 0,
        parents_senior: sec80d.parents_senior ?? false,
        rent_monthly: hra.rent_monthly ?? 0,
        is_metro: hra.is_metro ?? d.is_metro,
        landlord_pan: hra.landlord_pan ?? "",
        homeLoanInterest: dj.home_loan_24b ?? 0,
        eduLoanInterest: dj.edu_loan_80e ?? 0,
        donations100: donations.donations100 ?? 0,
        donations50: donations.donations50 ?? 0,
        lta: other.lta ?? 0,
        professional_tax: other.professional_tax ?? 0,
      }));
    }
  }, [declQ.data]);

  // ── Live tax computation (both regimes) ───────────────────────────────────
  const oldTax = useMemo(
    () => annualGross > 0 ? computeTax(annualGross, basicM, hraM, decl, "OLD", remaining) : null,
    [annualGross, basicM, hraM, decl, remaining],
  );
  const newTax = useMemo(
    () => annualGross > 0 ? computeTax(annualGross, basicM, hraM, decl, "NEW", remaining) : null,
    [annualGross, basicM, hraM, decl, remaining],
  );

  const recommended = useMemo(() => {
    if (!oldTax || !newTax) return "NEW";
    return oldTax.annualTax <= newTax.annualTax ? "OLD" : "NEW";
  }, [oldTax, newTax]);

  const effectiveRegime = decl.regime === "AUTO" ? recommended : decl.regime;
  const activeTax = effectiveRegime === "OLD" ? oldTax : newTax;

  const savings = oldTax && newTax ? Math.abs(oldTax.annualTax - newTax.annualTax) : 0;

  // ── Backend calc (latest cycle) ───────────────────────────────────────────
  const latestCycle = cyclesQ.data?.find((c) => c.status !== "DRAFT");
  const backendCalcQ = useQuery({
    queryKey: qk.tdsCalc(latestCycle?.id ?? "", selectedEmpId),
    queryFn: () => tdsApi.getCalculation(latestCycle!.id, selectedEmpId),
    enabled: !!latestCycle && !!selectedEmpId,
    retry: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const submitMut = useMutation({
    mutationFn: () => tdsApi.submitDeclarationV2({
      employee_id: selectedEmpId,
      tax_year: "2025-26",
      payload: {
        regime_preference: decl.regime,
        sec_80c: {
          epf: decl.epf, ppf: decl.ppf, elss: decl.elss,
          lic: decl.lic, nsc: decl.nsc, tax_saver_fd: decl.taxSaverFD,
          home_loan_principal: decl.homeLoanPrincipal,
        },
        nps_80ccd_1b: decl.nps80ccd,
        sec_80d: { self: decl.mediclaim_self, parents: decl.mediclaim_parents, parents_senior: decl.parents_senior },
        hra: { rent_monthly: decl.rent_monthly, is_metro: decl.is_metro, landlord_pan: decl.landlord_pan },
        home_loan_24b: decl.homeLoanInterest,
        edu_loan_80e: decl.eduLoanInterest,
        donations_80g: { donations100: decl.donations100, donations50: decl.donations50 },
        other: { lta: decl.lta, professional_tax: decl.professional_tax },
      },
      change_reason: "Employee self-service declaration",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.audit({}) });
      qc.invalidateQueries({ queryKey: qk.tdsDeclarations(selectedEmpId) });
      qc.invalidateQueries({ queryKey: qk.tdsOverview(selectedEmpId) });
      toastService.success("Declaration submitted successfully.");
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  // ── Employee selector data ────────────────────────────────────────────────
  const employees = employeesQ.data?.items ?? [];
  const filteredEmps = useMemo(() => {
    const q = empSearch.toLowerCase();
    return employees.filter((e) =>
      !q || e.emp_code.toLowerCase().includes(q) ||
      `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
      (e.designation ?? "").toLowerCase().includes(q),
    );
  }, [employees, empSearch]);

  const selectedEmployee = useMemo(
    () => (empOnly ? myEmpQ.data : employees.find((e) => e.id === selectedEmpId)) ?? null,
    [empOnly, myEmpQ.data, employees, selectedEmpId],
  );

  // ── Alerts & insights ─────────────────────────────────────────────────────
  const alerts = useMemo(() => {
    if (!activeTax || !annualGross) return [];
    const items: { type: "warning" | "info" | "success" | "danger"; msg: string }[] = [];

    const c80C = Math.min(
      (decl.epf||0)+(decl.ppf||0)+(decl.elss||0)+(decl.lic||0)+(decl.nsc||0)+(decl.taxSaverFD||0)+(decl.homeLoanPrincipal||0),
      150_000,
    );
    if (effectiveRegime === "OLD") {
      if (c80C < 150_000) items.push({ type: "warning", msg: `₹${(150_000 - c80C).toLocaleString("en-IN")} in 80C limit unused — invest in PPF, ELSS, or LIC to reduce tax.` });
      if (!decl.rent_monthly) items.push({ type: "info", msg: "HRA exemption not declared. If you pay rent, add your monthly rent to save tax." });
      if (!decl.mediclaim_self) items.push({ type: "warning", msg: "80D medical insurance not declared. Self cover gives up to ₹25,000 deduction." });
    }
    if (savings > 0) {
      const better = recommended === "OLD" ? "Old" : "New";
      items.push({ type: "success", msg: `${better} Regime saves ₹${savings.toLocaleString("en-IN")} annually vs the other regime.` });
    }
    if (decl.regime !== "AUTO" && decl.regime !== recommended) {
      items.push({ type: "danger", msg: `You selected ${decl.regime === "OLD" ? "Old" : "New"} Regime but the ${recommended === "OLD" ? "Old" : "New"} Regime is more beneficial by ${fmtL(savings)}.` });
    }
    if (activeTax.effectiveRate > 20) items.push({ type: "info", msg: `Effective tax rate is ${activeTax.effectiveRate.toFixed(1)}%. Consider maximising all deductions.` });

    return items;
  }, [activeTax, decl, effectiveRegime, recommended, savings, annualGross]);

  // ── Monthly TDS timeline data ─────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    if (!activeTax || !annualGross) return [];
    const monthlyGross = annualGross / 12;
    return FY_MONTHS.map((name, idx) => ({
      name,
      salary: Math.round(monthlyGross),
      tds: Math.round(activeTax.monthlyTDS),
      isPast: idx < fyMonthIdx,
      isCurrent: idx === fyMonthIdx,
    }));
  }, [activeTax, annualGross, fyMonthIdx]);

  // ── 80C total & savings ───────────────────────────────────────────────────
  const sec80CTaxSaved = useMemo(() => {
    if (!oldTax || !newTax) return 0;
    const baseNewTax = newTax.annualTax;
    const c80CSum = (decl.epf||0)+(decl.ppf||0)+(decl.elss||0)+(decl.lic||0)+(decl.nsc||0)+(decl.taxSaverFD||0)+(decl.homeLoanPrincipal||0);
    if (c80CSum <= 0) return 0;
    const hypothetical = computeTax(annualGross, basicM, hraM, { ...decl, epf: 0, ppf: 0, elss: 0, lic: 0, nsc: 0, taxSaverFD: 0, homeLoanPrincipal: 0 }, "OLD", remaining);
    return Math.max(0, hypothetical.annualTax - (oldTax?.annualTax ?? baseNewTax));
  }, [oldTax, newTax, decl, annualGross, basicM, hraM, remaining]);

  const hraExempt = computeHRAExempt(basicM, hraM, decl.rent_monthly, decl.is_metro);

  // ── Waterfall data ────────────────────────────────────────────────────────
  const waterfallRows = useMemo(() => {
    if (!activeTax) return [];
    const rows: { label: string; value: number; type: "income" | "minus" | "equals" | "tax" | "final" }[] = [
      { label: "Annual Gross Income", value: activeTax.annualGross, type: "income" },
      ...activeTax.exemptions.map((e) => ({ label: e.label, value: e.amount, type: "minus" as const })),
      ...activeTax.deductions.map((d) => ({ label: d.label, value: d.amount, type: "minus" as const })),
      { label: "Taxable Income", value: activeTax.taxableIncome, type: "equals" },
      { label: `Slab Tax (${effectiveRegime} Regime)`, value: activeTax.taxBeforeRebate, type: "tax" },
      ...(activeTax.rebate > 0 ? [{ label: "Rebate u/s 87A", value: activeTax.rebate, type: "minus" as const }] : []),
      { label: "Health & Education Cess (4%)", value: activeTax.cess, type: "tax" },
      { label: "Final Annual Tax", value: activeTax.annualTax, type: "final" },
      { label: `Monthly TDS (÷ ${remaining} months)`, value: activeTax.monthlyTDS, type: "final" },
    ];
    return rows;
  }, [activeTax, effectiveRegime, remaining]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Intelligence Center"
        subtitle="Tax planning, projections, regime comparison, and TDS computation"
      >
        {isHR && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)] font-medium">FY 2025-26</span>
            <div className="h-4 w-px bg-[var(--glass-border)]" />
            <span className="text-xs text-[var(--text-muted)]">{remaining} months remaining</span>
          </div>
        )}
      </PageHeader>

      {/* ── Employee Selector ────────────────────────────────────────────── */}
      {isHR && (
        <div ref={dropRef} className="relative max-w-md">
          <div
            onClick={() => setShowEmpDrop(true)}
            className="flex items-center gap-3 cursor-pointer rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card-bg)] backdrop-blur-sm px-4 py-3 hover:border-[var(--accent)]/40 transition-colors"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] flex-shrink-0">
              {selectedEmployee ? (
                <span className="text-sm font-bold text-[var(--accent)]">
                  {selectedEmployee.first_name[0]}{selectedEmployee.last_name[0]}
                </span>
              ) : (
                <Users className="h-5 w-5 text-[var(--accent)]" />
              )}
            </div>
            {selectedEmployee ? (
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-[var(--text-primary)]">
                  {selectedEmployee.first_name} {selectedEmployee.last_name}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {selectedEmployee.emp_code} · {selectedEmployee.designation ?? "—"}
                </div>
              </div>
            ) : (
              <div className="flex-1 text-sm text-[var(--text-muted)]">Search employee by name or code…</div>
            )}
            <Search className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
          </div>

          <AnimatePresence>
            {showEmpDrop && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full mt-2 left-0 right-0 z-50 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-panel-bg)] backdrop-blur-xl shadow-2xl overflow-hidden"
              >
                <div className="p-3 border-b border-[var(--glass-border)]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <input
                      autoFocus
                      placeholder="Search by name, code, or designation…"
                      value={empSearch}
                      onChange={(e) => setEmpSearch(e.target.value)}
                      className="input pl-8 text-sm py-2"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {filteredEmps.slice(0, 20).map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => {
                        setSelectedEmpId(emp.id);
                        setShowEmpDrop(false);
                        setEmpSearch("");
                        setDecl(EMPTY_DECL);
                      }}
                      className={clsx(
                        "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--accent-soft)] transition-colors",
                        emp.id === selectedEmpId && "bg-[var(--accent-soft)]",
                      )}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--glass-border)] flex-shrink-0">
                        <span className="text-xs font-bold text-[var(--accent)]">
                          {emp.first_name[0]}{emp.last_name[0]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {emp.first_name} {emp.last_name}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] truncate">
                          {emp.emp_code} · {emp.designation ?? "No designation"}
                        </div>
                      </div>
                      {emp.id === selectedEmpId && <CheckCircle2 className="h-4 w-4 text-[var(--accent)] flex-shrink-0" />}
                    </button>
                  ))}
                  {filteredEmps.length === 0 && (
                    <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No employees found.</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {!selectedEmployee && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-card-bg)] py-20 gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
            <Receipt className="h-8 w-8 text-[var(--accent)]" />
          </div>
          <div className="text-center">
            <div className="font-display font-semibold text-lg text-[var(--text-primary)]">Tax Intelligence Center</div>
            <div className="text-sm text-[var(--text-muted)] mt-1 max-w-xs">
              {isHR ? "Select an employee to view tax projections, regime comparison, and declaration center." : "Loading your employee record…"}
            </div>
          </div>
        </div>
      )}

      {/* ── Main content (employee selected) ────────────────────────────── */}
      {selectedEmployee && (
        <>
          {salaryQ.isError && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              No salary structure found for this employee. Please set up salary first.
            </div>
          )}

          {/* ── KPI Summary Row ─────────────────────────────────────────── */}
          {activeTax && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KPICard
                icon={Wallet}
                label="Projected Annual Income"
                value={<AnimatedINR value={activeTax.annualGross} />}
                tooltip="Total annual cost-to-company used as the basis for TDS projection."
                accent="#3B82F6"
              />
              <KPICard
                icon={Receipt}
                label="Projected Tax Liability"
                value={<AnimatedINR value={activeTax.annualTax} />}
                tooltip="Estimated annual income tax including cess, for the active regime."
                accent="#EF4444"
                trend="neutral"
              />
              <KPICard
                icon={TrendingDown}
                label="Total Deductions"
                value={<AnimatedINR value={activeTax.totalDeductions + activeTax.totalExemptions} />}
                tooltip="Sum of all exemptions (HRA, LTA) and deductions (80C, 80D, etc.) applied."
                accent="#10B981"
              />
              <KPICard
                icon={IndianRupee}
                label="Monthly TDS"
                value={<AnimatedINR value={activeTax.monthlyTDS} />}
                sub={`${remaining} months remaining`}
                tooltip="Tax deducted per month from salary, spread over remaining payroll months."
                accent="#8B5CF6"
              />
              <KPICard
                icon={Percent}
                label="Effective Tax Rate"
                value={<AnimatedPct value={activeTax.effectiveRate} />}
                tooltip="Final tax as a percentage of gross annual income."
                accent="#F59E0B"
                trend={activeTax.effectiveRate > 20 ? "up" : "down"}
                trendLabel={activeTax.effectiveRate > 20 ? "High — review deductions" : "Within normal range"}
              />
              <KPICard
                icon={Award}
                label="Recommended Regime"
                value={<span className={clsx("text-sm font-bold", recommended === "OLD" ? "text-indigo-500" : "text-violet-500")}>{recommended === "OLD" ? "Old Regime" : "New Regime"}</span>}
                sub={savings > 0 ? `Saves ${fmtL(savings)}` : "Both similar"}
                tooltip="The tax regime that results in lower total tax liability for this employee."
                accent={recommended === "OLD" ? "#6366F1" : "#8B5CF6"}
              />
            </div>
          )}

          {salaryQ.isLoading && !activeTax && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton h-28 rounded-2xl" />
              ))}
            </div>
          )}

          {/* ── Tabs ────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-1 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-card-bg)] p-1 w-fit">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={clsx(
                  "relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === id
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                )}
              >
                {activeTab === id && (
                  <motion.div
                    layoutId="tds-active-tab"
                    className="absolute inset-0 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/20"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className="relative h-3.5 w-3.5" />
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>

          {/* ── Tab Content ──────────────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {/* ════ OVERVIEW TAB ════════════════════════════════════════ */}
              {activeTab === "overview" && activeTax && (
                <div className="space-y-6">
                  {/* Regime Comparison */}
                  {oldTax && newTax && (
                    <div className="card-glass p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <Scale className="h-4 w-4 text-[var(--accent)]" />
                        <h3 className="font-display font-semibold text-[var(--text-primary)]">Regime Comparison Engine</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        <RegimeCard
                          regime="OLD"
                          result={oldTax}
                          isBetter={recommended === "OLD"}
                          savings={recommended === "OLD" ? savings : -savings}
                          isActive={effectiveRegime === "OLD"}
                          onSelect={() => setDecl((d) => ({ ...d, regime: "OLD" }))}
                        />
                        <RegimeCard
                          regime="NEW"
                          result={newTax}
                          isBetter={recommended === "NEW"}
                          savings={recommended === "NEW" ? savings : -savings}
                          isActive={effectiveRegime === "NEW"}
                          onSelect={() => setDecl((d) => ({ ...d, regime: "NEW" }))}
                        />
                      </div>
                      <button
                        onClick={() => setDecl((d) => ({ ...d, regime: "AUTO" }))}
                        className={clsx(
                          "w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2",
                          decl.regime === "AUTO"
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                            : "border-[var(--glass-border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                        )}
                      >
                        <Zap className="h-3.5 w-3.5" />
                        Auto-Select (recommended: {recommended} Regime)
                      </button>
                      {savings > 0 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className={clsx(
                            "mt-3 rounded-xl px-4 py-3 text-sm font-medium text-center",
                            "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/30",
                          )}
                        >
                          You save {formatINR(savings)} annually with the{" "}
                          <strong>{recommended === "OLD" ? "Old" : "New"} Regime</strong>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* Income Decomposition */}
                  <div className="card-glass p-5">
                    <div className="flex items-center gap-2 mb-5">
                      <PiggyBank className="h-4 w-4 text-[var(--accent)]" />
                      <h3 className="font-display font-semibold text-[var(--text-primary)]">Tax Overview</h3>
                      <span className="ml-auto text-xs text-[var(--text-muted)]">{effectiveRegime} Regime</span>
                    </div>
                    <div className="space-y-3">
                      {[
                        { label: "Annual Gross Income (CTC)", value: activeTax.annualGross, pct: 100, color: "bg-blue-500" },
                        ...(activeTax.totalExemptions > 0
                          ? [{ label: "Less: Total Exemptions", value: -activeTax.totalExemptions, pct: (activeTax.totalExemptions / activeTax.annualGross) * 100, color: "bg-emerald-500" }]
                          : []),
                        { label: "Less: Total Deductions", value: -activeTax.totalDeductions, pct: (activeTax.totalDeductions / activeTax.annualGross) * 100, color: "bg-violet-500" },
                        { label: "Net Taxable Income", value: activeTax.taxableIncome, pct: (activeTax.taxableIncome / activeTax.annualGross) * 100, color: "bg-amber-500" },
                        { label: "Annual Tax Liability", value: activeTax.annualTax, pct: (activeTax.annualTax / activeTax.annualGross) * 100, color: "bg-red-500" },
                      ].map(({ label, value, pct, color }) => (
                        <div key={label} className="flex items-center gap-3">
                          <div className="w-40 shrink-0 text-xs text-[var(--text-secondary)]">{label}</div>
                          <div className="flex-1 h-5 bg-[var(--glass-border)] rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${Math.max(1, Math.min(100, pct))}%` }}
                              transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.05 }}
                              className={clsx("h-full rounded-full", color)}
                            />
                          </div>
                          <div className={clsx("w-28 text-right font-numeric text-xs font-semibold shrink-0", value < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--text-primary)]")}>
                            {value < 0 ? "−" : ""}{formatINR(Math.abs(value))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Alerts */}
                  {alerts.length > 0 && (
                    <div className="card-glass p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <Zap className="h-4 w-4 text-amber-500" />
                        <h3 className="font-display font-semibold text-[var(--text-primary)]">Alerts & Insights</h3>
                      </div>
                      <div className="space-y-2">
                        {alerts.map(({ type, msg }, i) => (
                          <AlertBadge key={i} type={type} message={msg} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payroll integration */}
                  {backendCalcQ.data && (
                    <div className="card-glass p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <Calendar className="h-4 w-4 text-[var(--accent)]" />
                        <h3 className="font-display font-semibold text-[var(--text-primary)]">Latest Payroll Cycle Calculation</h3>
                        <span className="ml-auto text-xs text-[var(--text-muted)]">{latestCycle?.name}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Taxable Income", value: backendCalcQ.data.taxable_income },
                          { label: "Annual Tax", value: backendCalcQ.data.annual_tax },
                          { label: "Remaining Tax", value: backendCalcQ.data.remaining_tax },
                          { label: "Monthly TDS", value: backendCalcQ.data.monthly_tds },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-xl bg-[var(--glass-card-bg)] border border-[var(--glass-border)] p-3 text-center">
                            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
                            <div className="font-numeric font-bold text-sm text-[var(--text-primary)] mt-1">{formatINR(parseFloat(value))}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <ShieldCheck className="h-3 w-3" />
                        Regime: <strong className="text-[var(--text-secondary)]">{backendCalcQ.data.regime_applied}</strong>
                        · Law: <strong className="text-[var(--text-secondary)]">{backendCalcQ.data.law_version}</strong>
                        · Hash: <code className="font-mono text-[10px]">{backendCalcQ.data.trace_hash.slice(0, 12)}…</code>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ════ DECLARATIONS TAB ════════════════════════════════════ */}
              {activeTab === "declarations" && (
                <div className="space-y-3">
                  {/* Regime selector */}
                  <div className="card-glass p-4 flex items-center gap-4 flex-wrap">
                    <span className="text-sm font-medium text-[var(--text-secondary)]">Regime Preference:</span>
                    {(["AUTO", "OLD", "NEW"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setDecl((d) => ({ ...d, regime: r }))}
                        className={clsx(
                          "rounded-full px-4 py-1.5 text-xs font-semibold border transition-all",
                          decl.regime === r
                            ? "bg-[var(--accent)] border-[var(--accent)] text-white shadow-btn"
                            : "border-[var(--glass-border)] text-[var(--text-muted)] hover:border-[var(--accent)]/40",
                        )}
                      >
                        {r === "AUTO" ? "Auto (Recommended)" : r === "OLD" ? "Old Regime" : "New Regime"}
                      </button>
                    ))}
                  </div>

                  {effectiveRegime === "NEW" && (
                    <div className="rounded-2xl border border-blue-200 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
                      <Info className="h-4 w-4 flex-shrink-0" />
                      New Regime: Standard deduction of ₹75,000 applied automatically. Chapter VI-A deductions (80C, 80D, etc.) are not available.
                    </div>
                  )}

                  {/* 80C Investments */}
                  <AccordionSection
                    icon={PiggyBank}
                    title="Section 80C Investments"
                    badge="Limit: ₹1,50,000"
                    taxSaved={effectiveRegime === "OLD" ? sec80CTaxSaved : 0}
                    isOpen={openSection === "80C"}
                    onToggle={() => setOpenSection(openSection === "80C" ? null : "80C")}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <DeclInput label="Employee PF (EPF)" value={decl.epf} onChange={(v) => setDecl((d) => ({ ...d, epf: v }))} max={150000} section="80C" hint="Auto-deducted from salary" />
                      <DeclInput label="Public Provident Fund (PPF)" value={decl.ppf} onChange={(v) => setDecl((d) => ({ ...d, ppf: v }))} max={150000} section="80C" />
                      <DeclInput label="ELSS Mutual Funds" value={decl.elss} onChange={(v) => setDecl((d) => ({ ...d, elss: v }))} max={150000} section="80C" hint="3-year lock-in" />
                      <DeclInput label="LIC Premium" value={decl.lic} onChange={(v) => setDecl((d) => ({ ...d, lic: v }))} max={150000} section="80C" />
                      <DeclInput label="NSC (National Savings Certificate)" value={decl.nsc} onChange={(v) => setDecl((d) => ({ ...d, nsc: v }))} max={150000} section="80C" />
                      <DeclInput label="5-Year Tax Saver FD" value={decl.taxSaverFD} onChange={(v) => setDecl((d) => ({ ...d, taxSaverFD: v }))} max={150000} section="80C" />
                      <DeclInput label="Home Loan Principal Repayment" value={decl.homeLoanPrincipal} onChange={(v) => setDecl((d) => ({ ...d, homeLoanPrincipal: v }))} max={150000} section="80C" />
                    </div>
                    {effectiveRegime === "OLD" && (
                      <div className="mt-3 rounded-xl bg-[var(--glass-card-bg)] border border-[var(--glass-border)] p-3">
                        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-2">
                          <span>Total 80C utilised</span>
                          <span className="font-numeric font-semibold text-[var(--text-primary)]">
                            {fmtL(Math.min((decl.epf||0)+(decl.ppf||0)+(decl.elss||0)+(decl.lic||0)+(decl.nsc||0)+(decl.taxSaverFD||0)+(decl.homeLoanPrincipal||0), 150000))} / ₹1,50,000
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--glass-border)] overflow-hidden">
                          <motion.div
                            animate={{
                              width: `${Math.min(100, ((decl.epf||0)+(decl.ppf||0)+(decl.elss||0)+(decl.lic||0)+(decl.nsc||0)+(decl.taxSaverFD||0)+(decl.homeLoanPrincipal||0)) / 150000 * 100)}%`
                            }}
                            transition={{ type: "spring", stiffness: 200, damping: 25 }}
                            className="h-full rounded-full bg-[var(--accent)]"
                          />
                        </div>
                      </div>
                    )}
                  </AccordionSection>

                  {/* 80CCD(1B) NPS */}
                  <AccordionSection
                    icon={ShieldCheck}
                    title="80CCD(1B) — NPS Additional Contribution"
                    badge="Additional ₹50,000 over 80C limit"
                    isOpen={openSection === "NPS"}
                    onToggle={() => setOpenSection(openSection === "NPS" ? null : "NPS")}
                  >
                    <DeclInput label="NPS Contribution (additional)" value={decl.nps80ccd} onChange={(v) => setDecl((d) => ({ ...d, nps80ccd: v }))} max={50000} section="80CCD(1B)" hint="Over and above 80C limit of ₹1.5L" />
                  </AccordionSection>

                  {/* 80D Medical */}
                  <AccordionSection
                    icon={Heart}
                    title="Section 80D — Medical Insurance"
                    badge="Self: ₹25,000 · Parents: ₹25,000/₹50,000"
                    isOpen={openSection === "80D"}
                    onToggle={() => setOpenSection(openSection === "80D" ? null : "80D")}
                  >
                    <DeclInput label="Medical Insurance (Self, Spouse, Children)" value={decl.mediclaim_self} onChange={(v) => setDecl((d) => ({ ...d, mediclaim_self: v }))} max={25000} section="80D" />
                    <DeclInput label="Medical Insurance (Parents)" value={decl.mediclaim_parents} onChange={(v) => setDecl((d) => ({ ...d, mediclaim_parents: v }))} max={decl.parents_senior ? 50000 : 25000} section="80D" />
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        id="parents-senior"
                        checked={decl.parents_senior}
                        onChange={(e) => setDecl((d) => ({ ...d, parents_senior: e.target.checked }))}
                        className="h-4 w-4 rounded border-[var(--glass-border)] accent-[var(--accent)]"
                      />
                      <label htmlFor="parents-senior" className="text-xs text-[var(--text-secondary)] cursor-pointer">
                        Parents are Senior Citizens (60+) — limit increases to ₹50,000
                      </label>
                    </div>
                  </AccordionSection>

                  {/* HRA */}
                  <AccordionSection
                    icon={Home}
                    title="HRA — House Rent Allowance Exemption"
                    badge={hraExempt > 0 ? `Exempt: ${fmtL(hraExempt)}` : "Enter rent details to calculate exemption"}
                    isOpen={openSection === "HRA"}
                    onToggle={() => setOpenSection(openSection === "HRA" ? null : "HRA")}
                  >
                    <DeclInput
                      label="Monthly Rent Paid (₹/month)"
                      value={decl.rent_monthly}
                      onChange={(v) => setDecl((d) => ({ ...d, rent_monthly: v }))}
                      hint="Enter the monthly rent. HRA exemption = Min(HRA received, Rent−10% of Basic, 50%/40% of Basic)"
                    />
                    <div>
                      <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Landlord PAN (required if rent &gt; ₹1L/year)</label>
                      <input
                        type="text"
                        placeholder="ABCDE1234F"
                        maxLength={10}
                        value={decl.landlord_pan}
                        onChange={(e) => setDecl((d) => ({ ...d, landlord_pan: e.target.value.toUpperCase() }))}
                        className="input text-sm font-mono uppercase"
                      />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        id="metro-city"
                        checked={decl.is_metro}
                        onChange={(e) => setDecl((d) => ({ ...d, is_metro: e.target.checked }))}
                        className="h-4 w-4 rounded border-[var(--glass-border)] accent-[var(--accent)]"
                      />
                      <label htmlFor="metro-city" className="text-xs text-[var(--text-secondary)] cursor-pointer">
                        Metro city (Mumbai, Delhi, Kolkata, Chennai) — HRA exemption = 50% of Basic
                      </label>
                    </div>
                    {decl.rent_monthly > 0 && hraM > 0 && (
                      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 px-4 py-3 text-sm">
                        <div className="text-emerald-700 dark:text-emerald-300 font-semibold">HRA Exemption: {formatINR(hraExempt)}</div>
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          Min({fmtL(hraM * 12)} HRA received, {fmtL(Math.max(0, decl.rent_monthly * 12 - 0.1 * basicM * 12))} rent−10% basic, {fmtL(basicM * 12 * (decl.is_metro ? 0.5 : 0.4))} {decl.is_metro ? "50" : "40"}% basic)
                        </div>
                      </div>
                    )}
                  </AccordionSection>

                  {/* Home Loan */}
                  <AccordionSection
                    icon={Home}
                    title="Home Loan — Section 24B"
                    badge="Interest deduction limit: ₹2,00,000"
                    isOpen={openSection === "HomeLoan"}
                    onToggle={() => setOpenSection(openSection === "HomeLoan" ? null : "HomeLoan")}
                  >
                    <DeclInput label="Annual Interest Paid (24B)" value={decl.homeLoanInterest} onChange={(v) => setDecl((d) => ({ ...d, homeLoanInterest: v }))} max={200000} section="24(b)" hint="Deduction on interest paid on home loan for self-occupied property" />
                    <div className="text-xs text-[var(--text-muted)] bg-[var(--glass-card-bg)] rounded-xl p-3">
                      Principal repayment (₹{(decl.homeLoanPrincipal||0).toLocaleString("en-IN")}) is declared under 80C above.
                    </div>
                  </AccordionSection>

                  {/* 80E Education Loan */}
                  <AccordionSection
                    icon={GraduationCap}
                    title="Section 80E — Education Loan Interest"
                    badge="No upper limit · Paid from taxable income"
                    isOpen={openSection === "80E"}
                    onToggle={() => setOpenSection(openSection === "80E" ? null : "80E")}
                  >
                    <DeclInput label="Annual Education Loan Interest Paid" value={decl.eduLoanInterest} onChange={(v) => setDecl((d) => ({ ...d, eduLoanInterest: v }))} section="80E" hint="Deduction for 8 consecutive years from start of repayment" />
                  </AccordionSection>

                  {/* 80G Donations */}
                  <AccordionSection
                    icon={Gift}
                    title="Section 80G — Donations"
                    badge="100% or 50% deduction based on institution"
                    isOpen={openSection === "80G"}
                    onToggle={() => setOpenSection(openSection === "80G" ? null : "80G")}
                  >
                    <DeclInput label="Donations — 100% Deduction Eligible" value={decl.donations100} onChange={(v) => setDecl((d) => ({ ...d, donations100: v }))} section="80G" hint="PM Relief Fund, National Defence Fund, etc." />
                    <DeclInput label="Donations — 50% Deduction Eligible" value={decl.donations50} onChange={(v) => setDecl((d) => ({ ...d, donations50: v }))} section="80G" hint="50% of this amount will be allowed as deduction" />
                  </AccordionSection>

                  {/* Other */}
                  <AccordionSection
                    icon={ArrowRight}
                    title="Other Exemptions"
                    badge="LTA, Professional Tax"
                    isOpen={openSection === "Other"}
                    onToggle={() => setOpenSection(openSection === "Other" ? null : "Other")}
                  >
                    <DeclInput label="LTA — Leave Travel Allowance" value={decl.lta} onChange={(v) => setDecl((d) => ({ ...d, lta: v }))} section="10(5)" hint="Actual travel cost for domestic travel with family" />
                    <DeclInput label="Professional Tax" value={decl.professional_tax} onChange={(v) => setDecl((d) => ({ ...d, professional_tax: v }))} max={2500} section="16(iii)" hint="State-levied professional tax, max ₹2,500/year" />
                  </AccordionSection>

                  {/* Live savings summary */}
                  {oldTax && effectiveRegime === "OLD" && (
                    <div className="card-glass p-4 flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Live Tax Savings (declarations applied)</div>
                        <div className="text-lg font-display font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 font-numeric">
                          {formatINR(Math.max(0, (annualGross > 0 ? computeTax(annualGross, basicM, hraM, EMPTY_DECL, "OLD", remaining) : { annualTax: 0 }).annualTax - oldTax.annualTax))}
                          <span className="text-sm font-normal ml-1 text-[var(--text-muted)]">saved vs zero declarations</span>
                        </div>
                      </div>
                      <button
                        onClick={() => submitMut.mutate()}
                        disabled={submitMut.isPending || !selectedEmpId}
                        className="btn flex items-center gap-2 shrink-0"
                      >
                        {submitMut.isPending ? (
                          <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Submitting…</>
                        ) : (
                          <><FileText className="h-4 w-4" /> Submit Declaration</>
                        )}
                      </button>
                    </div>
                  )}
                  {effectiveRegime === "NEW" && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => submitMut.mutate()}
                        disabled={submitMut.isPending || !selectedEmpId}
                        className="btn flex items-center gap-2"
                      >
                        {submitMut.isPending ? (
                          <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Submitting…</>
                        ) : (
                          <><FileText className="h-4 w-4" /> Submit Regime Preference</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ════ TAX TRACE TAB ═══════════════════════════════════════ */}
              {activeTab === "trace" && activeTax && (
                <div className="space-y-6">
                  {/* Calculation trace */}
                  <div className="card-glass p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Zap className="h-4 w-4 text-[var(--accent)]" />
                      <h3 className="font-display font-semibold text-[var(--text-primary)]">
                        TDS Calculation Trace — {effectiveRegime} Regime
                      </h3>
                    </div>
                    <div>
                      <TraceStep label="Annual Gross Income (CTC)" value={activeTax.annualGross} type="income" section="Salary" />
                      {activeTax.exemptions.map((e) => (
                        <TraceStep key={e.label} label={e.label} value={e.amount} type="minus" section={e.section} />
                      ))}
                      {activeTax.deductions.map((d) => (
                        <TraceStep key={d.label} label={d.label} value={d.amount} type="minus" section={d.section} />
                      ))}
                      <TraceStep label="Net Taxable Income" value={activeTax.taxableIncome} type="equals" />
                      <TraceStep label={`Slab Tax (${effectiveRegime} Regime)`} value={activeTax.taxBeforeRebate} type="tax" />
                      {activeTax.rebate > 0 && (
                        <TraceStep label="Rebate under Section 87A" value={activeTax.rebate} type="minus" section="87A" note={`Taxable income ≤ ${effectiveRegime === "NEW" ? "₹7,00,000" : "₹5,00,000"}`} />
                      )}
                      <TraceStep label="Health & Education Cess (4%)" value={activeTax.cess} type="tax" section="2(14A)" />
                      <TraceStep label="Total Annual Tax Payable" value={activeTax.annualTax} type="final" isLast={false} />
                      <TraceStep
                        label={`Monthly TDS (÷ ${remaining} remaining months)`}
                        value={activeTax.monthlyTDS}
                        type="final"
                        note="Remaining tax spread over remaining payroll months of FY"
                        isLast
                      />
                    </div>
                  </div>

                  {/* Slab breakdown */}
                  <div className="card-glass p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Scale className="h-4 w-4 text-[var(--accent)]" />
                      <h3 className="font-display font-semibold text-[var(--text-primary)]">
                        Tax Slab Breakdown — Taxable Income {formatINR(activeTax.taxableIncome)}
                      </h3>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-[var(--glass-border)]">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[var(--glass-border)] bg-[var(--glass-card-bg)]">
                            <th className="th">Income Range</th>
                            <th className="th text-right">Rate</th>
                            <th className="th text-right">Taxable Portion</th>
                            <th className="th text-right">Tax in Slab</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border-subtle)]">
                          {activeTax.slabs.filter((s) => s.taxable > 0 || s.from === 0).map((s, i) => (
                            <tr key={i} className={clsx("tr-hover", s.tax > 0 && "bg-red-50/30 dark:bg-red-900/10")}>
                              <td className="td text-xs text-[var(--text-secondary)]">
                                {formatINR(s.from)} – {s.to === null ? "∞" : formatINR(s.to)}
                              </td>
                              <td className="td text-right text-xs font-semibold">
                                <span className={clsx("rounded-full px-2 py-0.5",
                                  s.rate === 0 ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                    : s.rate >= 0.3 ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                      : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                                )}>
                                  {(s.rate * 100).toFixed(0)}%
                                </span>
                              </td>
                              <td className="td text-right font-numeric text-xs">{formatINR(s.taxable)}</td>
                              <td className="td text-right font-numeric text-xs font-semibold text-[var(--text-primary)]">{formatINR(s.tax)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-[var(--glass-border)] bg-[var(--glass-card-bg)] font-semibold">
                            <td className="td text-sm" colSpan={3}>Total Slab Tax + 4% Cess</td>
                            <td className="td text-right font-numeric text-sm text-red-600 dark:text-red-400">
                              {formatINR(activeTax.annualTax)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {activeTax.rebate > 0 && (
                      <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Section 87A rebate of {formatINR(activeTax.rebate)} applied (taxable income within threshold)
                      </div>
                    )}
                  </div>

                  {/* Monthly TDS timeline */}
                  {monthlyData.length > 0 && (
                    <div className="card-glass p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <Calendar className="h-4 w-4 text-[var(--accent)]" />
                        <h3 className="font-display font-semibold text-[var(--text-primary)]">Monthly TDS Timeline — FY 2025-26</h3>
                        <span className="ml-auto text-xs text-[var(--text-muted)] font-medium">{FY_MONTHS[fyMonthIdx]} is current month</span>
                      </div>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={monthlyData} barCategoryGap="22%" barGap={2}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={(v) => fmtL(v)} tick={{ fontSize: 10, fill: "var(--chart-axis)" }} tickLine={false} axisLine={false} width={56} />
                          <ReTooltip content={<CustomChartTooltip />} cursor={{ fill: "var(--accent-soft)" }} />
                          <Bar dataKey="tds" name="Monthly TDS" radius={[4, 4, 0, 0]}>
                            {monthlyData.map((entry, i) => (
                              <Cell
                                key={i}
                                fill={entry.isCurrent ? "var(--accent)" : entry.isPast ? "var(--chart-3)" : "var(--chart-1)"}
                                opacity={entry.isPast ? 0.5 : 1}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--accent)]" /> Current month</span>
                        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-1)] opacity-60" /> Remaining months</span>
                        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-3)] opacity-50" /> Past months (projected)</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
