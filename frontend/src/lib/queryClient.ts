import {
  QueryClient,
  MutationCache,
  QueryCache,
} from "@tanstack/react-query";
import { toastService, extractErrorMessage } from "./toast";

// ── Stable cache durations ──────────────────────────────────────────────────
// Reference data that changes infrequently (org structure, employee list).
export const STALE_STABLE   = 5 * 60 * 1_000;   // 5 min
// Operational data that changes during a session (cycles, compliance).
export const STALE_OPERATIONAL = 60 * 1_000;    // 1 min
// Real-time data (notifications — also refetched by SSE).
export const STALE_REALTIME = 30 * 1_000;       // 30 s

// ── Query-key factories ─────────────────────────────────────────────────────
// All keys are stable references so invalidation calls are precise.
export const qk = {
  me: ["me"] as const,
  myEmployee: ["my-employee"] as const,

  departments: ["departments"] as const,

  // Employee list — always use page_size:200 for full-list fetches so that all
  // components that need "all employees" share a single cache entry. Components
  // that need server-side pagination pass an explicit `page` param which
  // creates a separate, paginated cache entry.
  employees: (params?: Record<string, unknown>) =>
    ["employees", params] as const,
  employee: (id: string) => ["employee", id] as const,

  salaryHistory: (empId: string) => ["salary-history", empId] as const,
  salary: (empId: string) => ["salary", empId] as const,

  attendance: (empId: string, month: string) =>
    ["attendance", empId, month] as const,
  allAttendance: (month: string) => ["attendance", month] as const,

  cycles: ["cycles"] as const,
  cycle: (id: string) => ["cycle", id] as const,
  cycleSummary: (id: string) => ["cycle", id, "summary"] as const,

  compliance: (cycleId: string) => ["compliance", cycleId] as const,

  tdsCalc: (cycleId: string, empId: string) =>
    ["tds", cycleId, empId] as const,
  tdsOverview: (empId: string) =>
    ["tds-overview", empId] as const,
  tdsDeclarations: (empId: string) =>
    ["tds-declarations", empId] as const,

  payoutBatches: (cycleId: string) => ["payouts", cycleId] as const,
  payoutTransactions: (batchId: string) =>
    ["transactions", batchId] as const,

  generatedReports: (params?: Record<string, unknown>) =>
    ["reports", params] as const,

  audit: (params?: Record<string, unknown>) => ["audit", params] as const,

  notifications: ["notifications"] as const,

  clients: (params?: Record<string, unknown>) => ["clients", params] as const,
  client: (id: string) => ["client", id] as const,
  clientCredentials: (id: string) => ["client-credentials", id] as const,
};

// ── QueryClient ─────────────────────────────────────────────────────────────
function handleError(error: unknown) {
  const msg = extractErrorMessage(error);
  toastService.error(msg);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (_error, query) => {
      // Only surface background-refetch errors; initial-load errors are shown inline.
      if (query.state.data !== undefined) {
        handleError(_error);
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: handleError,
  }),
  defaultOptions: {
    queries: {
      // 1 minute default stale time — reduced from 30 s to halve background
      // refetch frequency. Reference-data queries can opt into STALE_STABLE.
      staleTime: STALE_OPERATIONAL,

      // Disable refetch-on-focus: the SSE connection pushes relevant invalidations
      // for payroll events; window-focus refetches just create noise in the logs.
      refetchOnWindowFocus: false,

      // Don't retry client errors (4xx) — they're deterministic.
      retry: (failureCount, error: unknown) => {
        const status = (error as any)?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
