import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type Permission } from "./permissions";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { ADMIN_PUBLIC_METADATA_KEY } from "./admin-public.decorator";
import type { AdminRequest } from "./admin.guard";

/**
 * Phase A: enforces `@RequirePermission(...)`.
 *
 * Runs AFTER `AdminGuard`, which is responsible for establishing identity
 * ("is this an active admin?") and attaching `request.admin`. This guard only
 * answers "does that admin's role grant the required permission?".
 *
 * Deliberately returns 403 (not 401) — the caller is authenticated and is an
 * admin, they simply lack the privilege.
 *
 * ## Fail-closed (FIX, audit P006)
 *
 * This guard previously returned `true` when no permission was declared, which
 * is fail-open: a new admin route that forgot `@RequirePermission` was silently
 * available to every role, including read-only ones. The default is now DENY,
 * and the only way past it is an explicit `@AdminPublic()` — so the exception is
 * visible in the route's own decorators and in review, and a forgotten
 * decorator fails loudly the first time the route is called.
 *
 * `assertEveryAdminRouteIsGated()` (see `admin-route-audit.ts`) additionally
 * refuses to boot if any handler under `@Controller("admin")` declares neither,
 * which turns a per-request 403 into a startup failure.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(ADMIN_PUBLIC_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const admin = request.admin;

    if (!admin || !admin.isActive) {
      throw new ForbiddenException({
        success: false,
        error: { code: "ADMIN_REQUIRED", message: "Admin access required" },
      });
    }

    // No permission and not explicitly public: refuse rather than allow.
    if (!required) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "PERMISSION_UNDECLARED",
          message: "This admin route declares no permission and is not marked @AdminPublic()",
        },
      });
    }

    if (!hasPermission(admin.role, required)) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "PERMISSION_DENIED",
          message: `Your role (${admin.role}) is not allowed to perform this action`,
        },
      });
    }

    return true;
  }
}
