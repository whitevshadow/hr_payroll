import api from "../lib/api";
import type {
  Client,
  ClientCreate,
  ClientUpdate,
  ClientPage,
  ClientCredential,
  CredentialReveal,
  ClientDocument,
} from "../types";

export interface ClientListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
}

export interface CredentialUpsert {
  portal_type: "PF" | "ESIC" | "GST";
  portal_name?: string;
  username?: string;
  password?: string;
}

export const clientsApi = {
  list: (params: ClientListParams = {}) =>
    api.get<ClientPage>("/clients", { params }).then((r) => r.data),

  get: (id: string) =>
    api.get<Client>(`/clients/${id}`).then((r) => r.data),

  create: (body: ClientCreate) =>
    api.post<Client>("/clients", body).then((r) => r.data),

  update: (id: string, body: ClientUpdate) =>
    api.put<Client>(`/clients/${id}`, body).then((r) => r.data),

  archive: (id: string) =>
    api.post<Client>(`/clients/${id}/archive`).then((r) => r.data),

  unarchive: (id: string) =>
    api.post<Client>(`/clients/${id}/unarchive`).then((r) => r.data),

  delete: (id: string) =>
    api.delete(`/clients/${id}`).then((r) => r.data),

  /** List credentials — passwords masked (has_password boolean only). */
  listCredentials: (clientId: string) =>
    api.get<ClientCredential[]>(`/clients/${clientId}/credentials`).then((r) => r.data),

  /** Create or update a portal credential (password encrypted on server). */
  upsertCredential: (clientId: string, body: CredentialUpsert) =>
    api.post<ClientCredential>(`/clients/${clientId}/credentials`, body).then((r) => r.data),

  /** Reveal decrypted password — audited, use sparingly. */
  revealCredential: (clientId: string, credId: string) =>
    api
      .post<CredentialReveal>(`/clients/${clientId}/credentials/${credId}/reveal`)
      .then((r) => r.data),

  /** Rotate (replace) a credential's password. */
  rotateCredential: (clientId: string, credId: string, body: CredentialUpsert) =>
    api
      .post<ClientCredential>(`/clients/${clientId}/credentials/${credId}/rotate`, body)
      .then((r) => r.data),

  // Documents
  listDocuments: (clientId: string, category?: string) =>
    api.get<ClientDocument[]>(`/clients/${clientId}/documents`, { params: { doc_category: category } }).then((r) => r.data),

  createDocument: (clientId: string, body: { blob_id: string; doc_category: string; doc_label: string; description?: string; expiry_date?: string }) =>
    api.post<ClientDocument>(`/clients/${clientId}/documents`, body).then((r) => r.data),

  verifyDocument: (clientId: string, docId: string, status: "APPROVED" | "REJECTED", comment?: string) =>
    api.patch<ClientDocument>(`/clients/${clientId}/documents/${docId}/verify`, { status, comment }).then((r) => r.data),
};
