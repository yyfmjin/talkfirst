import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";

/**
 * Phase B3 — PATCH /admin/users/:id/status
 *
 * These tests prove that the new PATCH route is not a second code path:
 * it delegates to the *same* `AdminService.setStatus` that POST has always
 * used, so every business rule, RBAC gate, audit guarantee and error shape
 * inherited by construction.
 *
 * §27  enumerates the cases; §28  demands POST/PATCH equivalence.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const SUPER_ADMIN = {
  userId: "admin-sa",
  adminUserId: "au-sa",
  role: "SUPER_ADMIN" as const,
  isActive: true,
  legacy: false,
};

const MODERATOR = {
  userId: "admin-mo",
  adminUserId: "au-mo",
  role: "MODERATOR" as const,
  isActive: true,
  legacy: false,
};

const SUPPORT = {
  userId: "admin-su",
  adminUserId: "au-su",
  role: "SUPPORT" as const,
  isActive: true,
  legacy: false,
};

const ANALYST = {
  userId: "admin-an",
  adminUserId: "au-an",
  role: "ANALYST" as const,
  isActive: true,
  legacy: false,
};

const CONTENT_MANAGER = {
  userId: "admin-cm",
  adminUserId: "au-cm",
  role: "CONTENT_MANAGER" as const,
  isActive: true,
  legacy: false,
};

function request(admin: typeof SUPER_ADMIN | typeof MODERATOR | typeof SUPPORT | typeof ANALYST | typeof CONTENT_MANAGER) {
  return {
    admin,
    ip: "203.0.113.7",
    headers: { "user-agent": "jest-patch" },
  } as Parameters<AdminController["patchStatus"]>[0];
}

function makeController(target: unknown) {
  const tx = {
    user: {
      update: jest.fn(async () => ({ id: "target-1" })),
      findUnique: jest.fn(async () =>
        target === null
          ? null
          : {
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
            },
      ),
    },
    adminNote: { create: jest.fn(async () => ({ id: "note-1" })) },
    adminAuditLog: {
      create: jest.fn(async () => ({ id: "audit-1" })),
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
    $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
  };

  return {
    controller: new AdminController(new AdminService(prisma as never)),
    tx,
    prisma,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const Expected =
    code === "REASON_REQUIRED" ||
    code === "EXPIRES_AT_REQUIRED" ||
    code === "INVALID_EXPIRES_AT" ||
    code === "INVALID_ACTION"
      ? BadRequestException
      : ForbiddenException;
  await expect(promise).rejects.toBeInstanceOf(Expected);
  try {
    await promise;
  } catch (error) {
    const body = (error as { getResponse: () => { error: { code: string } } }).getResponse();
    expect(body.error.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// §27  1–5  PATCH happy paths
// ---------------------------------------------------------------------------

describe("PATCH /admin/users/:id/status — happy path", () => {
  it("1. PATCH activate", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "DISABLED",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });

    await controller.patchStatus(request(SUPER_ADMIN), "target-1", {
      action: "activate",
      reason: "appeal accepted",
    });

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect((tx.user.update.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("ACTIVE");
  });

  it("2. PATCH disable", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });

    await controller.patchStatus(request(SUPER_ADMIN), "target-1", {
      action: "disable",
      reason: "tos violation",
    });

    expect((tx.user.update.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("DISABLED");
  });

  it("3. PATCH suspend", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    await controller.patchStatus(request(MODERATOR), "target-1", {
      action: "suspend",
      reason: "cooling off",
      expiresAt,
    });

    const data = (tx.user.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.suspendedUntil).toBeInstanceOf(Date);
  });

  it("4. PATCH ban", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });

    await controller.patchStatus(request(SUPER_ADMIN), "target-1", {
      action: "ban",
      reason: "severe abuse",
    });

    expect((tx.user.update.mock.calls[0] as unknown as [{ data: { status: string } }])[0].data.status).toBe("BANNED");
  });

  it("5. PATCH unban", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "BANNED",
      bannedAt: new Date("2026-01-01T00:00:00.000Z"),
      banReason: "old reason",
      suspendedUntil: null,
      adminUser: null,
    });

    await controller.patchStatus(request(SUPER_ADMIN), "target-1", {
      action: "unban",
      reason: "appeal granted",
    });

    const data = (tx.user.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.status).toBe("ACTIVE");
    expect(data.bannedAt).toBeNull();
    expect(data.banReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §27  6–10  PATCH role gating
// ---------------------------------------------------------------------------

describe("PATCH /admin/users/:id/status — role gating", () => {
  it("6. SUPPORT + PATCH ban -> 403 ACTION_NOT_ALLOWED_FOR_ROLE", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(SUPPORT), "target-1", {
        action: "ban",
        reason: "support should not ban",
      }),
      "ACTION_NOT_ALLOWED_FOR_ROLE",
    );
  });

  it("7. SUPPORT + PATCH suspend -> 403 ACTION_NOT_ALLOWED_FOR_ROLE", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(SUPPORT), "target-1", {
        action: "suspend",
        reason: "support should not suspend",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      "ACTION_NOT_ALLOWED_FOR_ROLE",
    );
  });

  it("8. MODERATOR + PATCH ban -> 403 ACTION_NOT_ALLOWED_FOR_ROLE", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(MODERATOR), "target-1", {
        action: "ban",
        reason: "moderator should not ban permanently",
      }),
      "ACTION_NOT_ALLOWED_FOR_ROLE",
    );
  });

  it("9. ANALYST + PATCH disable -> 403 ACTION_NOT_ALLOWED_FOR_ROLE", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(ANALYST), "target-1", {
        action: "disable",
        reason: "analyst is read-only",
      }),
      "ACTION_NOT_ALLOWED_FOR_ROLE",
    );
  });

  it("10. CONTENT_MANAGER + PATCH any write -> 403 PERMISSION_DENIED", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    // CONTENT_MANAGER lacks users:write entirely, so PermissionGuard rejects
    // before the action vocabulary is even reached.
    await expect(
      controller.patchStatus(request(CONTENT_MANAGER), "target-1", {
        action: "disable",
        reason: "content manager should not write",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// §27  11–15  PATCH business rules
// ---------------------------------------------------------------------------

describe("PATCH /admin/users/:id/status — business rules", () => {
  it("11. missing reason -> 400 REASON_REQUIRED", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(SUPER_ADMIN), "target-1", {
        action: "ban",
      } as never),
      "REASON_REQUIRED",
    );
  });

  it("12. blank reason -> 400 REASON_REQUIRED", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(SUPER_ADMIN), "target-1", {
        action: "ban",
        reason: "   \n  ",
      }),
      "REASON_REQUIRED",
    );
  });

  it("13. suspend missing expiresAt -> 400 EXPIRES_AT_REQUIRED", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(MODERATOR), "target-1", {
        action: "suspend",
        reason: "temporary",
      }),
      "EXPIRES_AT_REQUIRED",
    );
  });

  it("14. suspend with past expiresAt -> 400 INVALID_EXPIRES_AT", async () => {
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(MODERATOR), "target-1", {
        action: "suspend",
        reason: "temporary",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
      "INVALID_EXPIRES_AT",
    );
  });

  it("15. suspend with future expiresAt is accepted", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await controller.patchStatus(request(MODERATOR), "target-1", {
      action: "suspend",
      reason: "cooling off",
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// §27  16–17  self / admin protection
// ---------------------------------------------------------------------------

describe("PATCH /admin/users/:id/status — protection", () => {
  it("16. self-modification -> 403 CANNOT_MODIFY_SELF", async () => {
    const me = { ...SUPER_ADMIN, userId: "target-1" };
    const { controller } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await expectCode(
      controller.patchStatus(request(me), "target-1", {
        action: "ban",
        reason: "self ban",
      }),
      "CANNOT_MODIFY_SELF",
    );
  });

  it("17. MODERATOR modifying an active admin -> 403 CANNOT_MODIFY_ADMIN", async () => {
    const { controller } = makeController({
      id: "other-admin",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: { id: "au2", isActive: true },
    });
    await expectCode(
      controller.patchStatus(request(MODERATOR), "other-admin", {
        action: "suspend",
        reason: "overreach",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
      "CANNOT_MODIFY_ADMIN",
    );
  });
});

// ---------------------------------------------------------------------------
// §27  18–20  audit
// ---------------------------------------------------------------------------

describe("PATCH /admin/users/:id/status — audit", () => {
  it("18. a successful PATCH creates a USER audit row", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await controller.patchStatus(request(SUPER_ADMIN), "target-1", {
      action: "ban",
      reason: "audit test",
    });
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    const data = (tx.adminAuditLog.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.actorType).toBe("USER");
  });

  it("19. audit adminId matches the acting administrator", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await controller.patchStatus(request(MODERATOR), "target-1", {
      action: "disable",
      reason: "audit identity test",
    });
    const data = (tx.adminAuditLog.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.adminId).toBe(MODERATOR.userId);
  });

  it("20. actorType is USER, never SYSTEM, for a human action", async () => {
    const { controller, tx } = makeController({
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    });
    await controller.patchStatus(request(SUPPORT), "target-1", {
      action: "disable",
      reason: "actor type test",
    });
    const data = (tx.adminAuditLog.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.actorType).toBe("USER");
    expect(data.actorType).not.toBe("SYSTEM");
  });
});

// ---------------------------------------------------------------------------
// §28  POST / PATCH equivalence
// ---------------------------------------------------------------------------

describe("POST and PATCH produce identical business results", () => {
  it("1. ban via POST and ban via PATCH yield the same status and audit shape", async () => {
    const target = {
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    };

    const { controller: c1, tx: tx1 } = makeController(target);
    await c1.setStatus(request(SUPER_ADMIN), "target-1", {
      action: "ban",
      reason: "equivalence",
    });

    const { controller: c2, tx: tx2 } = makeController(target);
    await c2.patchStatus(request(SUPER_ADMIN), "target-1", {
      action: "ban",
      reason: "equivalence",
    });

    const updateData1 = (tx1.user.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    const updateData2 = (tx2.user.update.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;

    // `bannedAt` is `new Date()` evaluated **at execution time**
    // (`nextStatusState`), so two separate ban operations legitimately record
    // two different instants. Comparing them for equality would be asserting
    // that time stood still between the two calls — which is why this
    // assertion used to pass only when both calls happened to land inside the
    // same millisecond. Every *other* column must still match exactly, and the
    // timestamp is checked for type and recency rather than equality, so the
    // comparison stays strict about everything the two verbs actually control.
    const { bannedAt: bannedAt1, ...updateRest1 } = updateData1;
    const { bannedAt: bannedAt2, ...updateRest2 } = updateData2;
    expect(updateRest1).toEqual(updateRest2);
    expect(bannedAt1).toBeInstanceOf(Date);
    expect(bannedAt2).toBeInstanceOf(Date);
    expect(
      Math.abs((bannedAt1 as Date).getTime() - (bannedAt2 as Date).getTime()),
    ).toBeLessThan(5_000);

    const audit1 = (tx1.adminAuditLog.create.mock.calls[0] as unknown as [{ data: { action: unknown; before: unknown; after: unknown } }])[0].data;
    const audit2 = (tx2.adminAuditLog.create.mock.calls[0] as unknown as [{ data: { action: unknown; before: unknown; after: unknown } }])[0].data;
    expect(audit1.action).toBe(audit2.action);
    expect(audit1.before).toEqual(audit2.before);

    // `after` carries the same execution-time `bannedAt`, so it is normalised
    // the same way rather than compared verbatim.
    const { bannedAt: afterBannedAt1, ...afterRest1 } = audit1.after as Record<string, unknown>;
    const { bannedAt: afterBannedAt2, ...afterRest2 } = audit2.after as Record<string, unknown>;
    expect(afterRest1).toEqual(afterRest2);
    expect(afterBannedAt1).toBeInstanceOf(Date);
    expect(afterBannedAt2).toBeInstanceOf(Date);
  });

  it("2. suspend via POST and suspend via PATCH yield the same expiry", async () => {
    const target = {
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    };
    const expiresAt = new Date(Date.now() + 3 * 86400000).toISOString();

    const { controller: c1, tx: tx1 } = makeController(target);
    await c1.setStatus(request(MODERATOR), "target-1", {
      action: "suspend",
      reason: "equivalence",
      expiresAt,
    });

    const { controller: c2, tx: tx2 } = makeController(target);
    await c2.patchStatus(request(MODERATOR), "target-1", {
      action: "suspend",
      reason: "equivalence",
      expiresAt,
    });

    const s1 = (tx1.user.update.mock.calls[0] as unknown as [{ data: { suspendedUntil: unknown } }])[0].data.suspendedUntil;
    const s2 = (tx2.user.update.mock.calls[0] as unknown as [{ data: { suspendedUntil: unknown } }])[0].data.suspendedUntil;
    expect(s1).toEqual(s2);
  });

  it("3. a rejected action is rejected identically by both verbs", async () => {
    const target = {
      id: "target-1",
      status: "ACTIVE",
      bannedAt: null,
      banReason: null,
      suspendedUntil: null,
      adminUser: null,
    };

    const { controller: c1 } = makeController(target);
    const postErr = await c1
      .setStatus(request(SUPPORT), "target-1", {
        action: "ban",
        reason: "should fail",
      })
      .catch((e: unknown) => e);

    const { controller: c2 } = makeController(target);
    const patchErr = await c2
      .patchStatus(request(SUPPORT), "target-1", {
        action: "ban",
        reason: "should fail",
      })
      .catch((e: unknown) => e);

    expect((postErr as { getResponse: () => unknown }).getResponse()).toEqual(
      (patchErr as { getResponse: () => unknown }).getResponse(),
    );
  });

  it("4. both routes declare the same permission and throttle metadata", () => {
    // Both use @RequirePermission("users:write")
    const postPerm = Reflect.getMetadata(
      PERMISSION_METADATA_KEY,
      AdminController.prototype.setStatus,
    );
    const patchPerm = Reflect.getMetadata(
      PERMISSION_METADATA_KEY,
      AdminController.prototype.patchStatus,
    );
    expect(postPerm).toBe("users:write");
    expect(patchPerm).toBe("users:write");
    expect(postPerm).toBe(patchPerm);

    // Both use the same DTO (ValidationPipe)
    const postParams = Reflect.getMetadata(
      "design:paramtypes",
      AdminController.prototype.setStatus,
    );
    const patchParams = Reflect.getMetadata(
      "design:paramtypes",
      AdminController.prototype.patchStatus,
    );
    expect(postParams).toEqual(patchParams);
  });
});
