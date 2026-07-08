import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Trash2, Plus, Umbrella } from "lucide-react";
import { useClientContext } from "../lib/ClientContext";
import { leavesApi } from "../api/leaves";
import { employeesApi } from "../api/employees";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { Modal, ModalFooter } from "../components/Modal";
import { toastService, extractErrorMessage } from "../lib/toast";
import { format } from "date-fns";
import clsx from "clsx";

export function LeaveManagement() {
  const qc = useQueryClient();
  const { selectedClientId, setSelectedClientId } = useClientContext();
  
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const employees = useQuery({
    queryKey: ["employees", selectedClientId],
    queryFn: () => employeesApi.list({ client_id: selectedClientId || undefined, limit: 1000 }),
    enabled: !!selectedClientId,
  });

  const requests = useQuery({
    queryKey: ["leave-requests", selectedEmployeeId, selectedStatus],
    queryFn: () => leavesApi.getRequests(selectedEmployeeId || undefined, selectedStatus || undefined),
  });

  // Since backend may not filter by client directly for leave requests, 
  // we manually filter them based on the employees belonging to the selected client
  const filteredRequests = useMemo(() => {
    if (!requests.data) return [];
    let list = requests.data;
    
    if (selectedClientId && employees.data?.items) {
      const clientEmpIds = new Set(employees.data.items.map(e => e.id));
      list = list.filter(r => clientEmpIds.has(r.employee_id));
    }
    
    return list;
  }, [requests.data, selectedClientId, employees.data]);

  const approveMut = useMutation({
    mutationFn: leavesApi.approveRequest,
    onSuccess: () => {
      toastService.success("Leave approved");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const rejectMut = useMutation({
    mutationFn: (data: { id: string, reason: string }) => leavesApi.rejectRequest(data.id, data.reason),
    onSuccess: () => {
      toastService.success("Leave rejected");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      setRejectId(null);
      setRejectReason("");
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  const cancelMut = useMutation({
    mutationFn: leavesApi.cancelRequest,
    onSuccess: () => {
      toastService.success("Leave cancelled");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Management" subtitle="Manage and oversee employee leave requests">
        <button className="btn btn-primary" onClick={() => setShowApplyModal(true)}>
          <Plus className="h-4 w-4" /> Apply Leave
        </button>
      </PageHeader>

      <div className="card p-4 flex flex-wrap gap-4 items-end bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-slate-500 uppercase">Employee</label>
          <select
            className="input"
            value={selectedEmployeeId}
            onChange={(e) => setSelectedEmployeeId(e.target.value)}
            disabled={!selectedClientId}
          >
            <option value="">All Employees</option>
            {employees.data?.items.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.first_name} {emp.last_name}</option>
            ))}
          </select>
          {!selectedClientId && <span className="text-[10px] text-slate-400">Select a client first</span>}
        </div>

        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
          <select
            className="input"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {requests.isLoading ? (
        <div className="card h-40 animate-pulse bg-slate-50 dark:bg-slate-800/50" />
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title="No leave requests found"
          description="There are no leave requests matching your filters."
          icon={Umbrella}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-500">
                  <th className="p-4">Employee</th>
                  <th className="p-4">Dates</th>
                  <th className="p-4">Reason</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRequests.map((req) => {
                  const emp = employees.data?.items.find(e => e.id === req.employee_id);
                  return (
                    <tr key={req.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                      <td className="p-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {emp ? `${emp.first_name} ${emp.last_name}` : req.employee_id}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-sm">
                          {format(new Date(req.start_date), "MMM d, yyyy")} - {format(new Date(req.end_date), "MMM d, yyyy")}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {req.days} day(s)
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-sm max-w-[200px] truncate" title={req.reason}>
                          {req.reason}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={clsx(
                          "px-2 py-1 rounded-full text-xs font-medium",
                          req.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                          req.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                          req.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-700'
                        )}>
                          {req.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {req.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => approveMut.mutate(req.id)}
                                disabled={approveMut.isPending}
                                className="btn btn-sm btn-ghost text-emerald-600 hover:text-emerald-700"
                                title="Approve"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => setRejectId(req.id)}
                                className="btn btn-sm btn-ghost text-red-600 hover:text-red-700"
                                title="Reject"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {req.status === 'APPROVED' && (
                             <button
                               onClick={() => {
                                 if (confirm("Are you sure you want to cancel this approved leave?")) {
                                   cancelMut.mutate(req.id);
                                 }
                               }}
                               disabled={cancelMut.isPending}
                               className="btn btn-sm btn-ghost text-amber-600 hover:text-amber-700"
                               title="Cancel Leave"
                             >
                               <Trash2 className="h-4 w-4" />
                             </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showApplyModal && (
        <ApplyLeaveModal
          onClose={() => setShowApplyModal(false)}
          employees={employees.data?.items || []}
        />
      )}

      {rejectId && (
        <Modal open onClose={() => { setRejectId(null); setRejectReason(""); }} title="Reject Leave Request">
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Please provide a reason for rejecting this leave request.</p>
            <div>
              <label className="label">Rejection Reason</label>
              <textarea
                className="input"
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="e.g. Critical project deadline..."
              />
            </div>
          </div>
          <ModalFooter
            onClose={() => { setRejectId(null); setRejectReason(""); }}
            saving={rejectMut.isPending}
            onSave={() => {
              if (!rejectReason.trim()) return toastService.error("Please provide a reason");
              rejectMut.mutate({ id: rejectId, reason: rejectReason });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function ApplyLeaveModal({ onClose, employees }: { onClose: () => void, employees: any[] }) {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const policies = useQuery({
    queryKey: ["leave-policies"],
    queryFn: () => leavesApi.getPolicies(),
  });

  const mut = useMutation({
    mutationFn: leavesApi.createRequest,
    onSuccess: () => {
      toastService.success("Leave applied successfully");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      onClose();
    },
    onError: (err) => toastService.error(extractErrorMessage(err)),
  });

  return (
    <Modal open onClose={onClose} title="Apply Leave">
      <div className="space-y-4">
        <div>
          <label className="label">Employee</label>
          <select className="input" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">Select Employee</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Leave Policy</label>
          <select className="input" value={policyId} onChange={e => setPolicyId(e.target.value)}>
            <option value="">Select Policy</option>
            {policies.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Start Date</label>
            <input type="date" className="input" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">End Date</label>
            <input type="date" className="input" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Reason</label>
          <textarea className="input" rows={2} value={reason} onChange={e => setReason(e.target.value)} />
        </div>
      </div>
      <ModalFooter
        onClose={onClose}
        saving={mut.isPending}
        onSave={() => {
          if (!employeeId || !policyId || !startDate || !endDate || !reason) {
            return toastService.error("Please fill all required fields");
          }
          mut.mutate({
            employee_id: employeeId,
            policy_id: policyId,
            start_date: startDate,
            end_date: endDate,
            reason
          });
        }}
      />
    </Modal>
  );
}
