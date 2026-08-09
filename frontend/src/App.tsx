import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ClientProvider } from "./lib/ClientContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ProtectedRoute } from "./layout/ProtectedRoute";
import { useAuth } from "./lib/auth";
import { canViewAudit, hasRole } from "./lib/roles";
import { EmptyState } from "./components/EmptyState";
import { FullPageSpinner } from "./components/Spinner";
import { Login } from "./pages/Login";

/* Every page below is code-split.
 *
 * These were static imports, which put all 25 pages plus their heaviest
 * dependencies — `xlsx` (Attendance + the two import modals) and `recharts`
 * (Dashboard, ClientDashboard) — into the single entry chunk. Every user paid
 * to parse all of it before the login form could paint, whatever they had
 * permission to open. Login stays eager because it is the first paint. */
const Dashboard       = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const Employees       = lazy(() => import("./pages/Employees").then(m => ({ default: m.Employees })));
const EmployeeDetail  = lazy(() => import("./pages/EmployeeDetail").then(m => ({ default: m.EmployeeDetail })));
const Departments     = lazy(() => import("./pages/Departments").then(m => ({ default: m.Departments })));
const Locations       = lazy(() => import("./pages/Locations").then(m => ({ default: m.Locations })));
const RateCards       = lazy(() => import("./pages/RateCards").then(m => ({ default: m.RateCards })));
const Salary          = lazy(() => import("./pages/Salary").then(m => ({ default: m.Salary })));
const Attendance      = lazy(() => import("./pages/Attendance").then(m => ({ default: m.Attendance })));
const Cycles          = lazy(() => import("./pages/Cycles").then(m => ({ default: m.Cycles })));
const CycleDetail     = lazy(() => import("./pages/CycleDetail").then(m => ({ default: m.CycleDetail })));
const CycleSummary    = lazy(() => import("./pages/CycleSummary").then(m => ({ default: m.CycleSummary })));
const Compliance      = lazy(() => import("./pages/Compliance").then(m => ({ default: m.Compliance })));
const StatutoryPortals= lazy(() => import("./pages/StatutoryPortals").then(m => ({ default: m.StatutoryPortals })));
const Payouts         = lazy(() => import("./pages/Payouts").then(m => ({ default: m.Payouts })));
const Reports         = lazy(() => import("./pages/Reports").then(m => ({ default: m.Reports })));
const Payslip         = lazy(() => import("./pages/Payslip").then(m => ({ default: m.Payslip })));
const AuditLog        = lazy(() => import("./pages/AuditLog").then(m => ({ default: m.AuditLog })));
const Clients         = lazy(() => import("./pages/Clients").then(m => ({ default: m.Clients })));
const FinancialYears  = lazy(() => import("./pages/FinancialYears").then(m => ({ default: m.FinancialYears })));
const ClientDashboard = lazy(() => import("./pages/ClientDashboard").then(m => ({ default: m.ClientDashboard })));
const AdminPayslips   = lazy(() => import("./pages/AdminPayslips").then(m => ({ default: m.AdminPayslips })));
const Account         = lazy(() => import("./pages/Account").then(m => ({ default: m.Account })));
const Settings        = lazy(() => import("./pages/Settings").then(m => ({ default: m.Settings })));

function Shell({ children }: { children: React.ReactElement }) {
  const location = useLocation();
  return (
    <ProtectedRoute>
      <ClientProvider>
        <AppShell>
          {/* A page that throws must not take the whole app down to a blank
              screen. Keyed on the path so navigating away clears the error. */}
          <ErrorBoundary resetKey={location.pathname}>
            {/* Inside the shell, so a chunk fetch shows a spinner in the
                content area rather than blanking the sidebar and topbar. */}
            <Suspense fallback={<FullPageSpinner />}>{children}</Suspense>
          </ErrorBoundary>
        </AppShell>
      </ClientProvider>
    </ProtectedRoute>
  );
}

function Forbidden() {
  return (
    <div className="py-16">
      <EmptyState
        title="403 — Access denied"
        description="You don't have permission to view this page."
      />
    </div>
  );
}

/** Gate a route for HR+ roles.
 *
 * This was previously a pass-through ("for now, all authenticated users are
 * admin"), so every HR and payroll screen was reachable by anyone signed in.
 * It is a convenience gate only — each service re-checks roles on its own
 * endpoints, which is the boundary that actually holds. */
function HrRoute({ children }: { children: React.ReactElement }) {
  const { user, isLoading } = useAuth();
  // Wait for /auth/me rather than bouncing a legitimate HR user to 403 on a
  // hard refresh, when roles are not loaded yet.
  if (isLoading) return null;
  if (!hasRole(user, "SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN", "HR_MANAGER")) {
    return <Forbidden />;
  }
  return children;
}

/** Gate a route for audit-capable roles. */
function AuditRoute({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!canViewAudit(user)) return <Forbidden />;
  return children;
}

/** Dashboard for Admin */
function Home() {
  return <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Shell><Home /></Shell>} />

      {/* HR / admin routes */}
      <Route path="/employees" element={<Shell><HrRoute><Employees /></HrRoute></Shell>} />
      <Route path="/employees/:id" element={<Shell><HrRoute><EmployeeDetail /></HrRoute></Shell>} />
      <Route path="/departments" element={<Shell><HrRoute><Departments /></HrRoute></Shell>} />
      <Route path="/locations" element={<Shell><HrRoute><Locations /></HrRoute></Shell>} />
      <Route path="/clients" element={<Shell><HrRoute><Clients /></HrRoute></Shell>} />
      <Route path="/clients/:id" element={<Shell><HrRoute><ClientDashboard /></HrRoute></Shell>} />
      <Route path="/financial-years" element={<Shell><HrRoute><FinancialYears /></HrRoute></Shell>} />

      <Route path="/salary" element={<Shell><HrRoute><Salary /></HrRoute></Shell>} />
      <Route path="/rate-cards" element={<Shell><HrRoute><RateCards /></HrRoute></Shell>} />
      <Route path="/attendance" element={<Shell><HrRoute><Attendance /></HrRoute></Shell>} />
      <Route path="/cycles" element={<Shell><HrRoute><Cycles /></HrRoute></Shell>} />
      <Route path="/cycles/:cycleId" element={<Shell><HrRoute><CycleDetail /></HrRoute></Shell>} />
      <Route path="/cycles/:cycleId/summary" element={<Shell><HrRoute><CycleSummary /></HrRoute></Shell>} />
      <Route path="/compliance" element={<Shell><HrRoute><Compliance /></HrRoute></Shell>} />
      <Route path="/statutory-portals" element={<Shell><HrRoute><StatutoryPortals /></HrRoute></Shell>} />
      <Route path="/payouts" element={<Shell><HrRoute><Payouts /></HrRoute></Shell>} />
      <Route path="/reports" element={<Shell><HrRoute><Reports /></HrRoute></Shell>} />
      <Route path="/payslips" element={<Shell><HrRoute><AdminPayslips /></HrRoute></Shell>} />
      <Route path="/audit" element={<Shell><AuditRoute><AuditLog /></AuditRoute></Shell>} />

      {/* Payslip View (accessible to authenticated users) */}
      <Route path="/payslips/:cycleId/:employeeId" element={<Shell><Payslip /></Shell>} />

      {/* Every signed-in user manages their own password, whatever their role. */}
      <Route path="/account" element={<Shell><Account /></Shell>} />

      {/* User + role administration. The page renders its own 403 for
          non-admins, and auth-service enforces the same check server-side. */}
      <Route path="/settings" element={<Shell><Settings /></Shell>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
