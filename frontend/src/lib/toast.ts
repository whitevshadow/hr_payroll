// Global toast service — a module-level singleton that any module can call.
// The ToastProvider (in components/Toast.tsx) registers the actual function.

export type ToastType = "error" | "success" | "info" | "warning";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

type Listener = (t: Omit<ToastItem, "id">) => void;
let _listener: Listener | null = null;

export const toastService = {
  register(fn: Listener) {
    _listener = fn;
  },
  fire(message: string, type: ToastType = "error") {
    _listener?.({ message, type });
  },
  error(msg: string) {
    this.fire(msg, "error");
  },
  success(msg: string) {
    this.fire(msg, "success");
  },
  info(msg: string) {
    this.fire(msg, "info");
  },
};

// Extract a user-readable message from an Axios / fetch error.
export function extractErrorMessage(error: unknown): string {
  if (!error) return "An unknown error occurred";
  const e = error as Record<string, unknown>;
  // Axios shape
  const resp = e.response as Record<string, unknown> | undefined;
  if (resp?.data) {
    const data = resp.data as Record<string, unknown>;
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d: any) => d.msg ?? d).join("; ");
    if (typeof data === "string") return data;
  }
  if (typeof e.message === "string") return e.message;
  return "Something went wrong";
}
