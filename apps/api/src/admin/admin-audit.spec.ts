import { BadRequestException } from "@nestjs/common";

import { AdminService, type SystemAuditInput } from "./admin.service";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase A — audit baseline.
 *
 * Before Phase A the audit log was a thin `{ adminId, action, targetId, detail }`
 * row: `targetId` was typed as UUID, there was no reason / before / after / ip /
 * user-agent, and no foreign key back to the acting admin. Two consequences are
 * covered here:
 *
 *   1. `reviewReport` had nowhere to put the report it acted on, so it stuffed
 *      the reported user's id into the free-text `detail` column — the trail
 *      could not be joined back to a real object.
 *   2. The audit write was not part of the mutation's transaction, so a failed
 *      audit insert still left the user's status changed.
 */

const admin: ResolvedAdmin = {
  userId: "admin-1",
  adminUserId: "adminuser-1",
  role: "SUPER_ADMIN",
  isActive: true,
  legacy: false,
};

/** Shape of the row handed to `adminAuditLog.create`. */
type AuditData = {
  actorType?: string;
  adminId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
};

/** Shape of the row handed to `adminNote.create`. */
type NoteData = { userId: string; adminId: string; body: string };

function makeService(opts: { report?: unknown } = {}) {
  const tx = {
    report: {
      update: jest.fn(async (_args: { where: unknown; data: unknown }) => ({
        id: "report-1",
        status: "RESOLVED",
      })),
    },
    adminNote: {
      create: jest.fn(async (_args: { data: NoteData }) => ({ id: "note-1" })),
    },
    adminAuditLog: {
      create: jest.fn(async (_args: { data: AuditData }) => ({ id: "audit-1" })),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async (_args: unknown) => [] as unknown[]),
    },
  };

  // Distinct spy from `tx.adminAuditLog.create` so tests can prove which client
  // `recordAudit` actually routed through.
  const defaultAuditCreate = jest.fn(async (_args: { data: AuditData }) => ({
    id: "audit-default",
  }));

  const prisma = {
    report: { findUnique: jest.fn(async () => opts.report ?? null) },
    adminNote: tx.adminNote,
    adminAuditLog: {
      create: defaultAuditCreate,
      count: jest.fn(async () => 0),
      findMany: jest.fn(async (_args: unknown) => [] as unknown[]),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), prisma, tx };
}

describe("recordAudit — the single audit write path", () => {
  it("1. writes actor, action, target, reason, before/after, ip and user-agent", async () => {
    const { service, prisma } = makeService();
    await service.recordAudit({
      adminId: "admin-1",
      action: "ADMIN_USER_BAN",
      targetType: "USER",
      targetId: "user-9",
      reason: "spam",
      before: { status: "ACTIVE" },
      after: { status: "BANNED" },
      ip: "198.51.100.4",
      userAgent: "Mozilla/5.0",
    });

    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      adminId: "admin-1",
      action: "ADMIN_USER_BAN",
      targetType: "USER",
      targetId: "user-9",
      reason: "spam",
      ip: "198.51.100.4",
      userAgent: "Mozilla/5.0",
    });
    expect(data.before).toEqual({ status: "ACTIVE" });
    expect(data.after).toEqual({ status: "BANNED" });
  });

  it("2. accepts a non-UUID target id (targetId was widened from UUID to VARCHAR)", async () => {
    const { service, prisma } = makeService();
    await service.recordAudit({
      adminId: "admin-1",
      action: "SYSTEM_TASK",
      targetType: "JOB",
      targetId: "nightly-cleanup-2026-09-17",
    });
    expect(prisma.adminAuditLog.create.mock.calls[0][0].data.targetId).toBe(
      "nightly-cleanup-2026-09-17",
    );
  });

  it("3. truncates over-long values instead of failing the audit insert", async () => {
    const { service, prisma } = makeService();
    await service.recordAudit({
      adminId: "admin-1",
      action: "A".repeat(200),
      targetType: "T".repeat(200),
      targetId: "I".repeat(500),
      reason: "R".repeat(900),
      ip: "1".repeat(80),
      userAgent: "U".repeat(2000),
    });
    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.action).toHaveLength(64);
    expect(data.targetType).toHaveLength(32);
    expect(data.targetId).toHaveLength(128);
    expect(data.reason).toHaveLength(500);
    expect(data.ip).toHaveLength(45);
    expect(data.userAgent).toHaveLength(512);
  });

  it("4. writes through the caller's transaction client when one is supplied", async () => {
    const { service, prisma, tx } = makeService();
    await service.recordAudit({ adminId: "admin-1", action: "X" }, tx as never);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("5. never persists a secret-bearing payload verbatim", async () => {
    const { service, prisma } = makeService();
    await service.recordAudit({
      adminId: "admin-1",
      action: "ADMIN_USER_NOTE",
      targetType: "USER",
      targetId: "user-1",
      before: undefined,
      after: undefined,
    });
    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    // before/after are omitted entirely rather than written as null-ish blobs
    expect(data.before).toBeUndefined();
    expect(data.after).toBeUndefined();
    expect(JSON.stringify(data)).not.toMatch(/password|token|secret/i);
  });
});

