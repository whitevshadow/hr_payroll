import {
  useState,
  memo,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
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
  Bell,
  ChevronDown,
  Moon,
  Sun,
  Search,
  LogOut,
  Zap,
  CheckCircle2,
  X,
  Menu,
  CircleDollarSign,
  ClipboardList,
  Command,
  Wifi,
  WifiOff,
  PanelLeftClose,
  PanelLeftOpen,
  Briefcase,
  Clock,
  Umbrella,
  Landmark,
} from "lucide-react";
import { useAuth, getToken } from "../lib/auth";
import { canViewAudit, isEmployeeOnly } from "../lib/roles";
import { Z } from "../lib/zIndex";
import { notificationsApi } from "../api/notifications";
import { clientsApi } from "../api/clients";
import { qk, STALE_STABLE } from "../lib/queryClient";
import { currentMonthFirst, relativeTime } from "../lib/format";
import { CommandPalette, useCommandPalette } from "../components/CommandPalette";
import { usePayrollSSE } from "../hooks/usePayrollSSE";
import { useClientContext } from "../lib/ClientContext";
import clsx from "clsx";
import type { Client } from "../types";

// ── Theme Context ──────────────────────────────────────────────────────────────
const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({
  dark: false,
  toggle: () => {},
});
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("theme")) setDark(e.matches);
    };
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  return (
    <ThemeContext.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Navigation structure ───────────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  adminOnly?: boolean;
  hrOnly?: boolean;
}

const NAV_SECTIONS: { label: string; hrOnly?: boolean; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true }],
  },
  {
    label: "Organization",
    hrOnly: true,
    items: [
      { to: "/clients",     label: "Clients",     icon: Briefcase,  hrOnly: true },
      { to: "/employees",   label: "Employees",   icon: Users,     hrOnly: true },
      { to: "/departments", label: "Departments", icon: Building2,  hrOnly: true },
    ],
  },
  {
    label: "Workforce",
    hrOnly: true,
    items: [
      { to: "/attendance", label: "Attendance", icon: Calendar,   hrOnly: true },
      { to: "/leave-management", label: "Leave Management", icon: Calendar, hrOnly: true },
      { to: "/leave", label: "Leave Policies", icon: Umbrella, hrOnly: true },
      { to: "/leave-balance", label: "Leave Ledger", icon: Clock, hrOnly: true },
      { to: "/salary",     label: "Salary",     icon: DollarSign, hrOnly: true },
    ],
  },
  {
    label: "Payroll",
    hrOnly: true,
    items: [
      { to: "/cycles",  label: "Payroll Cycles", icon: CircleDollarSign, hrOnly: true },
      { to: "/payouts", label: "Payouts",        icon: CreditCard,       hrOnly: true },
      { to: "/payslips", label: "Payslips",      icon: FileText,         hrOnly: true },
      { to: "/tds",     label: "TDS",            icon: Receipt,          hrOnly: true },
    ],
  },
  {
    label: "Compliance & Reports",
    hrOnly: true,
    items: [
      { to: "/compliance", label: "Compliance", icon: ShieldCheck, hrOnly: true },
      { to: "/statutory-portals", label: "Statutory Filings", icon: Landmark, hrOnly: true },
      { to: "/reports",    label: "Reports",    icon: BarChart3,   hrOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/audit", label: "Audit Log",   icon: ClipboardList, adminOnly: true },
    ],
  },
];

