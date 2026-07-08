/**
 * Toast notification system.
 * Renders via createPortal into #toast-root (outside the app tree) so toasts
 * always appear above every overlay. Uses centralized Z.toast z-index.
 *
 * Position:
 *  • Desktop (≥ 640px): top-right
 *  • Mobile (< 640px):  bottom-center (easier to reach with thumb)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { toastService, type ToastItem } from "../lib/toast";
import { Z } from "../lib/zIndex";
import clsx from "clsx";

// ─── State ────────────────────────────────────────────────────────────────────

interface State { toasts: ToastItem[] }
type Action =
  | { type: "ADD"; payload: ToastItem }
  | { type: "REMOVE"; payload: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD":
      return { toasts: [action.payload, ...state.toasts].slice(0, 5) };
    case "REMOVE":
      return { toasts: state.toasts.filter((t) => t.id !== action.payload) };
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_META: Record<ToastItem["type"], {
  icon: React.ElementType;
  bg: string;
  border: string;
  text: string;
  iconColor: string;
}> = {
  success: {
    icon: CheckCircle2,
    bg: "bg-emerald-50 dark:bg-emerald-950/80",
    border: "border-emerald-200 dark:border-emerald-800/60",
    text: "text-emerald-800 dark:text-emerald-200",
    iconColor: "text-emerald-500",
  },
  error: {
    icon: AlertCircle,
    bg: "bg-red-50 dark:bg-red-950/80",
    border: "border-red-200 dark:border-red-800/60",
    text: "text-red-800 dark:text-red-200",
    iconColor: "text-red-500",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-50 dark:bg-amber-950/80",
    border: "border-amber-200 dark:border-amber-800/60",
    text: "text-amber-800 dark:text-amber-200",
    iconColor: "text-amber-500",
  },
  info: {
    icon: Info,
    bg: "bg-blue-50 dark:bg-blue-950/80",
    border: "border-blue-200 dark:border-blue-800/60",
    text: "text-blue-800 dark:text-blue-200",
    iconColor: "text-blue-500",
  },
};

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<{ add: (t: Omit<ToastItem, "id">) => void }>({
  add: () => undefined,
});

function getToastRoot(): HTMLElement {
  return document.getElementById("toast-root") ?? document.body;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { toasts: [] });

  const add = useCallback((t: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    dispatch({ type: "ADD", payload: { ...t, id } });
    const duration = t.type === "error" ? 7_000 : 5_000;
    setTimeout(() => dispatch({ type: "REMOVE", payload: id }), duration);
  }, []);

  useEffect(() => {
    toastService.register(add);
  }, [add]);

  const toastContainer = createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      // Desktop: top-right. Mobile: bottom-center via Tailwind responsive.
      className="fixed inset-x-0 bottom-4 flex flex-col-reverse items-center gap-2 px-4 pointer-events-none sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:items-end sm:px-0"
      style={{ zIndex: Z.toast }}
    >
      <AnimatePresence initial={false}>
        {state.toasts.map((t) => {
          const meta = TYPE_META[t.type];
          const Icon = meta.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94, y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              role="alert"
              className={clsx(
                "pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl",
                "w-full max-w-sm backdrop-blur-xl",
                meta.bg, meta.border, meta.text,
              )}
              style={{
                backdropFilter: "blur(16px) saturate(1.6)",
                WebkitBackdropFilter: "blur(16px) saturate(1.6)",
              }}
            >
              <Icon className={clsx("h-4 w-4 mt-0.5 shrink-0", meta.iconColor)} />
              <span className="flex-1 text-sm font-medium leading-snug">{t.message}</span>
              <button
                onClick={() => dispatch({ type: "REMOVE", payload: t.id })}
                className="shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    getToastRoot(),
  );

  return (
    <ToastContext.Provider value={{ add }}>
      {children}
      {toastContainer}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
