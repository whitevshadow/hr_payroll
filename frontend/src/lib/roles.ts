/**
 * Role helpers — UI-only guard (server is the source of truth).
 */
import type { Me } from "../types";

export type AppRole =
  | "SUPER_ADMIN"
  | "ORG_ADMIN"
  | "HR_MANAGER"
  | "PAYROLL_ADMIN"
  | "EMPLOYEE"
  | "CLIENT_ADMIN"
  | "COMPLIANCE_OFFICER"
  | "CLIENT_MANAGER";

const ADMIN_ROLES: AppRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN"];
const HR_ROLES: AppRole[] = [...ADMIN_ROLES, "HR_MANAGER"];

/** Normalise so casing/whitespace drift in a backend role string can't silently
 *  make every check false (which would hide nav and approve buttons with no error). */
function normalised(user: Me | null | undefined): Set<string> {
  return new Set((user?.roles ?? []).map((r) => String(r).trim().toUpperCase()));
}

export function hasRole(user: Me | null | undefined, ...roles: AppRole[]): boolean {
  if (!user) return false;
  const held = normalised(user);
  return roles.some((r) => held.has(r));
}

export function canApprove(user: Me | null | undefined): boolean {
  return hasRole(user, ...ADMIN_ROLES);
}

export function canViewAudit(user: Me | null | undefined): boolean {
  // Audit is admin-only — HR_MANAGER is excluded per the role spec.
  return hasRole(user, ...ADMIN_ROLES);
}

export function isEmployeeOnly(user: Me | null | undefined): boolean {
  const held = normalised(user);
  return !!user && held.size === 1 && held.has("EMPLOYEE");
}

export function isAdmin(user: Me | null | undefined): boolean {
  return hasRole(user, ...ADMIN_ROLES);
}
