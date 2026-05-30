import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "./api";
import type { Me } from "../types";

const TOKEN_KEY = "hrp_token";
let _memToken: string | null = null;

export function getToken(): string | null {
  if (_memToken) return _memToken;
  _memToken = localStorage.getItem(TOKEN_KEY);
  return _memToken;
}
export function setToken(token: string) {
  _memToken = token;
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  _memToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

export const ME_QUERY_KEY = ["me"] as const;

export function useAuth() {
  const qc = useQueryClient();
  const { data: user, isLoading } = useQuery<Me>({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      const { data } = await api.get<Me>("/auth/me");
      return data;
    },
    enabled: !!getToken(),
    retry: false,
    staleTime: Infinity,
  });

  async function login(email: string, password: string) {
    const { data } = await api.post<{ access_token: string }>("/auth/login", {
      email,
      password,
    });
    setToken(data.access_token);
    await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
  }

  function logout() {
    clearToken();
    qc.clear();
  }

  return {
    user,
    isAuthenticated: !!user && !!getToken(),
    isLoading: !!getToken() && isLoading,
    login,
    logout,
  };
}
