import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from "react";
import { toastService, type ToastItem } from "../lib/toast";
import clsx from "clsx";

interface State {
  toasts: ToastItem[];
}

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

const ToastContext = createContext<{ add: (t: Omit<ToastItem, "id">) => void }>({
  add: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { toasts: [] });

  const add = useCallback((t: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    dispatch({ type: "ADD", payload: { ...t, id } });
    setTimeout(() => dispatch({ type: "REMOVE", payload: id }), 5000);
  }, []);

  useEffect(() => {
    toastService.register(add);
  }, [add]);

  return (
    <ToastContext.Provider value={{ add }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {state.toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={clsx(
              "flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg text-sm text-white max-w-sm",
              {
                "bg-red-600": t.type === "error",
                "bg-emerald-600": t.type === "success",
                "bg-amber-500": t.type === "warning",
                "bg-slate-700": t.type === "info",
              }
            )}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dispatch({ type: "REMOVE", payload: t.id })}
              className="shrink-0 opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
