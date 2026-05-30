/**
 * Role helpers — UI-only guard (server is the source of truth).
 */
import type { Me } from "../types";

export type AppRole =
  | "SUPER_ADMIN"
  | "ORG_ADMIN"
  | "HR_MANAGER"
  | "PAYROLL_ADMIN"
  | "EMPLOYEE";

const ADMIN_ROLES: AppRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "PAYROLL_ADMIN"];
const HR_ROLES: AppRole[] = [...ADMIN_ROLES, "HR_MANAGER"];

export function hasRole(user: Me | null | undefined, ...roles: AppRole[]): boolean {
  return !!user && roles.some((r) => user.roles.includes(r));
}

export function canApprove(user: Me | null | undefined): boolean {
  return hasRole(user, ...ADMIN_ROLES);
}

export function canViewAudit(user: Me | null | undefined): boolean {
  // Audit is admin-only — HR_MANAGER is excluded per the role spec.
  return hasRole(user, ...ADMIN_ROLES);
}

export function isEmployeeOnly(user: Me | null | undefined): boolean {
  return !!user && user.roles.length === 1 && user.roles[0] === "EMPLOYEE";
}

export function isAdmin(user: Me | null | undefined): boolean {
  return hasRole(user, ...ADMIN_ROLES);
}
