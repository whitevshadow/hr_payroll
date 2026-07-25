import clsx from "clsx";

interface StatusConfig {
  bg: string;
  text: string;
  dot: string;
  label?: string;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  // Cycle states
  DRAFT:     { bg: "bg-slate-100 dark:bg-slate-800",   text: "text-slate-600 dark:text-slate-400",   dot: "bg-slate-400" },
  LOCKED:    { bg: "bg-amber-50 dark:bg-amber-900/20",  text: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-500" },
  COMPUTING: { bg: "bg-blue-50 dark:bg-blue-900/20",   text: "text-blue-700 dark:text-blue-400",     dot: "bg-blue-500",   label: "COMPUTING" },
  COMPUTED:  { bg: "bg-violet-50 dark:bg-violet-900/20", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
  APPROVED:  { bg: "bg-accent-50 dark:bg-accent-900/20", text: "text-accent-700 dark:text-accent-400", dot: "bg-accent-500" },
  DISBURSED: { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  FAILED:    { bg: "bg-danger-light dark:bg-danger/10", text: "text-danger-dark dark:text-danger",     dot: "bg-danger" },
  // Employee
  ACTIVE:    { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  INACTIVE:  { bg: "bg-slate-100 dark:bg-slate-800",   text: "text-slate-500 dark:text-slate-400",   dot: "bg-slate-400" },
  SEPARATED: { bg: "bg-danger-light dark:bg-danger/10", text: "text-danger-dark dark:text-danger",     dot: "bg-danger" },
  // Payout
  SUCCESS:   { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  QUEUED:    { bg: "bg-slate-100 dark:bg-slate-800",   text: "text-slate-600 dark:text-slate-400",   dot: "bg-slate-400" },
  PENDING:   { bg: "bg-amber-50 dark:bg-amber-900/20",  text: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-500" },
  COMPLETED: { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  PAID:      { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  RETRIED:   { bg: "bg-blue-50 dark:bg-blue-900/20",   text: "text-blue-700 dark:text-blue-400",     dot: "bg-blue-500" },
};

const DEFAULT: StatusConfig = {
  bg: "bg-slate-100 dark:bg-slate-800",
  text: "text-slate-600 dark:text-slate-400",
  dot: "bg-slate-400",
};

export function StatusBadge({
  status,
  className,
  showDot = true,
  size = "md",
}: {
  status: string;
  className?: string;
  showDot?: boolean;
  size?: "sm" | "md";
}) {
  const cfg = STATUS_MAP[status] ?? DEFAULT;
  return (
    <span
      className={clsx(
        "badge",
        cfg.bg,
        cfg.text,
        size === "sm" && "text-[10px] px-1.5 py-0.5",
        className
      )}
    >
      {showDot && (
        <span
          className={clsx(
            "rounded-full shrink-0",
            cfg.dot,
            size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2"
          )}
        />
      )}
      {cfg.label ?? status}
    </span>
  );
}
