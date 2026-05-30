import {
  QueryClient,
  MutationCache,
  QueryCache,
} from "@tanstack/react-query";
import { toastService, extractErrorMessage } from "./toast";

// Query-key factories — stable references for precise invalidation.
export const qk = {
  me: ["me"] as const,
  departments: ["departments"] as const,
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
  tdsCalc: (cycleId: string, empId: string) => ["tds", cycleId, empId] as const,
  payoutBatches: (cycleId: string) => ["payouts", cycleId] as const,
  payoutTransactions: (batchId: string) => ["transactions", batchId] as const,
  generatedReports: (params?: Record<string, unknown>) => ["reports", params] as const,
  audit: (params?: Record<string, unknown>) => ["audit", params] as const,
  notifications: ["notifications"] as const,
};

function handleError(error: unknown) {
  const msg = extractErrorMessage(error);
  toastService.error(msg);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (_error, query) => {
      // Only toast on background refetch errors (not initial loads, which show inline)
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
      staleTime: 30_000,
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
