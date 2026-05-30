import { Navigate } from "react-router-dom";
import { getToken } from "../lib/auth";
import { FullPageSpinner } from "../components/Spinner";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const token = getToken();
  const { user, isLoading } = useAuth();

  // No token at all — redirect immediately.
  if (!token) return <Navigate to="/login" replace />;

  // Token exists but /me hasn't resolved yet.
  if (isLoading) return <FullPageSpinner />;

  // /me resolved but failed (token invalid) — interceptor already redirects.
  if (!user) return <Navigate to="/login" replace />;

  return children;
}
