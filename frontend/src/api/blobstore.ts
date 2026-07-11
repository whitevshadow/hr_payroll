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

  // NOTE: no getPresignedUrl here on purpose. Presigned URLs point straight at
  // MinIO, which publishes no host port — the browser would not be able to
  // reach them. Download blobs through the gateway instead (downloadUrl above,
  // or api.get(`/blobs/${id}`, { responseType: "blob" })).

  delete: (blobId: string) => api.delete(`/blobs/${blobId}`).then((r) => r.data),
};
