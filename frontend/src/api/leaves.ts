import api from "../lib/api";
import type { LeavePolicy, LeaveBalance, LeaveRequest } from "../types";

export const leavesApi = {
  getPolicies: () => api.get<LeavePolicy[]>("/leaves/policies").then((r) => r.data),
  createPolicy: (body: Partial<LeavePolicy>) => api.post<LeavePolicy>("/leaves/policies", body).then((r) => r.data),
  
  getBalances: (employeeId: string, financialYear: string) => 
    api.get<LeaveBalance[]>(`/leaves/balances/${employeeId}/${financialYear}`).then((r) => r.data),
    
  getRequests: (employeeId?: string, status?: string) => 
    api.get<LeaveRequest[]>("/leaves/requests", { params: { employee_id: employeeId, status } }).then((r) => r.data),
    
  createRequest: (body: { employee_id: string; policy_id: string; start_date: string; end_date: string; reason: string; document_id?: string }) => 
    api.post<LeaveRequest>("/leaves/requests", body).then((r) => r.data),
    
  approveRequest: (requestId: string) => api.post<LeaveRequest>(`/leaves/requests/${requestId}/approve`).then((r) => r.data),
  rejectRequest: (requestId: string, reason: string) => api.post<LeaveRequest>(`/leaves/requests/${requestId}/reject`, { reason }).then((r) => r.data),
  cancelRequest: (requestId: string) => api.post<LeaveRequest>(`/leaves/requests/${requestId}/cancel`).then((r) => r.data),
};
