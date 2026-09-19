import type { AdminRole } from "@prisma/client";

/**
 * Phase A: static admin permission matrix.
 *
 * This is the single source of truth for "which role may do what". It is
 * deliberately a TypeScript constant rather than database tables: the five
 * roles are fixed and the matrix is small, so `AdminPermission` /
 * `AdminRolePermission` would add three tables and a join per request for no
 * current benefit. If a genuine need appears for per-person extra grants, this
 * can graduate to DB-driven permissions without changing the call sites —
 * `hasPermission()` stays the only entry point.
 */

export const PERMISSIONS = [
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

  "settings:read",
  "settings:write",

  "admins:read",
  "admins:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role -> granted permissions.
 *
 * Reading guide:
 *   SUPER_ADMIN     everything
 *   MODERATOR       moderation + user handling, but no settings/admins/exchange/block writes
 *   SUPPORT         view users + basic account handling; cannot ban
 *   ANALYST         read-only across the board; no write anywhere
 *   CONTENT_MANAGER content moderation only
 */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,

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

  SUPPORT: [
    "dashboard:read",
    "users:read",
    "users:write",
    "reports:read",
    "audit:read",
  ],

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

/** Does `role` hold `permission`? */
export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Full permission list for a role — used by `GET /admin/me`. */
export function permissionsForRole(role: AdminRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

/**
 * Which user statuses each role is allowed to set.
 *
 * This is a separate axis from `users:write`. Having the permission to modify a
 * user does not mean being allowed to permanently ban them:
 *   - SUPPORT may only disable/enable (basic account handling).
 *   - MODERATOR may temporarily suspend, but never permanently ban.
 *   - SUPER_ADMIN may do anything, including permanent bans.
 */
export const ROLE_ALLOWED_STATUS_ACTIONS: Record<
  AdminRole,
  readonly UserStatusAction[]
> = {
  SUPER_ADMIN: ["activate", "disable", "ban", "suspend", "unban"],
  MODERATOR: ["activate", "disable", "suspend", "unban"],
  SUPPORT: ["activate", "disable"],
  ANALYST: [],
  CONTENT_MANAGER: [],
};

export type UserStatusAction = "activate" | "disable" | "ban" | "suspend" | "unban";

/** May `role` perform `action` on a user's status? */
export function canSetUserStatus(role: AdminRole, action: UserStatusAction): boolean {
  return ROLE_ALLOWED_STATUS_ACTIONS[role]?.includes(action) ?? false;
}
