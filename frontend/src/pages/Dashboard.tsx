import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Users,
  TrendingUp,
  DollarSign,
  ShieldCheck,
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Activity,
  Clock,
  CheckCircle2,
} from "lucide-react";

import { employeesApi } from "../api/employees";
import { payrollApi } from "../api/payroll";
import { complianceApi } from "../api/compliance";
import { qk } from "../lib/queryClient";
import { formatINR } from "../lib/money";
import { formatINRShort, formatMonth, relativeTime, currentMonthFirst } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { Spinner, Skeleton } from "../components/Spinner";
import { getNextDeadlines } from "../data/statutory-calendar";
import { useAuth } from "../lib/auth";
import type { PayrollCycle, PayrollResult } from "../types";
import clsx from "clsx";

const DONUT_COLORS = ["#6366F1", "#8B5CF6", "#10B981", "#F59E0B", "#3B82F6", "#EC4899", "#14B8A6"];

const CARD_ANIM = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.25 } }),
};

// ── KPI Card ──────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  loading,
  icon: Icon,
  iconColor = "text-accent-600",
  iconBg = "bg-accent-50 dark:bg-accent-900/30",
  danger,
  to,
  index = 0,
}: {
  label: string;
  value?: React.ReactNode;
  sub?: React.ReactNode;
  loading?: boolean;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  danger?: boolean;
  to?: string;
  index?: number;
}) {
  const inner = (
    <motion.div
      custom={index}
      variants={CARD_ANIM}
      initial="hidden"
      animate="show"
      className={clsx(
        "card flex flex-col gap-3 group",
        to && "cursor-pointer hover:shadow-glass-md hover:-translate-y-0.5 transition-all duration-200",
        danger && "border-danger/30 dark:border-danger/20"
      )}
    >
      <div className="flex items-start justify-between">
        <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", iconBg)}>
          <Icon className={clsx("h-4.5 w-4.5", danger ? "text-danger" : iconColor)} style={{width:18,height:18}} />
        </div>
        {to && (
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400 transition-colors" />
        )}
      </div>
      <div>
        <div className="kpi-label">{label}</div>
        <div className={clsx("kpi-value mt-1", danger && "text-danger")}>
          {loading ? <Skeleton className="h-7 w-28" /> : (value ?? "—")}
        </div>
        {sub && (
          <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {loading ? <Skeleton className="h-3 w-20 mt-1" /> : sub}
          </div>
        )}
      </div>
    </motion.div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

// ── Activity event icons ──────────────────────────────────────────────────
const EVENT_COLORS: Record<string, string> = {
  PAYROLL_RESULT_COMPUTED: "bg-accent-500",
  PAYOUT_BATCH_CREATED: "bg-emerald-500",
  PAYSLIPS_GENERATED: "bg-blue-500",
  PAYROLL_CYCLE_DISBURSED: "bg-emerald-500",
  PII_ACCESSED: "bg-amber-500",
  DEPARTMENT_UPDATED: "bg-violet-500",
  TDS_DECLARATION_SUBMITTED: "bg-blue-500",
  PAYOUT_TRANSACTION_RETRIED: "bg-orange-500",
};

const EVENT_LABELS: Record<string, string> = {
  PAYROLL_RESULT_COMPUTED: "Payroll computed",
  PAYOUT_BATCH_CREATED: "Payout batch created",
  PAYSLIPS_GENERATED: "Payslips generated",
  PAYROLL_CYCLE_DISBURSED: "Cycle disbursed",
  PII_ACCESSED: "PII accessed",
  DEPARTMENT_UPDATED: "Department updated",
  TDS_DECLARATION_SUBMITTED: "TDS declaration submitted",
  PAYOUT_TRANSACTION_RETRIED: "Transaction retried",
};

// ── Custom chart tooltip ──────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 shadow-glass-md">
      <div className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-600 dark:text-slate-400">
            {p.name === "gross" ? "Gross" : "Net"}:
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100 font-numeric">
            {formatINR(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
export function Dashboard() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedPeriod = params.get("period") || currentMonthFirst().slice(0, 7);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const firstName = user?.email?.split("@")[0] ?? "there";

  const empQ = useQuery({
    queryKey: qk.employees({ status: "ACTIVE", page_size: 1 }),
    queryFn: () => employeesApi.list({ status: "ACTIVE", page_size: 1 }),
  });

  const allEmpQ = useQuery({
    queryKey: qk.employees({ page_size: 200, status: "ACTIVE" }),
    queryFn: () => employeesApi.list({ page_size: 200, status: "ACTIVE" }),
  });

  const deptsQ = useQuery({
    queryKey: qk.departments,
    queryFn: () => employeesApi.departments(),
  });

  const cyclesQ = useQuery({
    queryKey: qk.cycles,
    queryFn: () => payrollApi.listCycles(),
  });

  const auditQ = useQuery({
    queryKey: qk.audit({ limit: 10 }),
    queryFn: () => payrollApi.getAudit({ limit: 10 }),
  });

  const cycles = cyclesQ.data ?? [];
  const latestCycle = cycles.find((c) => c.status !== "DRAFT") as PayrollCycle | undefined;
  const recentCycles = cycles.slice(0, 6).reverse();

  const summaryQ = useQuery({
    queryKey: qk.cycleSummary(latestCycle?.id ?? ""),
    queryFn: () => payrollApi.getCycleSummary(latestCycle!.id),
    enabled: !!latestCycle,
  });

  const complianceQ = useQuery({
    queryKey: qk.compliance(latestCycle?.id ?? ""),
    queryFn: () => complianceApi.getSummary(latestCycle!.id),
    enabled: !!latestCycle,
  });

  const trendIds = recentCycles.map((c) => c.id);
  const trendSummaries = useQuery({
    queryKey: ["trend", trendIds.join(",")],
    queryFn: async () => Promise.all(trendIds.map((id) => payrollApi.getCycleSummary(id))),
    enabled: trendIds.length > 0,
  });

  const latestResults = summaryQ.data?.results ?? [];
  const failedResults = latestResults.filter((r) => r.status === "FAILED");

  const netPayout = latestResults
    .filter((r) => r.status !== "FAILED")
    .reduce((s, r) => s + parseFloat(r.net_pay || "0"), 0);

  const statutoryLiability = useMemo(() => {
    const t = complianceQ.data?.totals;
    if (!t) return null;
    return (
      parseFloat(t.total_employee_pf) +
      parseFloat(t.total_employer_pf) +
      parseFloat(t.total_employer_eps) +
      parseFloat(t.total_employee_esi) +
      parseFloat(t.total_employer_esi) +
      parseFloat(t.total_pt)
    );
  }, [complianceQ.data]);

  const totalLOP = latestResults.reduce((s, r) => {
    const lop = parseFloat(r.breakdown_json?.attendance?.lop_days ?? "0");
    return s + lop;
  }, 0);

  const trendData = recentCycles.map((c, i) => ({
    name: formatMonth(c.period_start),
    gross: parseFloat(trendSummaries.data?.[i]?.totals?.gross ?? "0"),
    net: parseFloat(trendSummaries.data?.[i]?.totals?.net ?? "0"),
  }));

  const headcountByDept = useMemo(() => {
    if (!allEmpQ.data || !deptsQ.data) return [];
    const deptMap: Record<string, string> = {};
    deptsQ.data.forEach((d) => (deptMap[d.id] = d.name));
    const counts: Record<string, number> = {};
    allEmpQ.data.items.forEach((e) => {
      const dname = e.department_id ? (deptMap[e.department_id] ?? "Unknown") : "No Dept";
      counts[dname] = (counts[dname] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [allEmpQ.data, deptsQ.data]);

  const deadlines = useMemo(() => getNextDeadlines(3), []);
  const failedCycles = cycles.filter((c) => c.status === "FAILED");
  const openIssues = failedResults.length + failedCycles.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
            {greeting}, {firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Here's your payroll overview for this period
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-500">Period</label>
          <input
            className="input w-36"
            type="month"
            value={selectedPeriod}
            onChange={(e) => setParams({ period: e.target.value })}
          />
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          index={0}
          label="Active Employees"
          value={empQ.data?.total}
          loading={empQ.isLoading}
          icon={Users}
          iconColor="text-accent-600"
          iconBg="bg-accent-50 dark:bg-accent-900/30"
          to="/employees"
        />
        <KpiCard
          index={1}
          label="Latest Cycle"
          value={
            latestCycle ? (
              <span className="text-base font-bold">{latestCycle.name}</span>
            ) : undefined
          }
          sub={latestCycle && <StatusBadge status={latestCycle.status} size="sm" />}
          loading={cyclesQ.isLoading}
          icon={CalendarDays}
          iconColor="text-violet-600"
          iconBg="bg-violet-50 dark:bg-violet-900/30"
          to={latestCycle ? `/cycles/${latestCycle.id}` : "/cycles"}
        />
        <KpiCard
          index={2}
          label="Net Payout"
          value={latestCycle ? formatINR(netPayout) : undefined}
          sub={latestResults.length > 0 && `${latestResults.length} employees`}
          loading={summaryQ.isLoading && !!latestCycle}
          icon={DollarSign}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50 dark:bg-emerald-900/30"
        />
        <KpiCard
          index={3}
          label="Statutory Liability"
          value={statutoryLiability !== null ? formatINR(statutoryLiability) : undefined}
          sub="PF + ESI + PT"
          loading={complianceQ.isLoading && !!latestCycle}
          icon={ShieldCheck}
          iconColor="text-blue-600"
          iconBg="bg-blue-50 dark:bg-blue-900/30"
          to={latestCycle ? `/compliance?cycle=${latestCycle.id}` : undefined}
        />
        <KpiCard
          index={4}
          label="LOP Days"
          value={totalLOP > 0 ? `${totalLOP}d` : "0"}
          sub="Across all employees"
          loading={summaryQ.isLoading && !!latestCycle}
          icon={CalendarDays}
          iconColor="text-amber-600"
          iconBg="bg-amber-50 dark:bg-amber-900/30"
          to="/attendance"
        />
        <KpiCard
          index={5}
          label="Open Issues"
          value={openIssues}
          sub={openIssues > 0 ? "Requires attention" : "All clear"}
          loading={cyclesQ.isLoading || summaryQ.isLoading}
          icon={openIssues > 0 ? AlertTriangle : CheckCircle2}
          iconColor={openIssues > 0 ? "text-danger" : "text-emerald-600"}
          iconBg={
            openIssues > 0
              ? "bg-danger-light dark:bg-danger/10"
              : "bg-emerald-50 dark:bg-emerald-900/30"
          }
          danger={openIssues > 0}
          to="/cycles"
        />
      </div>

      {/* Trend + Headcount */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Trend Chart */}
        <div className="card col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Payroll Trend
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Last 6 cycles — Gross vs Net</p>
            </div>
            <TrendingUp className="h-4 w-4 text-slate-300 dark:text-slate-600" />
          </div>
          {(trendSummaries.isLoading || cyclesQ.isLoading) ? (
            <div className="flex h-52 items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          ) : recentCycles.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-sm text-slate-400">
              No payroll cycles yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="gross-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="net-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366F1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatINRShort} tick={{ fontSize: 11, fill: "#94A3B8" }} width={60} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(v) => (
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>
                      {v === "gross" ? "Gross Earnings" : "Net Payout"}
                    </span>
                  )}
                />
                <Area type="monotone" dataKey="gross" stroke="#8B5CF6" fill="url(#gross-grad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="net" stroke="#6366F1" fill="url(#net-grad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Headcount Donut */}
        <div className="card">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
            Headcount by Dept
          </h2>
          {allEmpQ.isLoading || deptsQ.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          ) : headcountByDept.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">
              No departments yet
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center">
                <PieChart width={140} height={140}>
                  <Pie
                    data={headcountByDept}
                    cx={65}
                    cy={65}
                    innerRadius={42}
                    outerRadius={65}
                    dataKey="value"
                    strokeWidth={2}
                    stroke="transparent"
                  >
                    {headcountByDept.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </div>
              <div className="space-y-1.5">
                {headcountByDept.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      />
                      <span className="text-slate-600 dark:text-slate-400 truncate max-w-[120px]">
                        {d.name}
                      </span>
                    </div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compliance + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Compliance */}
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Statutory Compliance
            </h2>
            {latestCycle && (
              <Link
                to={`/compliance?cycle=${latestCycle.id}`}
                className="text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 flex items-center gap-1"
              >
                View detail <ChevronRight className="h-3 w-3" />
              </Link>
            )}
          </div>
          {complianceQ.isLoading && <Spinner className="h-5 w-5" />}
          {!complianceQ.isLoading && !complianceQ.data && (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              No compliance data — run payroll first.
            </div>
          )}
          {complianceQ.data && (() => {
            const t = complianceQ.data.totals;
            const items = [
              { label: "PF (Employee)", value: parseFloat(t.total_employee_pf), color: "bg-accent-500" },
              {
                label: "PF (Employer)",
                value: parseFloat(t.total_employer_pf) + parseFloat(t.total_employer_eps),
                color: "bg-violet-500",
              },
              { label: "ESI Employee", value: parseFloat(t.total_employee_esi), color: "bg-emerald-500" },
              { label: "ESI Employer", value: parseFloat(t.total_employer_esi), color: "bg-teal-500" },
              { label: "Professional Tax", value: parseFloat(t.total_pt), color: "bg-amber-500" },
            ];
            const maxVal = Math.max(...items.map((x) => x.value), 1);
            return (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600 dark:text-slate-400">{item.label}</span>
                      <span className="font-numeric font-semibold text-slate-800 dark:text-slate-200">
                        {formatINR(item.value)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={clsx("h-full rounded-full transition-all duration-500", item.color)}
                        style={{ width: `${(item.value / maxVal) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                  {t.ceiling_applied_count} with PF ceiling · {t.esi_eligible_count} ESI eligible
                </p>
              </div>
            );
          })()}
        </div>

        {/* Activity Feed */}
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Activity
            </h2>
            <Activity className="h-4 w-4 text-slate-300 dark:text-slate-600" />
          </div>
          {auditQ.isLoading && <Spinner className="h-5 w-5" />}
          {!auditQ.isLoading && (auditQ.data?.length ?? 0) === 0 && (
            <div className="flex h-32 items-center justify-center text-sm text-slate-400">
              No audit events yet
            </div>
          )}
          <div className="space-y-3">
            {auditQ.data?.slice(0, 8).map((e, i) => (
              <div key={e.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={clsx(
                      "h-2 w-2 rounded-full mt-1.5 shrink-0",
                      EVENT_COLORS[e.event_type] ?? "bg-slate-400"
                    )}
                  />
                  {i < (auditQ.data?.slice(0, 8).length ?? 0) - 1 && (
                    <div className="w-px flex-1 bg-slate-100 dark:bg-slate-800 mt-1" style={{ minHeight: 16 }} />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {EVENT_LABELS[e.event_type] ?? e.event_type}
                  </div>
                  {e.entity_id && (
                    <div className="text-[10px] text-slate-400 font-mono">#{e.entity_id.slice(0, 8)}</div>
                  )}
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock className="h-2.5 w-2.5 text-slate-300" />
                    <span className="text-[10px] text-slate-400">{relativeTime(e.created_at)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Link
            to="/audit"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400"
          >
            View full audit log <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Action Items + Deadlines */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">Action Items</h2>
          <ActionItems failedCycles={failedCycles} failedResults={failedResults} />
        </div>

        <div className="card">
          <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">
            Upcoming Statutory Deadlines
          </h2>
          <div className="space-y-2">
            {deadlines.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{d.name}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{d.description}</div>
                </div>
                <div
                  className={clsx(
                    "shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold",
                    d.daysLeft <= 3
                      ? "bg-danger-light text-danger-dark dark:bg-danger/10 dark:text-danger"
                      : d.daysLeft <= 7
                      ? "bg-warning-light text-warning-dark dark:bg-warning/10 dark:text-warning"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                  )}
                >
                  {d.daysLeft}d left
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionItems({
  failedCycles,
  failedResults,
}: {
  failedCycles: PayrollCycle[];
  failedResults: PayrollResult[];
}) {
  const hasIssues = failedCycles.length > 0 || failedResults.length > 0;
  if (!hasIssues) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          All clear — no open issues
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {failedCycles.map((c) => (
        <Link
          key={c.id}
          to={`/cycles/${c.id}`}
          className="flex items-center justify-between rounded-xl border border-danger/20 bg-danger-light dark:bg-danger/10 px-4 py-3 hover:bg-danger/10 dark:hover:bg-danger/20 transition-colors"
        >
          <div className="text-sm">
            <span className="font-semibold text-danger-dark dark:text-danger">Cycle FAILED: </span>
            <span className="text-slate-700 dark:text-slate-300">{c.name}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-danger" />
        </Link>
      ))}
      {failedResults.length > 0 && (
        <div className="rounded-xl border border-danger/20 bg-danger-light dark:bg-danger/10 px-4 py-3">
          <div className="text-sm font-semibold text-danger-dark dark:text-danger">
            {failedResults.length} payroll result{failedResults.length !== 1 ? "s" : ""} failed
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Review in Pay Run Summary</div>
        </div>
      )}
    </div>
  );
}
