import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  LayoutDashboard,
  Users,
  Building2,
  Calendar,
  DollarSign,
  CreditCard,
  FileText,
  ShieldCheck,
  Receipt,
  BarChart3,
  ClipboardList,
  CircleDollarSign,
  User,
  ChevronRight,
  Hash,
  Zap,
} from "lucide-react";
import { employeesApi } from "../api/employees";
import { qk } from "../lib/queryClient";
import clsx from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────
interface CommandItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  iconColor?: string;
  action: () => void;
  keywords?: string[];
}

// ── Static nav commands ───────────────────────────────────────────────────
function useStaticCommands(navigate: ReturnType<typeof useNavigate>): CommandItem[] {
  return useMemo(
    () => [
      {
        id: "nav-dashboard",
        group: "Navigate",
        label: "Dashboard",
        icon: LayoutDashboard,
        iconColor: "text-accent-500",
        action: () => navigate("/"),
        keywords: ["home", "overview"],
      },
      {
        id: "nav-employees",
        group: "Navigate",
        label: "Employees",
        icon: Users,
        iconColor: "text-blue-500",
        action: () => navigate("/employees"),
        keywords: ["people", "staff", "headcount"],
      },
      {
        id: "nav-departments",
        group: "Navigate",
        label: "Departments",
        icon: Building2,
        iconColor: "text-violet-500",
        action: () => navigate("/departments"),
        keywords: ["teams", "org"],
      },
      {
        id: "nav-attendance",
        group: "Navigate",
        label: "Attendance",
        icon: Calendar,
        iconColor: "text-amber-500",
        action: () => navigate("/attendance"),
        keywords: ["lop", "leave", "present"],
      },
      {
        id: "nav-salary",
        group: "Navigate",
        label: "Salary",
        icon: DollarSign,
        iconColor: "text-emerald-500",
        action: () => navigate("/salary"),
        keywords: ["ctc", "structure", "components"],
      },
      {
        id: "nav-cycles",
        group: "Navigate",
        label: "Payroll Cycles",
        icon: CircleDollarSign,
        iconColor: "text-cyan-500",
        action: () => navigate("/cycles"),
        keywords: ["run", "payroll", "period", "compute"],
      },
      {
        id: "nav-payouts",
        group: "Navigate",
        label: "Payouts",
        icon: CreditCard,
        iconColor: "text-teal-500",
        action: () => navigate("/payouts"),
        keywords: ["disbursement", "bank", "transfer"],
      },
      {
        id: "nav-compliance",
        group: "Navigate",
        label: "Compliance",
        icon: ShieldCheck,
        iconColor: "text-blue-600",
        action: () => navigate("/compliance"),
        keywords: ["pf", "esi", "pt", "statutory"],
      },
      {
        id: "nav-tds",
        group: "Navigate",
        label: "TDS",
        icon: Receipt,
        iconColor: "text-orange-500",
        action: () => navigate("/tds"),
        keywords: ["tax", "income", "declaration"],
      },
      {
        id: "nav-reports",
        group: "Navigate",
        label: "Reports",
        icon: BarChart3,
        iconColor: "text-pink-500",
        action: () => navigate("/reports"),
        keywords: ["analytics", "export", "download"],
      },
      {
        id: "nav-audit",
        group: "Navigate",
        label: "Audit Log",
        icon: ClipboardList,
        iconColor: "text-slate-500",
        action: () => navigate("/audit"),
        keywords: ["events", "history", "pii"],
      },
      {
        id: "nav-leave-management",
        group: "Navigate",
        label: "Leave Management",
        icon: Calendar,
        iconColor: "text-orange-500",
        action: () => navigate("/leave-management"),
        keywords: ["admin", "leave", "approve", "reject"],
      },
      {
        id: "nav-payslips",
        group: "Navigate",
        label: "Payslips",
        icon: FileText,
        iconColor: "text-indigo-500",
        action: () => navigate("/payslips"),
        keywords: ["admin", "payroll", "payslips", "download"],
      },
    ],
    [navigate]
  );
}

