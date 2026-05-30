import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { extractErrorMessage } from "../lib/toast";
import api from "../lib/api";
import { setToken } from "../lib/auth";
import { queryClient } from "../lib/queryClient";
import { ME_QUERY_KEY } from "../lib/auth";
import { Zap, Mail, Lock, Building2, AlertCircle, ArrowRight } from "lucide-react";

export function Login() {
  const { isAuthenticated } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("admin@demo.com");
  const [password, setPassword] = useState("Admin@123");
  const [tenantName, setTenantName] = useState("Demo Corp");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let token: string;
      if (tab === "login") {
        const { data } = await api.post<{ access_token: string }>("/auth/login", { email, password });
        token = data.access_token;
      } else {
        const { data } = await api.post<{ access_token: string }>("/auth/register", {
          tenant_name: tenantName,
          email,
          password,
        });
        token = data.access_token;
      }
      setToken(token);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      nav("/");
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg === "Invalid credentials" ? "Invalid email or password." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Left — Brand Panel */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-accent-900 to-violet-900 p-12">
        {/* Background mesh */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" />
          <div className="absolute bottom-16 -left-16 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="absolute top-1/2 right-1/4 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">PeopleOS</div>
              <div className="text-xs text-white/50 uppercase tracking-wider">HR & Payroll</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              Enterprise HR,
              <br />
              <span className="text-accent-300">Simplified.</span>
            </h1>
            <p className="mt-4 text-lg text-white/60 leading-relaxed">
              Manage payroll, compliance, attendance, and your entire workforce from a single, modern platform.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Payroll Accuracy", value: "99.9%" },
              { label: "Compliance Ready", value: "PF · ESI · TDS" },
              { label: "Processing Time", value: "< 30 min" },
              { label: "Multi-tenant", value: "Enterprise" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl bg-white/8 border border-white/10 px-4 py-3 backdrop-blur-sm"
              >
                <div className="text-lg font-bold text-white">{stat.value}</div>
                <div className="text-xs text-white/50 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/30">
          © 2026 PeopleOS. Enterprise HR & Payroll Platform.
        </div>
      </div>

      {/* Right — Auth Form */}
      <div className="flex flex-1 flex-col items-center justify-center p-8">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-violet-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-slate-100">PeopleOS</div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {tab === "login" ? "Welcome back" : "Create organisation"}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {tab === "login"
                ? "Sign in to your account to continue"
                : "Set up your HR & Payroll workspace"}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="mb-6 flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-1">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                  tab === t
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {t === "login" ? "Sign in" : "Register org"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {tab === "register" && (
              <div>
                <label className="label" htmlFor="tenant">
                  Organisation name
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="tenant"
                    className="input pl-9"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder="Acme Inc."
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  className="input pl-9"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@company.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  className="input pl-9"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-light dark:bg-danger/10 border border-danger/20 px-3 py-2.5 text-sm text-danger-dark dark:text-danger">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button type="submit" className="btn w-full" disabled={busy}>
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Please wait…
                </>
              ) : (
                <>
                  {tab === "login" ? "Sign in" : "Create workspace"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {import.meta.env.DEV && (
            <p className="mt-6 text-center text-xs text-slate-400">
              Demo credentials: admin@demo.com / Admin@123
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
