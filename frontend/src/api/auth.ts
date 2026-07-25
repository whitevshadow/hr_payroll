import api from "../lib/api";
import type { Me } from "../types";

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<{ access_token: string }>("/auth/login", { email, password })
      .then((r) => r.data),

  register: (tenantName: string, email: string, password: string) =>
    api
      .post<{ access_token: string }>("/auth/register", {
        tenant_name: tenantName,
        email,
        password,
      })
      .then((r) => r.data),

  me: () => api.get<Me>("/auth/me").then((r) => r.data),
};
