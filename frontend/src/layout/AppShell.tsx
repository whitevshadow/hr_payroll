import { useState, type ReactNode, createContext, useContext, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
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
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Search,
  LogOut,
  User,
  Settings,
  Zap,
  CheckCircle2,
  X,
  Menu,
  CircleDollarSign,
  Building,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { canViewAudit, isEmployeeOnly } from "../lib/roles";
import { notificationsApi } from "../api/notifications";
import { qk } from "../lib/queryClient";
import { relativeTime } from "../lib/format";
import clsx from "clsx";

// ── Theme Context ─────────────────────────────────────────────────────────
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
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  return (
    <ThemeContext.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Nav items with icons ──────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
  end?: boolean;
  adminOnly?: boolean;
  hrOnly?: boolean;
}

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    ],
  },
  {
    label: "Organization",
    hrOnly: true,
    items: [
      { to: "/employees", label: "Employees", icon: Users, hrOnly: true },
      { to: "/departments", label: "Departments", icon: Building2, hrOnly: true },
    ],
  },
  {
    label: "Workforce",
    hrOnly: true,
    items: [
      { to: "/attendance", label: "Attendance", icon: Calendar, hrOnly: true },
      { to: "/salary", label: "Salary", icon: DollarSign, hrOnly: true },
    ],
  },
  {
    label: "Payroll",
    hrOnly: true,
    items: [
      { to: "/cycles", label: "Payroll Cycles", icon: CircleDollarSign, hrOnly: true },
      { to: "/payouts", label: "Payouts", icon: CreditCard, hrOnly: true },
      { to: "/tds", label: "TDS", icon: Receipt, hrOnly: true },
    ],
  },
  {
    label: "Compliance & Reports",
    hrOnly: true,
    items: [
      { to: "/compliance", label: "Compliance", icon: ShieldCheck, hrOnly: true },
      { to: "/reports", label: "Reports", icon: BarChart3, hrOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/audit", label: "Audit Log", icon: ClipboardList, adminOnly: true },
      { to: "/me", label: "My Payslips", icon: FileText },
    ],
  },
];

