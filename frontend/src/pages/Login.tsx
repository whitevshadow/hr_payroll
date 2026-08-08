import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { extractErrorMessage } from "../lib/toast";
import api from "../lib/api";
import { setToken } from "../lib/auth";
import { queryClient } from "../lib/queryClient";
import { ME_QUERY_KEY } from "../lib/auth";
import { Zap, Mail, Lock, Building2, AlertCircle, ArrowRight, Eye, EyeOff } from "lucide-react";

/** Turn a failed sign-in into something the user can act on.
 *
 * The API answers a bad email and a bad password with the same 401 on purpose
 * (see auth-service routes.login): distinguishing them would let anyone test
 * which addresses have accounts here. So the credentials case stays deliberately
 * vague, and the cases that *are* safe to name — a disabled account, a network
 * failure, a server fault — get told apart instead. */
function describeLoginError(err: unknown): string {
  const e = err as any;
  if (e?.code === "ERR_NETWORK" || !e?.response) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  const status = e.response.status as number;
  const detail = extractErrorMessage(err);
  if (status === 401) {
    return "That email and password don't match. Check both and try again.";
  }
  if (status === 403) {
    return /disabled/i.test(detail)
      ? "This account has been disabled. Ask your administrator to re-enable it."
      : detail;
  }
  if (status === 422) return "Enter a valid email address and your password.";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  if (status >= 500) return "The server hit a problem. Try again in a moment.";
  return detail || "Sign in failed. Try again.";
}

export function Login() {
  const { isAuthenticated } = useAuth();
  const nav = useNavigate();
  // Empty, not the seed script's demo credentials: pre-filling them means a
  // real deployment's login box already contains a password, and editing only
  // the email submits the stale one — which fails as "Invalid email or
  // password" with no hint that the password field was never actually changed.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [touched, setTouched] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const emailInvalid = touched && !/^\S+@\S+\.\S+$/.test(email.trim());
  const passwordMissing = touched && password.length === 0;
  // Pasting a credential very easily picks up a surrounding space. The server
  // compares the password byte-for-byte, so this reads as "wrong password" with
  // nothing on screen to show why.
  const padded = password !== password.trim() && password.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || password.length === 0) return;

    setBusy(true);
    try {
      const { data } = await api.post<{ access_token: string }>("/auth/login", {
        email: email.trim(),
        password,
      });
      setToken(data.access_token);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      nav("/");
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setBusy(false);
    }
  }

  /** Caps Lock is the single most common reason a correct password is typed
   *  wrong, and the masked field gives no clue. Read it off any key event. */
  function trackCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  return (
    <div className="flex min-h-app-screen bg-slate-50 dark:bg-slate-950">
      {/* Left — Brand Panel */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-accent-800 to-accent-900 p-12">
        {/* Background mesh */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" />
          <div className="absolute bottom-16 -left-16 h-72 w-72 rounded-full bg-tertiary-500/15 blur-3xl" />
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
              { label: "Compliance Ready", value: "PF · ESI · PT" },
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-700">
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
              Welcome back
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Sign in to your account to continue
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">

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
                  autoFocus
                  aria-invalid={emailInvalid}
                  aria-describedby={emailInvalid ? "email-error" : undefined}
                />
              </div>
              {emailInvalid && (
                <p id="email-error" className="mt-1.5 text-xs text-danger">
                  {email.trim() ? "That doesn't look like an email address." : "Enter your email address."}
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  className="input pl-9 pr-11"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={trackCapsLock}
                  onKeyDown={trackCapsLock}
                  onBlur={() => setCapsLock(false)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={passwordMissing}
                  aria-describedby={passwordMissing ? "password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {passwordMissing && (
                <p id="password-error" className="mt-1.5 text-xs text-danger">
                  Enter your password.
                </p>
              )}
              {capsLock && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning-dark dark:text-warning">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Caps Lock is on.
                </p>
              )}
              {padded && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning-dark dark:text-warning">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  Your password starts or ends with a space — check it pasted cleanly.
                </p>
              )}
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
                  Sign in
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
