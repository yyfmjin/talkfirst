import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AdminRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** The resolved admin identity attached to the request by `AdminGuard`. */
export type ResolvedAdmin = {
  /** User.id */
  userId: string;
  /** AdminUser.id, or null when running on the isAdmin compatibility fallback. */
  adminUserId: string | null;
  role: AdminRole;
  isActive: boolean;
  /** True when this admin was resolved via `User.isAdmin` with no AdminUser row. */
  legacy: boolean;
};

export type AdminRequest = {
  user?: { id: string };
  admin?: ResolvedAdmin;
};

/**
 * Phase A: establishes that the caller is an administrator.
 *
 * Responsibilities are deliberately narrow — identity only:
 *   1. authenticated user exists
 *   2. user is an active administrator
 *   3. attach the resolved role to the request for `PermissionGuard`
 *
 * It does NOT decide what the admin may do. That is `PermissionGuard`'s job.
 *
 * Resolution order:
 *   JWT user -> User exists -> AdminUser row -> isActive -> role
 *
 * `User.isAdmin` is retained as a compatibility fallback: an account flagged
 * isAdmin but not yet migrated to an AdminUser row still gets in, treated as
 * SUPER_ADMIN (matching the Phase A backfill policy so no existing admin loses
 * access). Once every admin has a profile this fallback is inert.
 *
 * Note: a normal user cannot self-grant either path — `isAdmin` and `AdminUser`
 * are never writable from the user-facing API.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        success: false,
        error: { code: "ADMIN_REQUIRED", message: "Admin access required" },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isAdmin: true,
        status: true,
        adminUser: { select: { id: true, role: true, isActive: true } },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new ForbiddenException({
        success: false,
        error: { code: "ADMIN_REQUIRED", message: "Admin access required" },
      });
    }

    // Preferred path: a real RBAC profile.
    if (user.adminUser) {
      if (!user.adminUser.isActive) {
        // Soft-disabled admin: explicitly rejected even though isAdmin may be true.
        throw new ForbiddenException({
          success: false,
          error: { code: "ADMIN_INACTIVE", message: "This admin account is disabled" },
        });
      }
      request.admin = {
        userId,
        adminUserId: user.adminUser.id,
        role: user.adminUser.role,
        isActive: true,
        legacy: false,
      };
      return true;
    }

    // Compatibility fallback: flagged admin without a profile row yet.
    if (user.isAdmin) {
      request.admin = {
        userId,
        adminUserId: null,
        role: "SUPER_ADMIN",
        isActive: true,
        legacy: true,
      };
      return true;
    }

    throw new ForbiddenException({
      success: false,
      error: { code: "ADMIN_REQUIRED", message: "Admin access required" },
    });
  }
}
