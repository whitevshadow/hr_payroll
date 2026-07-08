import { useState } from "react";
import { useClientContext } from "../lib/ClientContext";
import { RefreshCcw, Save, Users } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { leaveApi } from "../api/leave";
import { employeesApi } from "../api/employees";
import { PageHeader } from "../components/PageHeader";
import { Modal, ModalFooter } from "../components/Modal";
import { toastService, extractErrorMessage } from "../lib/toast";

export function LeaveBalance() {
  const { selectedClientId } = useClientContext();

  const qc = useQueryClient();
  const [financialYear, setFinancialYear] = useState(() => {
    const today = new Date();
    const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return `${year}-${String(year + 1).slice(-2)}`;
  });
  const [showInitModal, setShowInitModal] = useState(false);

  const employees = useQuery({
    queryKey: ["employees", "all_active"],
    queryFn: () => employeesApi.list({ status: "ACTIVE", page_size: 500 }),
  });

  const balances = useQuery({
    queryKey: ["leave-balances", financialYear],
    queryFn: () => leaveApi.listAllBalances({ financial_year: financialYear }),
  });

  // Group balances by employee
  const groupedBalances = balances.data?.reduce((acc, curr) => {
    if (!acc[curr.employee_id]) acc[curr.employee_id] = [];
    acc[curr.employee_id].push(curr);
    return acc;
  }, {} as Record<string, typeof balances.data>) || {};

  
  if (!selectedClientId) {
    return (
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center mt-6">
        <Users className="h-12 w-12 text-slate-300 mb-4" />
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200">No Client Selected</h2>
        <p className="text-slate-500 mt-2 max-w-sm">Please select a client from the top navigation bar to proceed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Balances Ledger" subtitle="View and manage employee leave balances for the financial year.">
        <div className="flex items-center gap-3">
          <select
            className="input h-9 text-sm"
            value={financialYear}
            onChange={e => setFinancialYear(e.target.value)}
          >
            <option value="2024-25">FY 2024-25</option>
            <option value="2025-26">FY 2025-26</option>
            <option value="2026-27">FY 2026-27</option>
          </select>
          <button className="btn" onClick={() => setShowInitModal(true)}>
            Initialize Balances
          </button>
        </div>
      </PageHeader>

      <div className="card table-card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
              <th className="th">Employee</th>
              <th className="th">Leave Balances (Closing / Allotted)</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {employees.isLoading ? (
              <tr><td colSpan={3} className="td text-center text-slate-500 py-8">Loading...</td></tr>
            ) : employees.data?.items.map(emp => {
              const empBals = groupedBalances[emp.id] || [];
              return (
                <tr key={emp.id} className="tr-hover">
                  <td className="td">
                    <div className="font-semibold text-slate-900 dark:text-white">{emp.first_name} {emp.last_name}</div>
                    <div className="text-xs text-slate-500">{emp.emp_code} • {emp.designation}</div>
                  </td>
                  <td className="td">
                    <div className="flex gap-2 flex-wrap">
                      {empBals.length === 0 ? (
                        <span className="text-xs text-slate-400">No balances initialized</span>
                      ) : (
                        empBals.map(b => (
                          <div key={b.id} className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-xs border border-slate-200 dark:border-slate-700">
                            <span className="font-semibold">{b.leave_type}:</span> {b.closing_balance} / {b.opening_balance + b.accrued}
                          </div>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="td text-right">
                    <button className="btn-ghost-sm text-xs">View Ledger</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showInitModal && (
        <InitBalanceModal 
          financialYear={financialYear} 
          employees={employees.data?.items || []} 
          onClose={() => setShowInitModal(false)} 
        />
      )}
    </div>
  );
}

function InitBalanceModal({ financialYear, employees, onClose }: any) {
  const qc = useQueryClient();
  const [empId, setEmpId] = useState("");
  const [leaveType, setLeaveType] = useState("CASUAL");
  const [opening, setOpening] = useState(0);

  const mut = useMutation({
    mutationFn: () => leaveApi.initializeBalance(empId, leaveType, financialYear, opening),
    onSuccess: () => {
      toastService.success("Balance initialized");
      qc.invalidateQueries({ queryKey: ["leave-balances"] });
      onClose();
    },
    onError: err => toastService.error(extractErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Initialize Leave Balance">
      <div className="space-y-4">
        <div>
          <label className="label">Employee</label>
          <select className="input" value={empId} onChange={e => setEmpId(e.target.value)}>
            <option value="">Select Employee...</option>
            {employees.map((e: any) => (
              <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.emp_code})</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Leave Type</label>
            <select className="input" value={leaveType} onChange={e => setLeaveType(e.target.value)}>
              <option value="CASUAL">Casual</option>
              <option value="SICK">Sick</option>
              <option value="EARNED">Earned</option>
            </select>
          </div>
          <div>
            <label className="label">Opening Balance</label>
            <input type="number" className="input" value={opening} onChange={e => setOpening(Number(e.target.value))} />
          </div>
        </div>
      </div>
      <ModalFooter
        onClose={onClose}
        saving={mut.isPending}
        onSave={() => {
          if (!empId) return toastService.error("Select employee");
          mut.mutate();
        }}
      />
    </Modal>
  );
}
