import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../lib/queryClient";
import { SSEPayrollEventSchema } from "../lib/schemas";
import { BASE } from "../lib/api";

const SSE_URL = `${BASE}/events/stream`;

// After this many consecutive failures stop auto-retrying; show a permanent
// "disconnected" state so we don't spam a 404 endpoint every 3 seconds.
const MAX_RETRIES = 3;
// Backoff schedule (ms): attempt 1→3s, 2→6s, 3→12s, then stop.
function backoffMs(attempt: number): number {
  return Math.min(3_000 * 2 ** (attempt - 1), 30_000);
}

type SSEStatus = "connecting" | "open" | "closed" | "error";

interface UsePayrollSSEOptions {
  token?: string | null;
  onStatusChange?: (s: SSEStatus) => void;
}

export function usePayrollSSE({ token, onStatusChange }: UsePayrollSSEOptions = {}) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const setStatus = useCallback(
    (s: SSEStatus) => { onStatusChange?.(s); },
    [onStatusChange],
  );

  const connect = useCallback(() => {
    esRef.current?.close();

    const url = token ? `${SSE_URL}?token=${encodeURIComponent(token)}` : SSE_URL;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      retryCountRef.current = 0;          // reset on success
      setStatus("open");
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    es.onerror = () => {
      es.close();
      retryCountRef.current += 1;

      if (retryCountRef.current > MAX_RETRIES) {
        // Give up — endpoint likely doesn't exist yet (404).
        // Show disconnected state; page refresh or explicit reconnect needed.
        setStatus("closed");
        return;
      }

      setStatus("error");
      const delay = backoffMs(retryCountRef.current);
      retryTimerRef.current = setTimeout(connect, delay);
    };

    es.addEventListener("payroll", (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data);
        const parsed = SSEPayrollEventSchema.safeParse(raw);
        if (!parsed.success) return;
        const event = parsed.data;

        if (event.type === "payroll.computed") {
          qc.invalidateQueries({ queryKey: qk.cycles });
          qc.invalidateQueries({ queryKey: qk.cycleSummary(event.cycle_id) });
        } else if (event.type === "payroll.disbursed") {
          qc.invalidateQueries({ queryKey: qk.cycles });
          qc.invalidateQueries({ queryKey: qk.payoutBatches(event.cycle_id) });
        } else if (event.type === "notification.new") {
          qc.invalidateQueries({ queryKey: qk.notifications });
        }
      } catch {
        // malformed message — ignore
      }
    });

    es.addEventListener("ping", () => { /* keepalive — no-op */ });
  }, [token, qc, setStatus]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      setStatus("closed");
    };
  }, [connect, setStatus]);
}
