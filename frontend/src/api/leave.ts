import api from "../lib/api";

export interface LeavePolicy {
  id: string;
  name: string;
  description: string | null;
  leave_type: string;
  annual_allowance: number;
  max_consecutive_days: number | null;
  requires_document_after_days: number | null;
  is_active: boolean;
  client_id: string | null;
}

export interface LeavePolicyCreate {
  name: string;
  description?: string;
  leave_type: string;
  annual_allowance: number;
  max_consecutive_days?: number;
  requires_document_after_days?: number;
  client_id?: string;
}

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  days: number;
  reason: string;
  financial_year: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  applied_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  created_at: string;
}

export interface LeaveBalance {
  id: string;
  employee_id: string;
  leave_type: string;
  financial_year: string;
  opening_balance: number;
  accrued: number;
  used: number;
  carry_forward_used: number;
  closing_balance: number;
}

export interface LeaveTransaction {
  id: string;
  employee_id: string;
  leave_request_id: string | null;
  leave_type: string;
  financial_year: string;
  transaction_type: "CREDIT" | "DEBIT";
  days: number;
  balance_after: number | null;
  note: string | null;
  created_at: string;
}

export const leaveApi = {
  // Policies
  listPolicies: (params?: { client_id?: string; leave_type?: string }) =>
    api.get<LeavePolicy[]>("/leave/policies", { params }).then((r) => r.data),
  createPolicy: (data: LeavePolicyCreate) =>
    api.post<LeavePolicy>("/leave/policies", data).then((r) => r.data),
  deletePolicy: (policyId: string) =>
    api.delete(`/leave/policies/${policyId}`).then((r) => r.data),

  // Requests
  listRequests: (params?: { employee_id?: string; status?: string; leave_type?: string; financial_year?: string; page?: number; page_size?: number }) =>
    api.get<LeaveRequest[]>("/leave/requests", { params }).then((r) => r.data),
  submitRequest: (data: { employee_id: string; leave_type: string; from_date: string; to_date: string; days: number; reason: string; financial_year?: string }) =>
    api.post<LeaveRequest>("/leave/requests", data).then((r) => r.data),
  approveRequest: (requestId: string, comment?: string) =>
    api.post<LeaveRequest>(`/leave/requests/${requestId}/approve`, { status: "APPROVED", comment }).then((r) => r.data),
  rejectRequest: (requestId: string, comment?: string) =>
    api.post<LeaveRequest>(`/leave/requests/${requestId}/reject`, { status: "REJECTED", comment }).then((r) => r.data),
  cancelRequest: (requestId: string) =>
    api.post<LeaveRequest>(`/leave/requests/${requestId}/cancel`).then((r) => r.data),

  // Balances
  getEmployeeBalances: (employeeId: string, financial_year?: string) =>
    api.get<LeaveBalance[]>(`/leave/balances/${employeeId}`, { params: { financial_year } }).then((r) => r.data),
  listAllBalances: (params?: { financial_year?: string; employee_id?: string; leave_type?: string }) =>
    api.get<LeaveBalance[]>("/leave/balances", { params }).then((r) => r.data),
  initializeBalance: (employeeId: string, leave_type: string, financial_year: string, opening_balance: number) =>
    api.post<LeaveBalance>(`/leave/balances/initialize`, null, { params: { employee_id: employeeId, leave_type, financial_year, opening_balance } }).then((r) => r.data),

  // Transactions
  getTransactions: (employeeId: string, params?: { financial_year?: string; leave_type?: string }) =>
    api.get<LeaveTransaction[]>(`/leave/transactions/${employeeId}`, { params }).then((r) => r.data),
};
