import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type Permission } from "./permissions";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
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
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission declared: AdminGuard has already established admin status.
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const admin = request.admin;

    if (!admin || !admin.isActive) {
      throw new ForbiddenException({
        success: false,
        error: { code: "ADMIN_REQUIRED", message: "Admin access required" },
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