// ── Employee dynamic commands ─────────────────────────────────────────────
function useEmployeeCommands(
  query: string,
  navigate: ReturnType<typeof useNavigate>
): CommandItem[] {
  const enabled = query.length >= 2;

  const empQ = useQuery({
    queryKey: qk.employees({ search: query, page_size: 6 }),
    queryFn: () => employeesApi.list({ search: query, page_size: 6 }),
    enabled,
  });

  return useMemo(() => {
    if (!enabled || !empQ.data) return [];
    return empQ.data.items.map((e) => ({
      id: `emp-${e.id}`,
      group: "Employees",
      label: `${e.first_name} ${e.last_name}`,
      sublabel: `${e.emp_code} · ${e.designation ?? "—"}`,
      icon: User,
      iconColor: "text-accent-500",
      action: () => navigate(`/employees/${e.id}`),
      keywords: [e.emp_code, e.email ?? "", e.designation ?? ""],
    }));
  }, [enabled, empQ.data, navigate]);
}

// ── Filter logic ──────────────────────────────────────────────────────────
function filterItems(items: CommandItem[], q: string): CommandItem[] {
  if (!q) return items;
  const lower = q.toLowerCase();
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(lower) ||
      item.sublabel?.toLowerCase().includes(lower) ||
      item.keywords?.some((k) => k.toLowerCase().includes(lower))
  );
}

function groupItems(items: CommandItem[]): Map<string, CommandItem[]> {
  const map = new Map<string, CommandItem[]>();
  for (const item of items) {
    const group = map.get(item.group) ?? [];
    group.push(item);
    map.set(item.group, group);
  }
  return map;
}

// ── CommandPalette component ──────────────────────────────────────────────
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const staticCommands = useStaticCommands(navigate);
  const employeeCommands = useEmployeeCommands(query, navigate);

  const allItems = useMemo(() => {
    const filtered = filterItems(staticCommands, query);
    return [...employeeCommands, ...filtered];
  }, [staticCommands, employeeCommands, query]);

  const grouped = useMemo(() => groupItems(allItems), [allItems]);

  // Flat ordered list for keyboard nav
  const flatItems = useMemo(
    () => Array.from(grouped.values()).flat(),
    [grouped]
  );

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    const activeEl = listRef.current?.querySelector("[data-active='true']");
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runItem = useCallback(
    (item: CommandItem) => {
      item.action();
      onClose();
    },
    [onClose]
  );

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) runItem(item);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="command-palette-backdrop"
            onClick={onClose}
            aria-hidden
          />

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command Palette"
            className="command-palette"
            initial={{ opacity: 0, scale: 0.96, x: "-50%", y: -8 }}
            animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
            exit={{ opacity: 0, scale: 0.96, x: "-50%", y: -8 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
                placeholder="Search employees, pages, or commands…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKey}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              className="max-h-[420px] overflow-y-auto py-2 no-scrollbar"
            >
              {flatItems.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
                  <Zap className="h-8 w-8 text-slate-200 dark:text-slate-700" />
                  <p className="text-sm text-slate-400">
                    {query ? `No results for "${query}"` : "Start typing to search"}
                  </p>
                </div>
              )}

              {Array.from(grouped.entries()).map(([group, items]) => (
                <div key={group}>
                  <div className="px-4 pb-1 pt-3">
                    <span className="section-title">{group}</span>
                  </div>
                  {items.map((item) => {
                    const globalIdx = flatItems.indexOf(item);
                    const isActive = globalIdx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        data-active={isActive}
                        onMouseEnter={() => setActiveIndex(globalIdx)}
                        onClick={() => runItem(item)}
                        className={clsx(
                          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-75",
                          isActive
                            ? "bg-accent-50/80 dark:bg-accent-900/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        )}
                      >
                        <div
                          className={clsx(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                            isActive
                              ? "bg-accent-100 dark:bg-accent-900/40"
                              : "bg-slate-100 dark:bg-slate-800"
                          )}
                        >
                          <item.icon
                            className={clsx("h-3.5 w-3.5", item.iconColor ?? "text-slate-500")}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                            {item.label}
                          </div>
                          {item.sublabel && (
                            <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                              {item.sublabel}
                            </div>
                          )}
                        </div>
                        {isActive && (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-4 py-2.5">
              <span className="text-[10px] text-slate-400 flex items-center gap-2">
                <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 font-mono text-[9px]">↑↓</kbd>
                Navigate
                <kbd className="rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 font-mono text-[9px]">↵</kbd>
                Open
              </span>
              <div className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-accent-400" />
                <span className="text-[10px] font-semibold text-slate-400">PeopleOS</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Global keyboard hook ──────────────────────────────────────────────────
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
