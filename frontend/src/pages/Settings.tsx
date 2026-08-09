import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Eye, EyeOff, KeyRound, Plus, ShieldCheck, UserX, Users,
} from "lucide-react";
import api from "../lib/api";
import { useAuth } from "../lib/auth";
import { isAdmin } from "../lib/roles";
import { extractErrorMessage } from "../lib/toast";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { Modal, ModalFooter } from "../components/Modal";
import { Skeleton } from "../components/Spinner";
import clsx from "clsx";

const MIN_PASSWORD = 8;

/** Mirrors VALID_ROLES in auth-service routes.py. Kept in the same order the
 *  backend lists them so the two stay easy to diff by eye. */
const ALL_ROLES = [
  "SUPER_ADMIN",
  "ORG_ADMIN",
  "HR_MANAGER",
  "PAYROLL_ADMIN",
  "EMPLOYEE",
  "CLIENT_ADMIN",
  "COMPLIANCE_OFFICER",
  "CLIENT_MANAGER",
] as const;

/** Roles the backend treats as admin (ADMIN_ROLES in routes.py) — these grant
 *  user management, so the UI flags them rather than listing them flat. */
const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN"]);

interface ManagedUser {
  id: string;
  email: string;
  is_active: boolean;
  roles: string[];
}

function RoleChips({
  selected, onToggle, idPrefix,
}: { selected: string[]; onToggle: (r: string) => void; idPrefix: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_ROLES.map((r) => {
        const on = selected.includes(r);
        return (
          <button
            key={r}
            id={`${idPrefix}-${r}`}
            type="button"
            onClick={() => onToggle(r)}
            aria-pressed={on}
            className={clsx(
              "rounded-full border px-2.5 py-1 text-xs transition",
              on
                ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
                : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400",
            )}
          >
            {r.replace(/_/g, " ")}
            {ADMIN_ROLES.has(r) && <span className="ml-1 opacity-60">★</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const admin = isAdmin(user);

  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [roles, setRoles] = useState<string[]>(["EMPLOYEE"]);
  const [formError, setFormError] = useState("");

  const [editingRoles, setEditingRoles] = useState<ManagedUser | null>(null);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);

  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [resetPw, setResetPw] = useState("");

  const users = useQuery({
    queryKey: ["auth", "users"],
    queryFn: async () => (await api.get<ManagedUser[]>("/auth/users")).data,
    enabled: admin,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["auth", "users"] });

  const createMut = useMutation({
    mutationFn: async () => {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error("Enter a valid email address.");
      if (password.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
      if (roles.length === 0) throw new Error("Pick at least one role.");
      await api.post("/auth/users", { email: email.trim(), password, roles });
    },
    onSuccess: () => {
      setCreating(false); setEmail(""); setPassword(""); setRoles(["EMPLOYEE"]); setFormError("");
      invalidate();
    },
    onError: (e) => setFormError(extractErrorMessage(e)),
  });

  const rolesMut = useMutation({
    mutationFn: async () => {
      if (draftRoles.length === 0) throw new Error("Pick at least one role.");
      await api.put(`/auth/users/${editingRoles!.id}/roles`, { roles: draftRoles });
    },
    onSuccess: () => { setEditingRoles(null); setFormError(""); invalidate(); },
    onError: (e) => setFormError(extractErrorMessage(e)),
  });

  const resetMut = useMutation({
    mutationFn: async () => {
      if (resetPw.length < MIN_PASSWORD) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
      await api.post(`/auth/users/${resetting!.id}/password`, { new_password: resetPw });
    },
    onSuccess: () => { setResetting(null); setResetPw(""); setFormError(""); },
    onError: (e) => setFormError(extractErrorMessage(e)),
  });

  const deactivateMut = useMutation({
    mutationFn: async (u: ManagedUser) => { await api.delete(`/auth/users/${u.id}`); },
    onSuccess: invalidate,
    onError: (e) => window.alert(extractErrorMessage(e)),
  });

  if (!admin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Settings" />
        <EmptyState
          title="403 — Admin only"
          description="User management requires an ORG_ADMIN, SUPER_ADMIN, or PAYROLL_ADMIN role."
        />
      </div>
    );
  }

  const toggle = (list: string[], set: (v: string[]) => void) => (r: string) =>
    set(list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Users and roles" />

      <div className="card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <Users className="h-4 w-4" /> Users
          </h3>
          <button className="btn" onClick={() => { setCreating(true); setFormError(""); }}>
            <Plus className="h-4 w-4" /> Add user
          </button>
        </div>

        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Roles marked ★ can manage users. The system always keeps at least one
          active admin — the last one cannot be demoted or deactivated.
        </p>

        {users.isLoading && <Skeleton className="h-24 w-full" />}
        {users.isError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2.5 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {extractErrorMessage(users.error)}
          </div>
        )}

        {users.data && users.data.length === 0 && (
          <EmptyState title="No users" description="Add the first one." />
        )}

        {users.data && users.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Roles</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u, i) => (
                  <tr
                    key={u.id}
                    className="row-in border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-slate-800 dark:text-slate-200">{u.email}</span>
                      {u.id === (user as any)?.user_id && (
                        <span className="ml-2 text-xs text-slate-400">(you)</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span key={r} className="badge">
                            {r.replace(/_/g, " ")}{ADMIN_ROLES.has(r) && " ★"}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={clsx("badge", u.is_active ? "" : "opacity-60")}>
                        {u.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        className="btn-ghost text-xs"
                        title="Change roles"
                        onClick={() => { setEditingRoles(u); setDraftRoles(u.roles); setFormError(""); }}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Roles
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        title="Reset password"
                        onClick={() => { setResetting(u); setResetPw(""); setFormError(""); }}
                      >
                        <KeyRound className="h-3.5 w-3.5" /> Password
                      </button>
                      {u.is_active && (
                        <button
                          className="btn-ghost text-xs text-danger"
                          title="Deactivate"
                          onClick={() => {
                            if (window.confirm(`Deactivate ${u.email}? They will not be able to sign in.`))
                              deactivateMut.mutate(u);
                          }}
                        >
                          <UserX className="h-3.5 w-3.5" /> Disable
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create user ─────────────────────────────────────────────────── */}
      <Modal open={creating} onClose={() => setCreating(false)} title="Add user">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="new-email">Email</label>
            <input id="new-email" className="input" type="email" value={email}
                   onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="new-pw">Temporary password</label>
              <button type="button" onClick={() => setShowPw((v) => !v)}
                      className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400">
                {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
            <input id="new-pw" className="input" type={showPw ? "text" : "password"} value={password}
                   onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              At least {MIN_PASSWORD} characters. Share it with them and have them
              change it from their Account page — there is no email invite flow.
            </p>
          </div>
          <div>
            <span className="label">Roles</span>
            <RoleChips selected={roles} onToggle={toggle(roles, setRoles)} idPrefix="new" />
          </div>
          {formError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2.5 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}
            </div>
          )}
        </div>
        <ModalFooter
          onClose={() => setCreating(false)}
          onSave={() => createMut.mutate()}
          saving={createMut.isPending}
          saveLabel="Create user"
        />
      </Modal>

      {/* ── Edit roles ──────────────────────────────────────────────────── */}
      <Modal open={!!editingRoles} onClose={() => setEditingRoles(null)}
             title={`Roles — ${editingRoles?.email ?? ""}`}>
        <div className="space-y-4">
          <RoleChips selected={draftRoles} onToggle={toggle(draftRoles, setDraftRoles)} idPrefix="edit" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            A role change applies on their next sign-in: existing sessions carry
            their roles inside the token until it expires.
          </p>
          {formError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2.5 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}
            </div>
          )}
        </div>
        <ModalFooter
          onClose={() => setEditingRoles(null)}
          onSave={() => rolesMut.mutate()}
          saving={rolesMut.isPending}
          saveLabel="Save roles"
          disabled={draftRoles.length === 0}
        />
      </Modal>

      {/* ── Reset password ──────────────────────────────────────────────── */}
      <Modal open={!!resetting} onClose={() => setResetting(null)}
             title={`Reset password — ${resetting?.email ?? ""}`}>
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="reset-pw">New password</label>
            <input id="reset-pw" className="input" type={showPw ? "text" : "password"} value={resetPw}
                   onChange={(e) => setResetPw(e.target.value)} autoComplete="new-password" />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              At least {MIN_PASSWORD} characters. Sessions they already have stay
              valid until they expire.
            </p>
          </div>
          {formError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-light px-3 py-2.5 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}
            </div>
          )}
        </div>
        <ModalFooter
          onClose={() => setResetting(null)}
          onSave={() => resetMut.mutate()}
          saving={resetMut.isPending}
          saveLabel="Set password"
          disabled={resetPw.length < MIN_PASSWORD}
        />
      </Modal>
    </div>
  );
}

export default Settings;
