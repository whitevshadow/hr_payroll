import { useMemo, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  CalendarDays,
  ShieldCheck,
  Building2,
  ChevronRight,
  TrendingUp,
  FileText,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { clientsApi } from "../api/clients";
import { employeesApi } from "../api/employees";
import { payrollApi } from "../api/payroll";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { formatINRShort, formatMonth } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";
import { Spinner, Skeleton } from "../components/Spinner";
import { useClientContext } from "../lib/ClientContext";
import clsx from "clsx";

export function ClientDashboard() {
  const { id } = useParams<{ id: string }>();
  const { setSelectedClientId } = useClientContext();

  useEffect(() => {
    if (id) setSelectedClientId(id);
  }, [id, setSelectedClientId]);

  // Fetch client details
  const clientQ = useQuery({
    queryKey: qk.client(id!),
    queryFn: () => clientsApi.get(id!),
    enabled: !!id,
    staleTime: STALE_STABLE,
  });

  // Fetch employees for this client
  const empQ = useQuery({
    queryKey: ["employees", { client_id: id }],
    queryFn: () => employeesApi.list({ page_size: 1, client_id: id, status: "ACTIVE" }),
    enabled: !!id,
  });

  // Fetch payroll cycles for this client
  const cyclesQ = useQuery({
    queryKey: ["cycles", { client_id: id }],
    queryFn: () => payrollApi.listCycles(id),
    enabled: !!id,
  });

  const client = clientQ.data;
  const cycles = cyclesQ.data ?? [];
  const latestCycle = cycles.find((c) => c.status !== "DRAFT");
  const recentCycles = cycles.slice(0, 6).reverse();

  // Fetch summaries for trend
  const trendIds = recentCycles.map((c) => c.id);
  const trendSummaries = useQuery({
    queryKey: ["trend", trendIds.join(",")],
    queryFn: async () => Promise.all(trendIds.map((cid) => payrollApi.getCycleSummary(cid))),
    enabled: trendIds.length > 0,
  });

  const trendData = useMemo(() => {
    return recentCycles.map((c, i) => ({
      name: formatMonth(c.period_start),
      gross: parseFloat(trendSummaries.data?.[i]?.totals?.gross ?? "0"),
      net: parseFloat(trendSummaries.data?.[i]?.totals?.net ?? "0"),
    }));
  }, [recentCycles, trendSummaries.data]);

  if (clientQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!client) {
    return <div className="p-6">Client not found.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          to="/clients"
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-50 leading-tight">
              {client.client_name}
            </h1>
            <StatusBadge status={client.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 font-mono">
            {client.client_code} {client.city && `• ${client.city}`}
          </p>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="card p-4 flex flex-col gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30">
            <Users className="h-4 w-4 shrink-0" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Active Employees
            </div>
            <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
              {empQ.isLoading ? <Skeleton className="h-6 w-16" /> : empQ.data?.total ?? 0}
            </div>
          </div>
        </div>

        <div className="card p-4 flex flex-col gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-900/30">
            <CalendarDays className="h-4 w-4 shrink-0" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Last Payroll
            </div>
            <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
              {cyclesQ.isLoading ? (
                <Skeleton className="h-6 w-16" />
              ) : latestCycle ? (
                latestCycle.name
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>

        <div className="card p-4 flex flex-col gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-900/30">
            <AlertTriangle className="h-4 w-4 shrink-0" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Open Alerts
            </div>
            <div className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">
              0
            </div>
          </div>
        </div>

        <div className="card p-4 flex flex-col gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
            <ShieldCheck className="h-4 w-4 shrink-0" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Compliance Status
            </div>
            <div className="mt-1 font-display text-xl font-bold text-emerald-600">
              Clear
            </div>
          </div>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Charts & Trends */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Payroll Trend
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Last 6 cycles — Net Payout</p>
              </div>
              <TrendingUp className="h-4 w-4 text-slate-300 dark:text-slate-600" />
            </div>
            {trendSummaries.isLoading || cyclesQ.isLoading ? (
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
                    <linearGradient id="net-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={formatINRShort}
                    tick={{ fontSize: 11, fill: "var(--chart-axis)" }}
                    width={60}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="net"
                    stroke="var(--chart-1)"
                    fill="url(#net-grad)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--chart-1)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Sidebar info */}
        <div className="space-y-6">
          <div className="card">
            <h2 className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Company Info
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Legal Name</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {client.legal_name || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">GST</span>
                <span className="font-mono text-slate-900 dark:text-white">
                  {client.gst_number || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">PAN</span>
                <span className="font-mono text-slate-900 dark:text-white">
                  {client.pan_number || "—"}
                </span>
              </div>
              <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Contact Person</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {client.contact_person || "—"}
                </span>
                {client.contact_email && (
                  <span className="text-slate-500 text-xs">{client.contact_email}</span>
                )}
                {client.contact_mobile && (
                  <span className="text-slate-500 text-xs">{client.contact_mobile}</span>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="mb-4 font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Quick Links
            </h2>
            <div className="space-y-1">
              <Link
                to={`/reports?client=${client.id}`}
                className="flex items-center justify-between rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <FileText className="h-4 w-4 text-slate-400" /> Client Reports
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
              <Link
                to={`/employees?client=${client.id}`}
                className="flex items-center justify-between rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <Users className="h-4 w-4 text-slate-400" /> View Directory
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
              <Link
                to={`/cycles?client=${client.id}`}
                className="flex items-center justify-between rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <Building2 className="h-4 w-4 text-slate-400" /> Payroll Cycles
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
