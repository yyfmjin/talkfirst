import { ForbiddenException, BadRequestException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { AdminRole } from "@prisma/client";

import { AdminGuard, type AdminRequest, type ResolvedAdmin } from "./admin.guard";
import { reflectorReturning } from "./test-reflector";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  canSetUserStatus,
  hasPermission,
  permissionsForRole,
} from "./permissions";
import { AdminService } from "./admin.service";

/**
 * Phase A — RBAC + admin authorization baseline.
 *
 * These tests assert the *rules*, not the plumbing: which role may do what, and
 * that the enforcement points (AdminGuard identity -> PermissionGuard
 * capability -> AdminService business rules) actually reject the cases they are
 * supposed to reject. Every assertion below corresponds to a way an
 * administrator could otherwise escalate or act without authority.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function httpContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const admin = (over: Partial<ResolvedAdmin> = {}): ResolvedAdmin => ({
  userId: "admin-1",
  adminUserId: "adminuser-1",
  role: "SUPER_ADMIN",
  isActive: true,
  legacy: false,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. permission matrix
// ---------------------------------------------------------------------------

describe("RBAC — permission matrix", () => {
  it("1. SUPER_ADMIN holds every declared permission", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission("SUPER_ADMIN", permission)).toBe(true);
    }
  });

  it("2. MODERATOR cannot touch settings, admins, exchanges or blocks", () => {
    expect(hasPermission("MODERATOR", "settings:write")).toBe(false);
    expect(hasPermission("MODERATOR", "settings:read")).toBe(false);
    expect(hasPermission("MODERATOR", "admins:write")).toBe(false);
    expect(hasPermission("MODERATOR", "admins:read")).toBe(false);
    expect(hasPermission("MODERATOR", "exchanges:write")).toBe(false);
    expect(hasPermission("MODERATOR", "blocks:write")).toBe(false);
    // ...but moderation is its job.
    expect(hasPermission("MODERATOR", "moderation:write")).toBe(true);
    expect(hasPermission("MODERATOR", "reports:write")).toBe(true);
  });

  it("3. ANALYST is read-only — holds no write permission at all", () => {
    const granted = ROLE_PERMISSIONS.ANALYST;
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.filter((p) => p.endsWith(":write"))).toEqual([]);
  });

  it("4. SUPPORT cannot ban and cannot review reports", () => {
    expect(hasPermission("SUPPORT", "users:write")).toBe(true);
    expect(hasPermission("SUPPORT", "reports:write")).toBe(false);
    expect(hasPermission("SUPPORT", "moderation:write")).toBe(false);
    expect(canSetUserStatus("SUPPORT", "ban")).toBe(false);
    expect(canSetUserStatus("SUPPORT", "suspend")).toBe(false);
    expect(canSetUserStatus("SUPPORT", "disable")).toBe(true);
  });

  it("5. CONTENT_MANAGER moderates content but cannot write user status", () => {
    expect(hasPermission("CONTENT_MANAGER", "moderation:write")).toBe(true);
    expect(hasPermission("CONTENT_MANAGER", "users:write")).toBe(false);
    expect(canSetUserStatus("CONTENT_MANAGER", "ban")).toBe(false);
    expect(canSetUserStatus("CONTENT_MANAGER", "disable")).toBe(false);
  });

  it("6. permanent ban is SUPER_ADMIN only; MODERATOR may only suspend", () => {
    const roles: AdminRole[] = [
      "SUPER_ADMIN",
      "MODERATOR",
      "SUPPORT",
      "ANALYST",
      "CONTENT_MANAGER",
    ];
    const bannable = roles.filter((role) => canSetUserStatus(role, "ban"));
    expect(bannable).toEqual(["SUPER_ADMIN"]);
    expect(canSetUserStatus("MODERATOR", "suspend")).toBe(true);
  });

  it("7. permissionsForRole returns a copy, so callers cannot mutate the matrix", () => {
    const granted = permissionsForRole("SUPPORT");
    granted.push("admins:write" as never);
    expect(hasPermission("SUPPORT", "admins:write")).toBe(false);
  });

  it("8. an unknown role is denied rather than defaulting to allow", () => {
    expect(hasPermission("NOT_A_ROLE" as AdminRole, "users:read")).toBe(false);
    expect(canSetUserStatus("NOT_A_ROLE" as AdminRole, "activate")).toBe(false);
    expect(permissionsForRole("NOT_A_ROLE" as AdminRole)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. PermissionGuard — capability enforcement
// ---------------------------------------------------------------------------

describe("PermissionGuard — capability enforcement", () => {
  it("9. no declared permission -> 403 PERMISSION_UNDECLARED (fail-closed)", () => {
    // FIX (Phase O0). This case used to assert `canActivate(...) === true` under
    // the title "no declared permission -> passes (AdminGuard already vetted
    // identity)". That was the PRE-audit-P006 behaviour: the guard returned
    // `true` when no permission was declared, so a new admin route that forgot
    // `@RequirePermission` was silently open to every role, read-only ones
    // included. `permission.guard.ts:57-66` now refuses in that case, and its
    // doc comment names the change explicitly ("Fail-closed (FIX, audit P006)").
    //
    // The old assertion could never have detected the regression it was supposed
    // to guard, because the shared `reflectorReturning` stub answered every
    // metadata key alike: `isPublic` came back truthy and the guard returned at
    // `if (isPublic) return true` before permission resolution was reached. The
    // test therefore passed against BOTH the old and the new guard, which is
    // exactly why the stale expectation went unnoticed. With the stub corrected
    // to answer only `PERMISSION_METADATA_KEY`, the fail-closed path is
    // reachable and pinned here.
    const guard = new PermissionGuard(reflectorReturning(undefined));
    const request: AdminRequest = { admin: admin({ role: "ANALYST" }) };
    try {
      guard.canActivate(httpContext(request));
      throw new Error("expected ForbiddenException");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as {
        error: { code: string };
      };
      expect(body.error.code).toBe("PERMISSION_UNDECLARED");
    }
  });

  it("10. role lacking the permission -> 403 PERMISSION_DENIED", () => {
    const guard = new PermissionGuard(reflectorReturning("users:write"));
    const request: AdminRequest = { admin: admin({ role: "ANALYST" }) };
    try {
      guard.canActivate(httpContext(request));
      throw new Error("expected ForbiddenException");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as {
        error: { code: string };
      };
      expect(body.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("11. role holding the permission -> allowed", () => {
    const guard = new PermissionGuard(reflectorReturning("users:write"));
    const request: AdminRequest = { admin: admin({ role: "SUPPORT" }) };
    expect(guard.canActivate(httpContext(request))).toBe(true);
  });

  it("12. permission required but no admin attached -> 403 ADMIN_REQUIRED", () => {
    const guard = new PermissionGuard(reflectorReturning("users:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });

  it("13. a soft-disabled admin is rejected even if the role would allow it", () => {
    const guard = new PermissionGuard(reflectorReturning("users:read"));
    const request: AdminRequest = { admin: admin({ isActive: false }) };
    expect(() => guard.canActivate(httpContext(request))).toThrow(ForbiddenException);
  });

  it("14. metadata is read from the handler first, then the class", () => {
    const reflector = reflectorReturning("dashboard:read");
    const guard = new PermissionGuard(reflector);
    guard.canActivate(httpContext({ admin: admin() }));
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      PERMISSION_METADATA_KEY,
      expect.arrayContaining([expect.any(Function), expect.any(Function)]),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. AdminGuard — identity
// ---------------------------------------------------------------------------

function guardWithUser(user: unknown) {
  const prisma = { user: { findUnique: jest.fn(async () => user) } };
  return { guard: new AdminGuard(prisma as never), prisma };
}

describe("AdminGuard — admin identity", () => {
  it("15. unauthenticated request -> 403 ADMIN_REQUIRED", async () => {
    const { guard } = guardWithUser(null);
    await expect(guard.canActivate(httpContext({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("16. an ordinary user is not an admin -> 403 ADMIN_REQUIRED", async () => {
    const { guard } = guardWithUser({
      isAdmin: false,
      status: "ACTIVE",
      adminUser: null,
    });
    await expect(
      guard.canActivate(httpContext({ user: { id: "u1" } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("17. active AdminUser row -> role attached, not legacy", async () => {
    const { guard } = guardWithUser({
      isAdmin: true,
      status: "ACTIVE",
      adminUser: { id: "au1", role: "MODERATOR", isActive: true },
    });
    const request: AdminRequest = { user: { id: "u1" } };
    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.admin).toEqual({
      userId: "u1",
      adminUserId: "au1",
      role: "MODERATOR",
      isActive: true,
      legacy: false,
    });
  });

  it("18. disabled AdminUser row -> 403 ADMIN_INACTIVE, even when isAdmin is true", async () => {
    const { guard } = guardWithUser({
      isAdmin: true,
      status: "ACTIVE",
      adminUser: { id: "au1", role: "SUPER_ADMIN", isActive: false },
    });
    try {
      await guard.canActivate(httpContext({ user: { id: "u1" } }));
      throw new Error("expected ForbiddenException");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as {
        error: { code: string };
      };
      expect(body.error.code).toBe("ADMIN_INACTIVE");
    }
  });

  it("19. isAdmin fallback (no AdminUser row) -> SUPER_ADMIN, flagged legacy", async () => {
    const { guard } = guardWithUser({
      isAdmin: true,
      status: "ACTIVE",
      adminUser: null,
    });
    const request: AdminRequest = { user: { id: "u1" } };
    await guard.canActivate(httpContext(request));
    expect(request.admin).toMatchObject({
      role: "SUPER_ADMIN",
      adminUserId: null,
      legacy: true,
    });
  });

  it("20. a banned or disabled admin loses access entirely", async () => {
    for (const status of ["BANNED", "DISABLED", "SUSPENDED"]) {
      const { guard } = guardWithUser({
        isAdmin: true,
        status,
        adminUser: { id: "au1", role: "SUPER_ADMIN", isActive: true },
      });
      await expect(
        guard.canActivate(httpContext({ user: { id: "u1" } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. AdminService.setStatus — business rules
// ---------------------------------------------------------------------------

type TxMock = {
  user: { update: jest.Mock; findUnique: jest.Mock };
  adminNote: { create: jest.Mock };
  adminAuditLog: { create: jest.Mock; findMany: jest.Mock };
  connection: { count: jest.Mock };
  report: { count: jest.Mock };
  block: { count: jest.Mock };
  socialAccount: { count: jest.Mock };
};

function makeService(target: unknown, opts: { auditFails?: boolean } = {}) {
  const tx: TxMock = {
    // Phase B3: `setStatus` returns `userDetail(...)`, and `userDetail` is now one
    // aggregate that reads the user plus six counts and an audit page through the
    // transaction client. These mocks give it a valid, all-zero detail so the
    // assertions below keep testing the *status* rules they were written for
    // instead of failing on an un-mocked query. Nothing about the status
    // behaviour itself changed.
    user: {
      update: jest.fn(async () => ({ id: "target-1" })),
      findUnique: jest.fn(async () => ({
        id: "target-1",
        email: "member@example.test",
        nickname: "member",
        avatarUrl: null,
        countryCode: "US",
        status: "ACTIVE",
        isAdmin: false,
        bannedAt: null,
        banReason: null,
        suspendedUntil: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        lastActiveAt: null,
        birthDate: null,
        adminUser: null,
        reportsReceived: [],
        reportsMade: [],
        adminNotes: [],
      })),
    },
    adminNote: { create: jest.fn(async () => ({ id: "note-1" })) },
    adminAuditLog: {
      create: jest.fn(async () => {
        if (opts.auditFails) throw new Error("audit insert failed");
        return { id: "audit-1" };
      }),
      findMany: jest.fn(async () => []),
    },
    connection: { count: jest.fn(async () => 0) },
    report: { count: jest.fn(async () => 0) },
    block: { count: jest.fn(async () => 0) },
    socialAccount: { count: jest.fn(async () => 0) },
  };

  const prisma = {
    user: { findUnique: jest.fn(async () => target) },
    adminNote: tx.adminNote,
    adminAuditLog: tx.adminAuditLog,
    $transaction: jest.fn(async (fn: (client: TxMock) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), prisma, tx };
}

const targetUser = {
  id: "target-1",
  status: "ACTIVE",
  bannedAt: null,
  banReason: null,
  suspendedUntil: null,
  adminUser: null,
};

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(
    code === "REASON_REQUIRED" ||
      code === "EXPIRES_AT_REQUIRED" ||
      code === "INVALID_EXPIRES_AT" ||
      code === "INVALID_ACTION"
      ? BadRequestException
      : ForbiddenException,
  );
  try {
    await promise;
  } catch (error) {
    const body = (error as { getResponse: () => { error: { code: string } } }).getResponse();
    expect(body.error.code).toBe(code);
  }
}

describe("AdminService.setStatus — authorization and safety rules", () => {
  it("21. missing reason -> 400 REASON_REQUIRED", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({ targetUserId: "target-1", action: "ban", admin: admin() }),
      "REASON_REQUIRED",
    );
  });

  it("22. whitespace-only reason is treated as missing", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "target-1",
        action: "ban",
        reason: "   \n  ",
        admin: admin(),
      }),
      "REASON_REQUIRED",
    );
  });

  it("23. an admin cannot change their own status (self-ban guard)", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "admin-1",
        action: "ban",
        reason: "testing self protection",
        admin: admin({ userId: "admin-1" }),
      }),
      "CANNOT_MODIFY_SELF",
    );
  });

  it("24. SUPPORT attempting a ban -> 403 ACTION_NOT_ALLOWED_FOR_ROLE", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "target-1",
        action: "ban",
        reason: "support should not ban",
        admin: admin({ role: "SUPPORT" }),
      }),
      "ACTION_NOT_ALLOWED_FOR_ROLE",
    );
  });

  it("25. ANALYST attempting a disable -> 403 ACTION_NOT_ALLOWED_FOR_ROLE", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "target-1",
        action: "disable",
        reason: "analyst is read-only",
        admin: admin({ role: "ANALYST" }),
      }),
      "ACTION_NOT_ALLOWED_FOR_ROLE",
    );
  });

  it("26. MODERATOR cannot modify an active administrator -> 403 CANNOT_MODIFY_ADMIN", async () => {
    const { service } = makeService({
      ...targetUser,
      id: "other-admin",
      adminUser: { id: "au2", isActive: true },
    });
    await expectCode(
      service.setStatus({
        targetUserId: "other-admin",
        action: "suspend",
        reason: "moderator overreach",
        expiresAt: new Date(Date.now() + 86400000),
        admin: admin({ role: "MODERATOR" }),
      }),
      "CANNOT_MODIFY_ADMIN",
    );
  });

  it("27. SUPER_ADMIN may modify another administrator", async () => {
    const { service, tx } = makeService({
      ...targetUser,
      id: "other-admin",
      adminUser: { id: "au2", isActive: true },
    });
    await service.setStatus({
      targetUserId: "other-admin",
      action: "suspend",
      reason: "investigating a colleague",
      expiresAt: new Date(Date.now() + 86400000),
      admin: admin({ role: "SUPER_ADMIN" }),
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it("28. an inactive admin profile is not treated as a protected target", async () => {
    const { service, tx } = makeService({
      ...targetUser,
      id: "retired-admin",
      adminUser: { id: "au3", isActive: false },
    });
    await service.setStatus({
      targetUserId: "retired-admin",
      action: "disable",
      reason: "retired admin cleanup",
      admin: admin({ role: "MODERATOR" }),
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it("29. suspend without expiresAt -> 400 EXPIRES_AT_REQUIRED", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "target-1",
        action: "suspend",
        reason: "temporary",
        admin: admin(),
      }),
      "EXPIRES_AT_REQUIRED",
    );
  });

  it("30. suspend with an expiry in the past -> 400 INVALID_EXPIRES_AT", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "target-1",
        action: "suspend",
        reason: "temporary",
        expiresAt: new Date(Date.now() - 1000),
        admin: admin(),
      }),
      "INVALID_EXPIRES_AT",
    );
  });

  it("31. unknown action -> 400 INVALID_ACTION", async () => {
    const { service } = makeService(targetUser);
    await expectCode(
      service.setStatus({
        targetUserId: "target-1",
        action: "promote" as never,
        reason: "nope",
        admin: admin(),
      }),
      "INVALID_ACTION",
    );
  });

  it("32. unknown target user -> 404 USER_NOT_FOUND", async () => {
    const { service } = makeService(null);
    await expect(
      service.setStatus({
        targetUserId: "ghost",
        action: "ban",
        reason: "no such user",
        admin: admin(),
      }),
    ).rejects.toThrow();
  });

  it("33. happy path writes status + note + audit inside ONE transaction", async () => {
    const { service, prisma, tx } = makeService(targetUser);
    await service.setStatus({
      targetUserId: "target-1",
      action: "ban",
      reason: "repeated harassment",
      admin: admin({ userId: "admin-1" }),
      ip: "203.0.113.7",
      userAgent: "jest",
    });

    // Phase B3: setStatus returns userDetail(), which runs its own transaction
    // for the aggregate read. The write transaction (status + note + audit) is
    // still exactly one; the second is the read-only detail query.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.adminNote.create).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);

    const update = tx.user.update.mock.calls[0][0];
    expect(update.data.status).toBe("BANNED");
    expect(update.data.banReason).toBe("repeated harassment");

    const audit = tx.adminAuditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("ADMIN_USER_BAN");
    expect(audit.targetType).toBe("USER");
    expect(audit.targetId).toBe("target-1");
    expect(audit.reason).toBe("repeated harassment");
    expect(audit.before.status).toBe("ACTIVE");
    expect(audit.after.status).toBe("BANNED");
    expect(audit.ip).toBe("203.0.113.7");
  });

  it("34. if the audit write fails the whole action fails (no silent status change)", async () => {
    const { service, tx } = makeService(targetUser, { auditFails: true });
    await expect(
      service.setStatus({
        targetUserId: "target-1",
        action: "ban",
        reason: "should not persist",
        admin: admin(),
      }),
    ).rejects.toThrow("audit insert failed");
    // Both writes were attempted inside the same transaction, so a real
    // database rolls the user update back together with the audit row.
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it("35. suspend stores the expiry and clears any ban columns", async () => {
    const { service, tx } = makeService(targetUser);
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await service.setStatus({
      targetUserId: "target-1",
      action: "suspend",
      reason: "cooling off period",
      expiresAt,
      admin: admin({ role: "MODERATOR" }),
    });
    const data = tx.user.update.mock.calls[0][0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.suspendedUntil).toBe(expiresAt);
    expect(data.bannedAt).toBeNull();
  });
});