// ── Sidebar ──────────────────────────────────────────────────────────────
function Sidebar({
  collapsed,
  onToggle,
  mobile,
  onClose,
}: {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onClose?: () => void;
}) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const isEmpOnly = isEmployeeOnly(user);
  const canAudit = canViewAudit(user);
  const { dark, toggle: toggleTheme } = useTheme();

  function handleLogout() {
    logout();
    nav("/login");
  }

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : "U";

  return (
    <aside
      className={clsx(
        "flex flex-col h-full bg-white/95 dark:bg-slate-900/95 border-r border-slate-200/80 dark:border-slate-800/80",
        "backdrop-blur-xl transition-all duration-300 ease-in-out",
        mobile ? "w-72" : collapsed ? "w-[72px]" : "w-[280px]"
      )}
    >
      {/* Logo */}
      <div
        className={clsx(
          "flex items-center border-b border-slate-100 dark:border-slate-800",
          collapsed && !mobile ? "px-4 py-4 justify-center" : "px-5 py-4 gap-3"
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-violet-600 shadow-sm">
          <Zap className="h-4 w-4 text-white" />
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-tight">
              PeopleOS
            </div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">HR & Payroll</div>
          </div>
        )}
        {!mobile && (
          <button
            onClick={onToggle}
            className={clsx(
              "ml-auto flex h-6 w-6 items-center justify-center rounded-md text-slate-400",
              "hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300",
              "transition-colors duration-150",
              collapsed && "mx-auto ml-auto"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {mobile && onClose && (
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 no-scrollbar">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => {
            if (item.hrOnly && isEmpOnly) return false;
            if ((item as any).adminOnly && !canAudit) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.label} className="mb-3">
              {(!collapsed || mobile) && (
                <div className="px-3 mb-1.5">
                  <span className="section-title">{section.label}</span>
                </div>
              )}
              {collapsed && !mobile && <div className="my-2 mx-2 border-t border-slate-100 dark:border-slate-800" />}
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={(item as any).end}
                  className={({ isActive }) =>
                    clsx(
                      isActive ? "nav-item-active" : "nav-item",
                      collapsed && !mobile && "justify-center px-0 py-2.5"
                    )
                  }
                  title={collapsed && !mobile ? item.label : undefined}
                >
                  <item.icon
                    className={clsx(
                      "shrink-0",
                      collapsed && !mobile ? "h-5 w-5" : "h-4 w-4"
                    )}
                  />
                  {(!collapsed || mobile) && (
                    <span className="truncate">{item.label}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-slate-100 dark:border-slate-800 p-3">
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-violet-500 text-xs font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">
                {user?.email?.split("@")[0] ?? "User"}
              </div>
              <div className="truncate text-[10px] text-slate-400">{user?.email}</div>
            </div>
            <button
              onClick={handleLogout}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
              title="Logout"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="flex w-full items-center justify-center rounded-lg py-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 transition-colors"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────
function TopBar({ onMobileMenuOpen }: { onMobileMenuOpen: () => void }) {
  const { dark, toggle: toggleTheme } = useTheme();
  const location = useLocation();

  // Derive page title from path
  const pageTitle = (() => {
    const p = location.pathname;
    if (p === "/") return "Dashboard";
    if (p.startsWith("/employees")) return "Employees";
    if (p.startsWith("/departments")) return "Departments";
    if (p.startsWith("/salary")) return "Salary";
    if (p.startsWith("/attendance")) return "Attendance";
    if (p.startsWith("/cycles")) return "Payroll Cycles";
    if (p.startsWith("/payouts")) return "Payouts";
    if (p.startsWith("/compliance")) return "Compliance";
    if (p.startsWith("/tds")) return "TDS";
    if (p.startsWith("/reports")) return "Reports";
    if (p.startsWith("/audit")) return "Audit Log";
    if (p.startsWith("/me")) return "My Payslips";
    return "";
  })();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-4 gap-4">
      {/* Mobile menu button */}
      <button
        onClick={onMobileMenuOpen}
        className="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Page title */}
      <div className="hidden lg:block text-sm font-semibold text-slate-700 dark:text-slate-300">
        {pageTitle}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
          aria-label="Toggle theme"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications */}
        <NotificationBell />
      </div>
    </header>
  );
}

// ── Notification Bell ─────────────────────────────────────────────────────
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const notifQ = useQuery({
    queryKey: qk.notifications,
    queryFn: () => notificationsApi.list(),
    refetchInterval: 30_000,
  });

  const readMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });

  const unread = notifQ.data?.unread_count ?? 0;
  const items = notifQ.data?.notifications ?? [];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-40 w-80 rounded-xl border border-slate-200 bg-white shadow-glass-md dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Notifications
                </span>
                {unread > 0 && (
                  <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                    {unread} new
                  </span>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
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
                      "border-b border-slate-50 dark:border-slate-800/50 px-4 py-3 text-sm last:border-0",
                      !n.is_read
                        ? "bg-accent-50/50 dark:bg-accent-900/10"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                      "transition-colors duration-100"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 dark:text-slate-200 text-xs leading-relaxed">
                          {n.body}
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-[10px] text-slate-400">{relativeTime(n.created_at)}</span>
                          {!n.is_read && (
                            <button
                              className="text-[10px] font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400"
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
      </AnimatePresence>
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────────────
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex shrink-0 flex-col" style={{ width: collapsed ? 72 : 280 }}>
          <Sidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        </div>

        {/* Mobile Sidebar Drawer */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
                onClick={() => setMobileOpen(false)}
              />
              <motion.div
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="fixed inset-y-0 left-0 z-50 lg:hidden"
              >
                <Sidebar
                  collapsed={false}
                  onToggle={() => {}}
                  mobile
                  onClose={() => setMobileOpen(false)}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onMobileMenuOpen={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl p-6">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {children}
              </motion.div>
            </div>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
