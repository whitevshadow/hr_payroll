import api from "../lib/api";
import type { EmployeeDocument } from "../types";

export const documentsApi = {
  list: (employeeId: string) => 
    api.get<any>(`/employee-docs/${employeeId}`).then((r) => r.data),
    
  getMissing: (employeeId: string) => 
    api.get<any>(`/employee-docs/${employeeId}/missing`).then((r) => r.data),
    
  getStats: (employeeId: string) => 
    api.get<any>(`/employee-docs/${employeeId}/stats`).then((r) => r.data),
    
  getHistory: (employeeId: string, docLabel?: string) => 
    api.get<EmployeeDocument[]>(`/employee-docs/${employeeId}/history`, { params: { doc_label: docLabel } }).then((r) => r.data),
    
  upload: (employeeId: string, file: File, docCategory: string, docLabel: string, description?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("doc_category", docCategory);
    formData.append("doc_label", docLabel);
    if (description) formData.append("description", description);
    
    return api.post<EmployeeDocument>(`/employee-docs/${employeeId}/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },
  
  verify: (employeeId: string, blobId: string, comment?: string) => 
    api.post<EmployeeDocument>(`/employee-docs/${employeeId}/${blobId}/verify`, { comment }).then((r) => r.data),
    
  reject: (employeeId: string, blobId: string, reason: string) => 
    api.post<EmployeeDocument>(`/employee-docs/${employeeId}/${blobId}/reject`, { reason }).then((r) => r.data),
    
  delete: (employeeId: string, blobId: string) => 
    api.delete(`/employee-docs/${employeeId}/${blobId}`).then((r) => r.data),
};
