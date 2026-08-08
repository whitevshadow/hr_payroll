import { useState } from "react";
import { KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../lib/auth";
import { extractErrorMessage } from "../lib/toast";
import { PageHeader } from "../components/PageHeader";

const MIN_LENGTH = 8;

/** Mirror of describeLoginError in Login.tsx, for the password-change call. */
function describeError(err: unknown): string {
  const e = err as any;
  if (e?.code === "ERR_NETWORK" || !e?.response) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  const status = e.response.status as number;
  const detail = extractErrorMessage(err);
  if (status === 401) return "Your current password is incorrect.";
  if (status === 422) return detail || `New password must be at least ${MIN_LENGTH} characters.`;
  if (status >= 500) return "The server hit a problem. Try again in a moment.";
  return detail || "Couldn't change the password. Try again.";
}

export function Account() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const sameAsOld = next.length > 0 && next === current;
  const padded = next !== next.trim() && next.trim().length > 0;
  const canSubmit =
    current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !sameAsOld && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await api.post("/auth/users/me/password", {
        current_password: current,
        new_password: next,
      });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function trackCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Account" subtitle="Your sign-in details" />

      <div className="card max-w-xl p-5">
        <div className="mb-4 flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 dark:bg-accent-900/30">
            <ShieldCheck className="h-5 w-5 text-accent-600 dark:text-accent-400" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900 dark:text-slate-100">
              {user?.email ?? "—"}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {(user?.roles ?? []).map((r) => (
                <span key={r} className="badge">{r.replace(/_/g, " ")}</span>
              ))}
            </div>
          </div>
        </div>

        <h3 className="mb-1 flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
          <KeyRound className="h-4 w-4" />
          Change password
        </h3>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Use this to replace a password that was generated at deployment, or that
          you received from an administrator.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="current">Current password</label>
            <input
              id="current"
              className="input"
              type={show ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              autoComplete="current-password"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="next">New password</label>
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                aria-pressed={show}
              >
                {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {show ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="next"
              className="input"
              type={show ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              autoComplete="new-password"
              aria-describedby="next-hint"
            />
            <p id="next-hint" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              At least {MIN_LENGTH} characters.
            </p>
            {tooShort && (
              <p className="mt-1 text-xs text-danger">Too short — {MIN_LENGTH} characters minimum.</p>
            )}
            {sameAsOld && (
              <p className="mt-1 text-xs text-danger">New password must differ from the current one.</p>
            )}
            {padded && (
              <p className="mt-1 text-xs text-warning-dark dark:text-warning">
                Starts or ends with a space — check it pasted cleanly.
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              className="input"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              autoComplete="new-password"
              aria-invalid={mismatch}
            />
            {mismatch && <p className="mt-1 text-xs text-danger">The two passwords don't match.</p>}
          </div>

          {capsLock && (
            <p className="flex items-center gap-1.5 text-xs text-warning-dark dark:text-warning">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Caps Lock is on.
            </p>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2.5 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {done && (
            <div role="status" className="flex items-start gap-2 rounded-lg border border-success/20 bg-success-light px-3 py-2.5 text-sm text-success-dark dark:bg-success/10 dark:text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Password changed. Use it next time you sign in — this session stays
                valid until it expires.
              </span>
            </div>
          )}

          <button type="submit" className="btn" disabled={!canSubmit}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Account;
