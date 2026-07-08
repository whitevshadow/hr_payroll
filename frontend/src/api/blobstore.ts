import api from "../lib/api";

export const blobstoreApi = {
  upload: (file: File, docType: string, employeeId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("doc_type", docType);
    if (employeeId) {
      formData.append("employee_id", employeeId);
    }
    
    return api.post<any>("/blobs/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },

  downloadUrl: (blobId: string) => `/api/v1/blobs/${blobId}`,
  
  getPresignedUrl: (blobId: string, inline: boolean = false) =>
    api.get<{url: string}>(`/blobs/${blobId}/url`, { params: { inline } }).then(r => r.data),
  
  delete: (blobId: string) => api.delete(`/blobs/${blobId}`).then((r) => r.data),
};
