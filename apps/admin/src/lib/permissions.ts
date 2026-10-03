/**
 * Front-end mirror of the backend permission matrix
 * (`apps/api/src/admin/permissions.ts`).
 *
 * IMPORTANT: this is a UX aid only — it hides navigation and buttons so admins
 * are not shown actions they cannot perform. It is NOT a security boundary. The
 * backend re-checks every request; a hand-crafted call that skips this file will
 * still be rejected with 403.
 *
 * The role union is declared locally rather than imported from Prisma so the
 * browser bundle never pulls in generated database types.
 */

export type AdminRole =
  | "SUPER_ADMIN"
  | "MODERATOR"
  | "SUPPORT"
  | "ANALYST"
  | "CONTENT_MANAGER";

export type Permission =
  | "dashboard:read"
  | "users:read"
  | "users:write"
  | "reports:read"
  | "reports:write"
  | "moderation:read"
  | "moderation:write"
  | "risk:read"
  | "connections:read"
  | "connections:write"
  | "exchanges:read"
  | "exchanges:write"
  | "blocks:read"
  | "blocks:write"
  | "audit:read"
  | "audit:export"
  /** Phase O2 — site operations (HTTP access logs). Carries raw IP / UA. */
  | "ops:read"
  | "settings:read"
  | "settings:write"
  | "admins:read"
  | "admins:write";

const ALL: readonly Permission[] = [
  "dashboard:read",
  "users:read",
  "users:write",
  "reports:read",
  "reports:write",
  "moderation:read",
  "moderation:write",
  "risk:read",
  "connections:read",
  "connections:write",
  "exchanges:read",
  "exchanges:write",
  "blocks:read",
  "blocks:write",
  "audit:read",
  "audit:export",
  "ops:read",
  "settings:read",
  "settings:write",
  "admins:read",
  "admins:write",
];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  MODERATOR: [
    "dashboard:read",
    "users:read",
    "users:write",
    "reports:read",
    "reports:write",
    "moderation:read",
    "moderation:write",
    "risk:read",
    "audit:read",
  ],
  SUPPORT: ["dashboard:read", "users:read", "users:write", "reports:read", "audit:read"],
  ANALYST: [
    "dashboard:read",
    "users:read",
    "reports:read",
    "risk:read",
    "connections:read",
    "exchanges:read",
    "blocks:read",
    "audit:read",
    "settings:read",
    // Phase O2: mirrors the backend — ANALYST is the only non-super role allowed
    // to read raw access-log data (IP / User-Agent).
    "ops:read",
  ],
  CONTENT_MANAGER: [
    "dashboard:read",
    "users:read",
    "reports:read",
    "moderation:read",
    "moderation:write",
    "audit:read",
  ],
};

/** Which status actions each role may perform — mirrors the backend. */
export const ROLE_ALLOWED_STATUS_ACTIONS: Record<AdminRole, readonly string[]> = {
  SUPER_ADMIN: ["activate", "disable", "ban", "suspend", "unban"],
  MODERATOR: ["activate", "disable", "suspend", "unban"],
  SUPPORT: ["activate", "disable"],
  ANALYST: [],
  CONTENT_MANAGER: [],
};

/** Role labels for the console chrome. */
export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "超级管理员",
  MODERATOR: "审核员",
  SUPPORT: "客服",
  ANALYST: "分析师",
  CONTENT_MANAGER: "内容管理员",
};

export function hasPermission(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canSetUserStatus(role: AdminRole | null | undefined, action: string): boolean {
  if (!role) return false;
  return ROLE_ALLOWED_STATUS_ACTIONS[role]?.includes(action) ?? false;
}
