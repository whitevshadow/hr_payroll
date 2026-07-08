import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ClientProvider } from "./lib/ClientContext";
import { ProtectedRoute } from "./layout/ProtectedRoute";
import { useAuth } from "./lib/auth";
import { canViewAudit } from "./lib/roles";
import { EmptyState } from "./components/EmptyState";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Employees } from "./pages/Employees";
import { EmployeeDetail } from "./pages/EmployeeDetail";
import { Departments } from "./pages/Departments";
import { Salary } from "./pages/Salary";
import { Attendance } from "./pages/Attendance";
import { Cycles } from "./pages/Cycles";
import { CycleDetail } from "./pages/CycleDetail";
import { CycleSummary } from "./pages/CycleSummary";
import { Compliance } from "./pages/Compliance";
import { TDS } from "./pages/TDS";
import { Payouts } from "./pages/Payouts";
import { Reports } from "./pages/Reports";
import { Payslip } from "./pages/Payslip";
import { AuditLog } from "./pages/AuditLog";
import { Clients } from "./pages/Clients";
import { Leave } from "./pages/Leave";
import { LeaveBalance } from "./pages/LeaveBalance";
import { Locations } from "./pages/Locations";
import { FinancialYears } from "./pages/FinancialYears";
import { ClientDashboard } from "./pages/ClientDashboard";
import { LeaveManagement } from "./pages/LeaveManagement";
import { AdminPayslips } from "./pages/AdminPayslips";

function Shell({ children }: { children: React.ReactElement }) {
  return (
    <ProtectedRoute>
      <ClientProvider>
        <AppShell>{children}</AppShell>
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

/** Gate a route for HR+ roles. */
function HrRoute({ children }: { children: React.ReactElement }) {
  // If there are specific roles, check them here.
  // For now, all authenticated users are admin.
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
      <Route path="/clients" element={<Shell><HrRoute><Clients /></HrRoute></Shell>} />
      <Route path="/clients/:id" element={<Shell><HrRoute><ClientDashboard /></HrRoute></Shell>} />
      <Route path="/locations" element={<Shell><HrRoute><Locations /></HrRoute></Shell>} />
      <Route path="/financial-years" element={<Shell><HrRoute><FinancialYears /></HrRoute></Shell>} />
      <Route path="/leave" element={<Shell><HrRoute><Leave /></HrRoute></Shell>} />
      <Route path="/leave-management" element={<Shell><HrRoute><LeaveManagement /></HrRoute></Shell>} />
      <Route path="/leave-balance" element={<Shell><HrRoute><LeaveBalance /></HrRoute></Shell>} />
      <Route path="/salary" element={<Shell><HrRoute><Salary /></HrRoute></Shell>} />
      <Route path="/attendance" element={<Shell><HrRoute><Attendance /></HrRoute></Shell>} />
      <Route path="/cycles" element={<Shell><HrRoute><Cycles /></HrRoute></Shell>} />
      <Route path="/cycles/:cycleId" element={<Shell><HrRoute><CycleDetail /></HrRoute></Shell>} />
      <Route path="/cycles/:cycleId/summary" element={<Shell><HrRoute><CycleSummary /></HrRoute></Shell>} />
      <Route path="/compliance" element={<Shell><HrRoute><Compliance /></HrRoute></Shell>} />
      <Route path="/tds" element={<Shell><HrRoute><TDS /></HrRoute></Shell>} />
      <Route path="/payouts" element={<Shell><HrRoute><Payouts /></HrRoute></Shell>} />
      <Route path="/reports" element={<Shell><HrRoute><Reports /></HrRoute></Shell>} />
      <Route path="/payslips" element={<Shell><HrRoute><AdminPayslips /></HrRoute></Shell>} />
      <Route path="/audit" element={<Shell><AuditRoute><AuditLog /></AuditRoute></Shell>} />

      {/* Payslip View (accessible to authenticated users) */}
      <Route path="/payslips/:cycleId/:employeeId" element={<Shell><Payslip /></Shell>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
