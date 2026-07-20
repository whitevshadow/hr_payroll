import axios from "axios";
import { getToken, clearToken } from "./auth";

// Default to a same-origin relative path: nginx proxies /api/ to the gateway,
// so the built bundle works on any host. Override with VITE_API_BASE for local
// dev against a gateway on a different origin. An empty value counts as unset.
const _configuredBase = (import.meta as any).env?.VITE_API_BASE as string | undefined;
export const BASE = _configuredBase && _configuredBase.length > 0 ? _configuredBase : "/api/v1";

export const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Attach the globally selected client, but never clobber a client id a
  // caller set explicitly for one request (e.g. a cycle's own client).
  const clientId = localStorage.getItem("hr_selected_client_id");
  if (clientId && !config.headers["x-client-id"]) {
    config.headers["x-client-id"] = clientId;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      clearToken();
      // Only navigate if we're not already on login to avoid infinite redirect.
      if (!window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

export default api;