// ── Tooltip for collapsed mode ─────────────────────────────────────────────────
function NavTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className="relative flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.92 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="nav-tooltip"
          >
            {label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sidebar Component ──────────────────────────────────────────────────────────
function Sidebar({
  collapsed,
  onToggle,
  mobile,
  onClose,
  onCmdK,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onClose?: () => void;
  onCmdK?: () => void;
}) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const isEmpOnly = isEmployeeOnly(user);
  const canAudit  = canViewAudit(user);
  const { dark, toggle: toggleTheme } = useTheme();
  const [searchFocused, setSearchFocused] = useState(false);

  function handleLogout() {
    logout();
    nav("/login");
  }

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "U";
  const userName  = user?.email?.split("@")[0] ?? "User";
  const role      = (user?.roles?.[0] ?? "EMPLOYEE").replace(/_/g, " ");

  const isExpanded = !collapsed || mobile;

  return (
    <aside className="sidebar-premium flex flex-col h-full overflow-hidden relative" style={{ width: "100%" }}>
      {/* Static background gradient — parallax removed (was driving main-thread style mutations on every mousemove) */}
      <div className="sidebar-bg-gradient pointer-events-none" />

      {/* ── Logo / Brand ─────────────────────────────────────────────────── */}
      <div
        className={clsx(
          "flex items-center shrink-0 px-4 py-4 relative z-10",
          isExpanded ? "gap-3" : "justify-center px-0"
        )}
      >
        {/* App icon */}
        <motion.div
          className="sidebar-logo-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          whileHover={{ scale: 1.08, rotate: 5 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
        >
          <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
        </motion.div>

        <AnimatePresence mode="wait">
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="min-w-0 flex-1"
            >
              <div className="text-[13.5px] font-bold text-slate-900 dark:text-slate-100 leading-tight tracking-tight">
                PeopleOS
              </div>
              <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-[0.18em] mt-0.5">
                HR &amp; Payroll
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {mobile ? (
                onClose && (
                  <button
                    onClick={onClose}
                    className="sidebar-icon-btn ml-auto"
                    aria-label="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )
              ) : (
                <button
                  onClick={onToggle}
                  className="sidebar-icon-btn ml-auto"
                  aria-label="Collapse sidebar"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed expand button */}
        {!isExpanded && !mobile && (
          <button
            onClick={onToggle}
            className="sidebar-icon-btn"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Search bar ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {isExpanded && onCmdK && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="px-3 pb-2 relative z-10"
          >
            <motion.button
              onClick={onCmdK}
              className={clsx("sidebar-search-bar w-full", searchFocused && "sidebar-search-focused")}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
            >
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="flex-1 text-left truncate text-[12px] text-slate-400 dark:text-slate-500">
                Search employees, payrolls…
              </span>
              <kbd className="sidebar-kbd">
                <Command className="h-2.5 w-2.5" />K
              </kbd>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-1 px-2 no-scrollbar relative z-10">
        {NAV_SECTIONS.map((section) => {
          const visible = section.items.filter((item) => {
            if (item.hrOnly && isEmpOnly) return false;
            if ((item as any).adminOnly && !canAudit) return false;
            return true;
          });
          if (visible.length === 0) return null;

          return (
            <div key={section.label} className="mb-1">
              {/* Section label */}
              {isExpanded ? (
                <div className="px-3 pt-4 pb-1.5">
                  <span className="nav-section-label">{section.label}</span>
                </div>
              ) : (
                <div className="my-2.5 mx-2 sidebar-section-divider" />
              )}

              <div className="space-y-0.5">
                {visible.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={(item as any).end}
                    className="block relative"
                  >
                    {({ isActive }) =>
                      isExpanded ? (
                        <ExpandedNavItem item={item} isActive={isActive} />
                      ) : (
                        <NavTooltip label={item.label}>
                          <CollapsedNavItem item={item} isActive={isActive} />
                        </NavTooltip>
                      )
                    }
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 p-2.5 relative z-10">
        <div className="sidebar-footer-divider mb-2.5" />

        {/* Theme toggle */}
        {isExpanded ? (
          <motion.button
            onClick={toggleTheme}
            className="sidebar-footer-btn w-full"
            whileHover={{ x: 2 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
          >
            {dark ? (
              <>
                <Sun className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span>Dark Mode</span>
              </>
            )}
          </motion.button>
        ) : (
          <motion.button
            onClick={toggleTheme}
            className="sidebar-icon-btn w-full justify-center"
            whileHover={{ scale: 1.1 }}
            title={dark ? "Light mode" : "Dark mode"}
          >
            {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
          </motion.button>
        )}

        {/* User profile */}
        {isExpanded ? (
          <motion.div
            className="sidebar-profile-card mt-1.5"
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
          >
            {/* Avatar */}
            <div className="sidebar-avatar shrink-0">
              <span>{initials}</span>
            </div>
            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                {userName}
              </div>
              <div className="mt-0.5">
                <span className="sidebar-role-badge">{role}</span>
              </div>
            </div>
            {/* Logout */}
            <motion.button
              onClick={handleLogout}
              className="sidebar-icon-btn opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
              whileHover={{ scale: 1.1 }}
              title="Logout"
            >
              <LogOut className="h-3.5 w-3.5" />
            </motion.button>
          </motion.div>
        ) : (
          <NavTooltip label="Logout">
            <motion.button
              onClick={handleLogout}
              className="sidebar-icon-btn w-full justify-center mt-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
              whileHover={{ scale: 1.1 }}
            >
              <LogOut className="h-4 w-4" />
            </motion.button>
          </NavTooltip>
        )}
      </div>
    </aside>
  );
}

// ── Expanded Nav Item ──────────────────────────────────────────────────────────
// Pure CSS transitions — no FLIP, no JS-driven gestures.
// layoutId removed: eliminated main-thread layout thrashing on every click.
// memo: prevents re-render when sibling nav items change active state.
const ExpandedNavItem = memo(function ExpandedNavItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <div className={clsx("nav-item-premium", isActive ? "nav-item-premium-active" : "nav-item-premium-idle")}>
      {/* Active pill background — CSS opacity/scale, compositor-threaded */}
      <div
        className="nav-active-pill-bg"
        style={{
          opacity: isActive ? 1 : 0,
          transform: isActive ? "scale(1)" : "scale(0.96)",
          transition: "opacity 140ms ease, transform 140ms ease",
        }}
      />
      {isActive && <div className="nav-active-glow" />}

      <item.icon
        className={clsx(
          "h-[16px] w-[16px] shrink-0 relative z-10 transition-colors duration-150",
          isActive
            ? "text-accent dark:text-violet-400 nav-icon-active"
            : "text-slate-400 dark:text-slate-500"
        )}
        strokeWidth={isActive ? 2.2 : 1.8}
      />

      <span
        className={clsx(
          "relative z-10 truncate text-[13px] font-medium transition-colors duration-150",
          isActive
            ? "text-slate-900 dark:text-slate-100 font-semibold"
            : "text-slate-600 dark:text-slate-400"
        )}
      >
        {item.label}
      </span>

      {/* Active dot — CSS, no layoutId */}
      <span
        className="ml-auto relative z-10 h-1.5 w-1.5 rounded-full bg-accent dark:bg-violet-400 shrink-0"
        style={{
          opacity: isActive ? 1 : 0,
          transform: isActive ? "scale(1)" : "scale(0)",
          transition: "opacity 140ms ease, transform 140ms ease",
        }}
      />
    </div>
  );
});

// ── Collapsed Nav Item ─────────────────────────────────────────────────────────
const CollapsedNavItem = memo(function CollapsedNavItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <div
      className={clsx(
        "relative flex items-center justify-center rounded-xl mx-1 p-2.5 cursor-pointer transition-colors duration-150",
        isActive
          ? "bg-accent/10 dark:bg-violet-500/15"
          : "hover:bg-white/40 dark:hover:bg-white/6"
      )}
    >
      <div
        className="nav-active-pill-bg-collapsed"
        style={{
          opacity: isActive ? 1 : 0,
          transition: "opacity 140ms ease",
        }}
      />
      <item.icon
        className={clsx(
          "h-[18px] w-[18px] relative z-10 transition-colors duration-150",
          isActive
            ? "text-accent dark:text-violet-400"
            : "text-slate-400 dark:text-slate-500"
        )}
        strokeWidth={isActive ? 2.2 : 1.8}
      />
      {isActive && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 h-1 w-1 rounded-full bg-accent dark:bg-violet-400" />
      )}
    </div>
  );
});

// ── Portal Notification Panel ──────────────────────────────────────────────────
function NotificationPanel({
  open,
  anchorRef,
  onClose,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const notifQ = useQuery({
    queryKey: qk.notifications,
    queryFn: () => notificationsApi.list(),
    refetchInterval: 30_000,
  });

  const readMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });

  useEffect(() => {
    if (open && anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  }, [open, anchorRef]);

  const unread = notifQ.data?.unread_count ?? 0;
  const items  = notifQ.data?.notifications ?? [];

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 1499 }} onClick={onClose} aria-hidden />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{   opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed w-80 glass-panel overflow-hidden"
            style={{ top: pos.top, right: pos.right, zIndex: 1500 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/20 dark:border-white/6 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Notifications
                </span>
                {unread > 0 && (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-bold text-danger">
                    {unread}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto no-scrollbar">
              {items.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-slate-200 dark:text-slate-700" />
                  <div className="text-sm text-slate-400">All caught up!</div>
                </div>
              )}
              {items.map((n) => (
                <div
                  key={n.id}
                  className={clsx(
                    "border-b border-white/10 dark:border-white/5 px-4 py-3 text-sm last:border-0 transition-colors duration-75",
                    !n.is_read
                      ? "bg-[#5A52E5]/4 dark:bg-violet-900/10"
                      : "hover:bg-white/20 dark:hover:bg-white/4"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5A52E5]" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium leading-relaxed text-slate-800 dark:text-slate-200">
                        {n.body}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                          {relativeTime(n.created_at)}
                        </span>
                        {!n.is_read && (
                          <button
                            className="text-[10px] font-semibold text-[#5A52E5] hover:text-[#4841CC] dark:text-violet-400 transition-colors"
                            onClick={() => readMut.mutate(n.id)}
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Notification Bell ──────────────────────────────────────────────────────────
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const notifQ = useQuery({
    queryKey: qk.notifications,
    queryFn:  () => notificationsApi.list(),
    refetchInterval: 30_000,
  });

  const unread = notifQ.data?.unread_count ?? 0;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white/40 hover:text-slate-700 dark:hover:bg-white/6 dark:hover:text-slate-300 transition-colors"
      >
        <Bell className="h-[15px] w-[15px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[8px] font-bold text-white shadow">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <NotificationPanel
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
      />
    </>
  );
}


// ── Active Client Selector ──────────────────────────────────────────────────
function ActiveClientSelector({
  clients,
  selectedClientId,
  onSelect,
}: {
  clients: Client[];
  selectedClientId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selected = clients.find((c) => c.id === selectedClientId) ?? null;

  // Compute portal position from the trigger button's bounding rect
  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((o) => !o);
  };

  // Close on outside click (checks both the button and the panel)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !btnRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const dropdownPanel = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            right: dropdownPos.right,
            zIndex: 99999,
            width: 256,
          }}
          className={clsx(
            "rounded-xl border shadow-2xl overflow-hidden",
            "bg-white dark:bg-slate-900",
            "border-slate-200 dark:border-slate-700"
          )}
          role="listbox"
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 dark:text-slate-500">
              Switch Client Account
            </p>
          </div>

          {/* All Clients option */}
          <button
            role="option"
            aria-selected={selectedClientId === null}
            onClick={() => { onSelect(null); setOpen(false); }}
            className={clsx(
              "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
              selectedClientId === null
                ? "bg-accent-50 dark:bg-accent-900/20"
                : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <svg className="h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
            <span className="flex flex-col leading-none gap-0.5">
              <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">All Clients</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">No filter applied</span>
            </span>
            {selectedClientId === null && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-500" />
            )}
          </button>

          {/* Divider */}
          {clients.length > 0 && (
            <div className="border-t border-slate-100 dark:border-slate-800" />
          )}

          {/* Client list */}
          <div className="max-h-72 overflow-y-auto">
            {clients.map((c) => (
              <button
                key={c.id}
                role="option"
                aria-selected={selectedClientId === c.id}
                onClick={() => { onSelect(c.id); setOpen(false); }}
                className={clsx(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                  selectedClientId === c.id
                    ? "bg-accent-50 dark:bg-accent-900/20"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700 text-[11px] font-bold text-accent-700 dark:text-accent-300 uppercase">
                  {c.client_name.slice(0, 2)}
                </span>
                <span className="flex flex-col leading-none gap-0.5 min-w-0">
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {c.client_name}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    Internal ID: {c.client_code}
                  </span>
                </span>
                {selectedClientId === c.id && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-500 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative mr-1 sm:mr-2">
      {/* Trigger card */}
      <button
        ref={btnRef}
        onClick={handleOpen}
        className={clsx(
          "group flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl border transition-all duration-200 select-none",
          "bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm",
          "border-slate-200 dark:border-slate-700",
          "hover:border-accent-400 dark:hover:border-accent-500 hover:shadow-sm",
          open && "border-accent-400 dark:border-accent-500 shadow-sm"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {/* Icon */}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700">
          <svg
            className="h-3.5 w-3.5 text-accent-600 dark:text-accent-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </span>

        {/* Text */}
        <span className="hidden sm:flex flex-col items-start leading-none gap-0.5 min-w-0">
          <span className="text-[9px] font-semibold tracking-widest uppercase text-slate-400 dark:text-slate-500">
            Active Client Account
          </span>
          <span className="text-[12px] font-bold text-slate-800 dark:text-slate-100 truncate max-w-[110px]">
            {selected ? selected.client_name : "All Clients"}
          </span>
          {selected && (
            <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium">
              Internal ID: {selected.client_code}
            </span>
          )}
        </span>

        {/* Chevron */}
        <ChevronDown
          className={clsx(
            "h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Render dropdown via portal so it escapes header overflow/stacking context */}
      {createPortal(dropdownPanel, document.body)}
    </div>
  );
}

// ── Top Bar ────────────────────────────────────────────────────────────────────

function TopBar({
  onMobileMenuOpen,
  onCmdK,
  sseStatus,
}: {
  onMobileMenuOpen: () => void;
  onCmdK: () => void;
  sseStatus: "connecting" | "open" | "closed" | "error";
}) {
  const { user }  = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const location  = useLocation();
  const [params, setParams] = useSearchParams();
  const { selectedClientId, setSelectedClientId } = useClientContext();

  const isDashboard = location.pathname === "/";
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }).reverse();
  const period = params.get("period") || currentMonthFirst().slice(0, 7);

  const clientsQuery = useQuery({
    queryKey: qk.clients(),
    queryFn: () => clientsApi.list({ page_size: 200, status: "ACTIVE" }),
    staleTime: STALE_STABLE,
  });

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "U";
  const userName  = user?.email?.split("@")[0] ?? "admin";

  const pageTitle: Record<string, string> = {
    "/":            "Dashboard",
    "/employees":   "Employees",
    "/departments": "Departments",
    "/salary":      "Salary",
    "/attendance":  "Attendance",
    "/cycles":      "Payroll Cycles",
    "/payouts":     "Payouts",
    "/payslips":    "Payslips",
    "/compliance":  "Compliance",
    "/statutory-portals": "Statutory Filings",
    "/tds":         "TDS",
    "/reports":     "Reports",
    "/audit":       "Audit Log",
    "/clients":     "Clients",
    "/leave":       "Leave Policies",
    "/leave-management": "Leave Management",
    "/leave-balance": "Leave Ledger",
  };

  const title =
    Object.entries(pageTitle).find(([key]) =>
      key === "/" ? location.pathname === "/" : location.pathname.startsWith(key)
    )?.[1] ?? "PeopleOS";

  return (
    <header className="topbar-glass mx-2 mt-2 sm:mx-4 sm:mt-3 flex h-[52px] sm:h-[56px] shrink-0 items-center justify-between px-3 sm:px-5 gap-2 sm:gap-4">
      {/* Mobile menu */}
      <button
        onClick={onMobileMenuOpen}
        className="lg:hidden flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white/50 dark:hover:bg-white/8 transition-colors"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* ── Left: breadcrumb + workspace badge ─────────────────────────── */}
      <div className="hidden lg:flex items-center gap-2.5 shrink-0">
        <span className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </span>
        <button className="workspace-pill inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold">
          PeopleOS
          <span className="text-[10px] text-slate-400 dark:text-slate-500">v</span>
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </button>
      </div>

      {/* ── Center: global search ──────────────────────────────────────── */}
      <div className="flex-1 hidden lg:flex items-center justify-center">
        <button
          onClick={onCmdK}
          className="search-glass flex items-center gap-2.5 px-4 py-2 w-full max-w-[360px] text-left"
        >
          <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="flex-1 text-[13px] text-slate-400">
            Search employees, cycles, or commands…
          </span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>
      </div>

      {/* ── Right: utilities ───────────────────────────────────────────── */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Global Client Selector — card-style "Active Client Account" */}
        {!isEmployeeOnly(user) && (
          <ActiveClientSelector
            clients={clientsQuery.data?.items ?? []}
            selectedClientId={selectedClientId}
            onSelect={setSelectedClientId}
          />
        )}

        {/* Period selector */}
        {isDashboard && (
          <div className="hidden md:flex items-center gap-2 mr-1">
            <span className="text-[11px] font-medium text-slate-400">Period</span>
            <select
              className="search-glass px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              value={period}
              onChange={(e) => setParams({ period: e.target.value })}
            >
              {months.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {/* Live SSE dot */}
        <div
          title={`Real-time: ${sseStatus}`}
          className={clsx(
            "hidden lg:flex h-8 w-8 items-center justify-center rounded-full transition-colors",
            sseStatus === "open"       && "text-emerald-500",
            sseStatus === "connecting" && "text-amber-400 animate-pulse",
            (sseStatus === "closed" || sseStatus === "error") && "text-slate-300 dark:text-slate-700"
          )}
        >
          {sseStatus === "open"
            ? <Wifi className="h-3.5 w-3.5" />
            : <WifiOff className="h-3.5 w-3.5" />
          }
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-white/40 hover:text-slate-700 dark:hover:bg-white/8 dark:hover:text-slate-300 transition-colors"
        >
          {dark
            ? <Sun  className="h-[15px] w-[15px] text-amber-400" />
            : <Moon className="h-[15px] w-[15px]" />
          }
        </button>

        {/* Notifications */}
        <NotificationBell />

        {/* User badge */}
        <button className="profile-pill ml-0.5 flex items-center gap-2 pl-1 pr-3 py-1">
          <span className="profile-avatar">{initials}</span>
          <span className="hidden sm:inline text-[12px] font-semibold text-slate-700 dark:text-slate-300">
            {userName}
          </span>
        </button>
      </div>
    </header>
  );
}

// ── App Shell ──────────────────────────────────────────────────────────────────
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [sseStatus,   setSseStatus]   = useState<"connecting" | "open" | "closed" | "error">("closed");
  const { open: cmdOpen, setOpen: setCmdOpen } = useCommandPalette();
  const { user } = useAuth();
  // Router location — without this, the page-transition key below silently fell
  // back to the global window.location.
  const location = useLocation();

  usePayrollSSE({
    token: user ? getToken() : null,
    onStatusChange: setSseStatus,
  });

  return (
    <div className="app-shell">
      {/* Ambient orbs */}
      <div className="app-bg" aria-hidden>
        <span className="orb orb-blue"   />
        <span className="orb orb-purple" />
        <span className="orb orb-pink"   />
      </div>

      <div className="app-content flex h-screen overflow-hidden">
        {/* ── Desktop Sidebar ───────────────────────────────────────────── */}
        <motion.div
          className="hidden lg:flex shrink-0 flex-col p-3"
          animate={{ width: collapsed ? 80 + 24 : 272 + 24 }}
          transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
        >
          <Sidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            onCmdK={() => setCmdOpen(true)}
          />
        </motion.div>

        {/* ── Mobile Sidebar Drawer ──────────────────────────────────────── */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              {/* Full-viewport backdrop — must cover entire screen */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 lg:hidden bg-slate-900/50 backdrop-blur-sm"
                style={{ zIndex: Z.drawer - 1 }}
                onClick={() => setMobileOpen(false)}
              />
              {/* Drawer panel — slides in from left */}
              <motion.div
                initial={{ x: -290 }}
                animate={{ x: 0 }}
                exit={{ x: -290 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                className="fixed inset-y-0 left-0 lg:hidden p-2 sm:p-3 w-[280px] sm:w-[300px]"
                style={{ zIndex: Z.drawer }}
              >
                <Sidebar
                  collapsed={false}
                  onToggle={() => {}}
                  mobile
                  onClose={() => setMobileOpen(false)}
                  onCmdK={() => { setMobileOpen(false); setCmdOpen(true); }}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Main area ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <TopBar
            onMobileMenuOpen={() => setMobileOpen(true)}
            onCmdK={() => setCmdOpen(true)}
            sseStatus={sseStatus}
          />
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {children}
              </motion.div>
            </div>
          </main>
        </div>
      </div>

      {/* Global Command Palette (portal) */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
