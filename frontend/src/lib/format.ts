/** Parse an ISO string, returning null when it is missing or unparseable, so the
 *  formatters render the em-dash placeholder instead of the string "Invalid Date". */
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO date → "DD MMM YYYY" */
export function formatDate(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** ISO date → "MMM YYYY" (for cycles / attendance month headers) */
export function formatMonth(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

/** ISO datetime → locale datetime string */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return "—";
  return d.toLocaleString("en-IN");
}

/** Get "YYYY-MM-01" for the current month. */
export function currentMonthFirst(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Get "YYYY-MM" for the current month (for <input type="month"> value). */
export function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → "YYYY-MM-01" */
export function monthToFirst(ym: string): string {
  return `${ym}-01`;
}

/** "YYYY-MM-DD" → "YYYY-MM" */
export function firstToMonth(iso: string): string {
  return iso.slice(0, 7);
}

/** ISO datetime → relative human string, e.g. "3m ago", "2h ago", "3d ago". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Abbreviated INR for chart axes: 1,00,000 → ₹1L, 10,00,000 → ₹10L */
export function formatINRShort(value: string | number | null | undefined): string {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(n)) return "₹0";
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n.toFixed(0)}`;
}