describe("reviewReport — audit trail", () => {
  it("6. missing reason -> 400 REASON_REQUIRED, no write happens", async () => {
    const { service, tx } = makeService({ report: { id: "report-1", status: "OPEN" } });
    await expect(
      service.reviewReport("report-1", "resolved", admin, "   "),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.report.update).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("7. unknown report -> 404, no audit row written", async () => {
    const { service, tx } = makeService({ report: null });
    await expect(
      service.reviewReport("ghost", "resolved", admin, "no such report"),
    ).rejects.toThrow();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("8. audit row points at the REPORT via targetType/targetId, not at a user id in `detail`", async () => {
    const { service, tx } = makeService({
      report: { id: "report-1", status: "OPEN", reportedUserId: "user-77" },
    });
    await service.reviewReport("report-1", "resolved", admin, "confirmed harassment");

    const data = tx.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.action).toBe("REPORT_RESOLVED");
    expect(data.targetType).toBe("REPORT");
    expect(data.targetId).toBe("report-1");
    expect(data.reason).toBe("confirmed harassment");
    expect(data.before).toEqual({ status: "OPEN" });
    expect(data.after).toEqual({ status: "RESOLVED" });
    // The regression this guards against: the reported user's id used to be
    // smuggled into `detail`, making the trail unjoinable.
    expect(data.targetId).not.toBe("user-77");
  });

  it("9. report status change and audit entry share one transaction", async () => {
    const { service, prisma } = makeService({
      report: { id: "report-1", status: "OPEN", reportedUserId: "user-77" },
    });
    await service.reviewReport("report-1", "reviewing", admin, "taking a look");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("addNote — audit trail", () => {
  it("10. blank body -> 400 and nothing is written", async () => {
    const { service, tx } = makeService();
    await expect(service.addNote("user-1", admin, "  ")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.adminNote.create).not.toHaveBeenCalled();
  });

  it("11. records the note and its audit entry together", async () => {
    const { service, tx } = makeService();
    await service.addNote("user-1", admin, "Called the user, resolved by phone.");

    expect(tx.adminNote.create).toHaveBeenCalledTimes(1);
    const note = tx.adminNote.create.mock.calls[0][0].data;
    expect(note).toMatchObject({ userId: "user-1", adminId: "admin-1" });

    const audit = tx.adminAuditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("ADMIN_USER_NOTE");
    expect(audit.targetType).toBe("USER");
    expect(audit.targetId).toBe("user-1");
  });

  it("12. note body is capped so a single note cannot blow up the row", async () => {
    const { service, tx } = makeService();
    await service.addNote("user-1", admin, "x".repeat(5000));
    expect(tx.adminNote.create.mock.calls[0][0].data.body).toHaveLength(1000);
  });
});

describe("listAudit — pagination bounds", () => {
  it("13. clamps page/pageSize to safe ranges", async () => {
    const { service, tx } = makeService();
    const result = await service.listAudit(-5, 100000);
    expect(result).toMatchObject({ page: 1, pageSize: 100, total: 0, items: [] });
    expect(tx.adminAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
    );
  });
});

/**
 * SYSTEM actor — the application-layer mirror of
 * `AdminAuditLog_actor_consistency_check`.
 *
 * The database permits exactly two shapes. These tests pin the same rule in
 * TypeScript so a mistake fails here, with a readable message, instead of
 * surfacing as a Postgres `23514 check_violation` — or as a row that quietly
 * attributes a machine action to a human.
 *
 * The real database's enforcement of the identical predicate is verified
 * against live PostgreSQL in `scripts/phaseA-rbac-verify.mjs`; these two
 * layers are deliberately kept in lockstep.
 */
describe("SYSTEM actor — actor/audit consistency", () => {
  /**
   * Runs `call`, asserts it rejected with a 400, and returns the response body.
   *
   * The envelope lives on `getResponse()`, not on the exception instance:
   * NestJS treats the object passed to `BadRequestException` as the HTTP body.
   */
  async function rejectionBody(call: () => Promise<unknown>) {
    const error = await call().then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      success: boolean;
      error: { code: string; message: string };
    };
  }

  // ---------------------------------------------------- mandated case 1
  it("14. USER + adminId is accepted and written verbatim", async () => {
    const { service, prisma } = makeService();
    await service.recordAudit({
      actorType: "USER",
      adminId: "admin-1",
      action: "ADMIN_USER_BAN",
    });

    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.actorType).toBe("USER");
    expect(data.adminId).toBe("admin-1");
  });

  it("15. actorType defaults to USER, so pre-existing call sites are unchanged", async () => {
    const { service, prisma } = makeService();
    // No actorType at all — exactly how every call site written before the
    // SYSTEM actor existed still calls this.
    await service.recordAudit({ adminId: "admin-1", action: "ADMIN_USER_NOTE" });

    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.actorType).toBe("USER");
    expect(data.adminId).toBe("admin-1");
  });

  // ---------------------------------------------------- mandated case 2
  it("16. SYSTEM + null adminId is accepted", async () => {
    const { service, prisma } = makeService();
    await service.recordAudit({
      actorType: "SYSTEM",
      adminId: null,
      action: "SYSTEM_USER_SUSPENSION_EXPIRED",
    });

    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.actorType).toBe("SYSTEM");
    expect(data.adminId).toBeNull();
  });

  // ---------------------------------------------------- mandated case 3
  it("17. SYSTEM + adminId is rejected before it reaches the database", async () => {
    const { service, prisma } = makeService();
    await expect(
      service.recordAudit({
        actorType: "SYSTEM",
        adminId: "admin-1",
        action: "SYSTEM_USER_SUSPENSION_EXPIRED",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The point of the guard: no insert was even attempted.
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("17b. the rejection carries the project error envelope and code", async () => {
    const { service } = makeService();
    const body = await rejectionBody(() =>
      service.recordAudit({ actorType: "SYSTEM", adminId: "admin-1", action: "X" }),
    );
    expect(body).toMatchObject({
      success: false,
      error: { code: "AUDIT_ACTOR_INVALID" },
    });
    // The message must name the actual problem, not leak the admin's id back.
    expect(body.error.message).toMatch(/SYSTEM/);
    expect(body.error.message).not.toContain("admin-1");
  });

  // ---------------------------------------------------- mandated case 4
  it("18. USER + missing adminId is rejected", async () => {
    const { service, prisma } = makeService();
    await expect(
      service.recordAudit({ actorType: "USER", adminId: null, action: "ADMIN_USER_BAN" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("18b. USER + undefined adminId is rejected too (not silently written as null)", async () => {
    const { service, prisma } = makeService();
    const body = await rejectionBody(() => service.recordAudit({ action: "ADMIN_USER_BAN" }));
    expect(body.error.code).toBe("AUDIT_ACTOR_INVALID");
    expect(body.error.message).toMatch(/USER/);
    expect(prisma.adminAuditLog.create).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------- recordSystemAudit
  it("19. recordSystemAudit pins actorType=SYSTEM and adminId=null", async () => {
    const { service, prisma } = makeService();
    await service.recordSystemAudit({
      action: "SYSTEM_USER_SUSPENSION_EXPIRED",
      targetType: "USER",
      before: { status: "SUSPENDED" },
      after: { status: "ACTIVE" },
      detail: "Auto-released 2 expired suspension(s)",
    });

    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.actorType).toBe("SYSTEM");
    expect(data.adminId).toBeNull();
    expect(data.action).toBe("SYSTEM_USER_SUSPENSION_EXPIRED");
    expect(data.targetType).toBe("USER");
  });

  it("20. a caller cannot smuggle an adminId into a SYSTEM entry", async () => {
    const { service, prisma } = makeService();
    // The input type has no `adminId` field, so this is only reachable by
    // deliberately defeating the types — exactly the case the runtime pin must
    // survive. `recordSystemAudit` spreads the caller's object first and then
    // overwrites, so the forged value can never win.
    const forged = {
      action: "SYSTEM_USER_SUSPENSION_EXPIRED",
      adminId: "admin-1",
    } as unknown as SystemAuditInput;

    await service.recordSystemAudit(forged);

    const data = prisma.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.adminId).toBeNull();
    expect(data.actorType).toBe("SYSTEM");
    // Belt and braces: no administrator id anywhere in the persisted payload.
    expect(JSON.stringify(data)).not.toContain("admin-1");
  });

  it("21. recordSystemAudit writes through a supplied transaction client", async () => {
    const { service, tx } = makeService();
    await service.recordSystemAudit(
      { action: "SYSTEM_USER_SUSPENSION_EXPIRED", targetType: "USER" },
      tx as never,
    );
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create.mock.calls[0][0].data.actorType).toBe("SYSTEM");
  });

  it("22. a human action is never recorded as SYSTEM", async () => {
    const { service, tx } = makeService();
    // Every human path in AdminService passes an adminId and no actorType.
    await service.addNote("user-1", admin, "Called the user.");
    const data = tx.adminAuditLog.create.mock.calls[0][0].data;
    expect(data.actorType).toBe("USER");
    expect(data.adminId).toBe("admin-1");
  });
});
