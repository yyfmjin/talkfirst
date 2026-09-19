import { SetMetadata } from "@nestjs/common";
import type { Permission } from "./permissions";

export const PERMISSION_METADATA_KEY = "admin:required-permission";

/**
 * Declares the permission an admin endpoint requires, e.g.
 *
 *   @RequirePermission("users:write")
 *
 * Enforced by `PermissionGuard`. A handler without this decorator is treated as
 * "no specific permission required" by the guard, but every admin route should
 * still declare one explicitly so intent is visible at the call site.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);
