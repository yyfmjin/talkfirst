import { SetMetadata } from "@nestjs/common";

export const ADMIN_PUBLIC_METADATA_KEY = "admin:public";

/**
 * FIX (audit P006) — an explicit, auditable opt-out from the permission gate.
 *
 * `PermissionGuard` used to treat "no `@RequirePermission` declared" as
 * "allowed". That is fail-open: adding an admin route and forgetting the
 * decorator silently exposed it to every admin role, and nothing anywhere would
 * say so. The gate is now fail-closed, and a route that genuinely needs no
 * *specific* permission has to say so here, in the open, with a reason.
 *
 * Exactly one route uses it today: `GET /admin/me`, which returns the caller's
 * own identity and permissions. It still passes `JwtAuthGuard` + `AdminGuard`,
 * so only an authenticated, active administrator can reach it — it simply does
 * not require a *capability*.
 */
export const AdminPublic = () => SetMetadata(ADMIN_PUBLIC_METADATA_KEY, true);
