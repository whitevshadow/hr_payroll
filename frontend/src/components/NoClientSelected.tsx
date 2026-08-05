import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Loader2 } from "lucide-react";
import { clientsApi } from "../api/clients";
import { useClientContext } from "../lib/ClientContext";
import { qk, STALE_STABLE } from "../lib/queryClient";

/**
 * Shown by every client-scoped page when no client is active.
 *
 * Previously each page rendered a dead end — "please select a client from the
 * top navigation bar" — with no way to act from where the user was standing.
 * This picks the client inline instead, and auto-selects when the tenant has
 * only one, which removes the step entirely for single-client accounts.
 */
export function NoClientSelected({ feature = "this page" }: { feature?: string }) {
  const { setSelectedClientId } = useClientContext();

  const clients = useQuery({
    queryKey: qk.clients(),
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  const items = clients.data?.items ?? [];

  // A tenant with a single client never had a meaningful choice to make.
  useEffect(() => {
    if (items.length === 1) setSelectedClientId(items[0].id);
  }, [items, setSelectedClientId]);

  return (
    <div className="card-glass mt-6 flex flex-col items-center justify-center p-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-50 dark:bg-accent-900/30">
        <Briefcase className="h-6 w-6 text-accent-600 dark:text-accent-400" />
      </div>
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">
        Select a client
      </h2>
      <p className="mt-2 max-w-sm text-slate-500 dark:text-slate-400">
        {feature.charAt(0).toUpperCase() + feature.slice(1)} is scoped to one client
        company. Choose one to continue — you can switch any time from the top bar.
      </p>

      {clients.isLoading && (
        <Loader2 className="mt-5 h-5 w-5 animate-spin text-slate-400" />
      )}

      {!clients.isLoading && items.length === 0 && (
        <p className="mt-5 text-sm text-amber-600 dark:text-amber-400">
          No active clients yet — create one from the Clients page first.
        </p>
      )}

      {!clients.isLoading && items.length > 1 && (
        <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
          {items.slice(0, 6).map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClientId(c.id)}
              className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-[var(--glass-card-bg)] px-3.5 py-2.5 text-left transition-colors hover:border-accent-400 hover:bg-accent-50/50 dark:hover:bg-accent-900/15"
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                {c.client_name}
              </span>
              <span className="font-mono text-[10.5px] text-slate-400">{c.client_code}</span>
            </button>
          ))}
          {items.length > 6 && (
            <p className="text-[11px] text-slate-400">
              +{items.length - 6} more — use the selector in the top bar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
