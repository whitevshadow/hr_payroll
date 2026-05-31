import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../lib/queryClient";
import { SSEPayrollEventSchema } from "../lib/schemas";

const SSE_URL = `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"}/events/stream`;

type SSEStatus = "connecting" | "open" | "closed" | "error";

interface UsePayrollSSEOptions {
  /** Token for Authorization header (EventSource doesn't support headers natively;
   *  we use a short-lived ticket or fall back to URL param in dev) */
  token?: string | null;
  onStatusChange?: (s: SSEStatus) => void;
}

/**
 * Opens a persistent SSE connection to receive real-time payroll events.
 * Automatically invalidates React Query caches on relevant events so the UI
 * updates without a hard refresh.
 *
 * EventSource reconnects automatically on transient failures (3s backoff max).
 */
export function usePayrollSSE({ token, onStatusChange }: UsePayrollSSEOptions = {}) {
  const qc = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const statusRef = useRef<SSEStatus>("closed");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatus = useCallback(
    (s: SSEStatus) => {
      statusRef.current = s;
      onStatusChange?.(s);
    },
    [onStatusChange]
  );

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const url = token ? `${SSE_URL}?token=${encodeURIComponent(token)}` : SSE_URL;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      setStatus("open");
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    es.onerror = () => {
      setStatus("error");
      es.close();
      retryTimerRef.current = setTimeout(connect, 3_000);
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

    es.addEventListener("ping", () => {
      // keepalive ping — no action needed
    });
  }, [token, qc, setStatus]);

  useEffect(() => {
    // Only connect when the browser supports SSE and we have a realistic API URL
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
