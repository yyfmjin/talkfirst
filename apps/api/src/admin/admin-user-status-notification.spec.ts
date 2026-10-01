import { AdminService } from "./admin.service";
import { NotificationService } from "../notifications/notification.service";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * PC-3.1c — `USER_STATUS`: an account is told its *own* state changed.
 *
 * The rules worth pinning, none of which the variable names imply:
 *
 *   1. **The recipient is the affected account, never the administrator.** The
 *      admin who acted is audit data (`AdminAuditLog`), and the affected user is
 *      not a reader of that. So the payload carries no `actorId` and the whole
 *      row is scanned for the acting admin's ids and role — an assertion that
 *      merely omits a field would still pass if the field were added.
 *
 *   2. **Only a real transition notifies.** Saving the same status twice leaves
 *      the row unchanged; sending "your account status was updated" for a no-op
 *      would be false, so nothing is sent.
 *
 *   3. **The mutation survives a broken notification.** The message is written
 *      after the transaction commits and `NotificationService.notify` never
 *      throws, so a failed insert cannot roll back a ban or a suspension.
 */

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const TARGET_ID = "5d4c3b2a-1f0e-4d9c-8b7a-6e5d4c3b2a10";
const ADMIN_USER_ID = "admin-user-7";
// Must stay in the future on any run date: `setStatus` rejects an `expiresAt`
// that is not ahead of now, so a hardcoded date becomes a time bomb.
const EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const ADMIN: ResolvedAdmin = {
  userId: ADMIN_USER_ID,
  adminUserId: "admin-row-7",
  role: "SUPER_ADMIN",
  isActive: true,
  legacy: false,
};

type NotificationRow = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
};

/** The column set `setStatus` reads before deciding what the transition is. */
function targetRow(over: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    status: "ACTIVE",
    bannedAt: null,
    banReason: null,
    suspendedUntil: null,
    adminUser: null,
    ...over,
  };
}

/** The `User` row `userDetail` reads once the mutation is done. */
function detailRow() {
  return {
    id: TARGET_ID,
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
  };
}

function makeHarness(target: unknown = targetRow()) {
  const notificationRows: NotificationRow[] = [];

  const tx = {
    user: {
      update: jest.fn(async () => ({ id: TARGET_ID })),
      findUnique: jest.fn(async () => detailRow()),
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
    notification: {
      create: jest.fn(async (args: { data: NotificationRow }) => {
        notificationRows.push(args.data);
        return args.data;
      }),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  const service = new AdminService(prisma as never, new NotificationService(prisma as never));
  return { service, prisma, tx, notificationRows };
}

function envelope(row: NotificationRow): Record<string, unknown> {
  return JSON.parse(row.data ?? "{}") as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 21-23, 26-29. the message
// ---------------------------------------------------------------------------

describe("AdminService.setStatus — USER_STATUS notification", () => {
  it("21. a suspension notifies the suspended account and carries the deadline", async () => {
    const { service, notificationRows, tx } = makeHarness();

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "suspend",
      reason: "spam",
      admin: ADMIN,
      expiresAt: EXPIRES_AT,
    });

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0].userId).toBe(TARGET_ID);
    expect(notificationRows[0].type).toBe("USER_STATUS");
    expect(envelope(notificationRows[0])).toEqual({
      targetType: "USER",
      targetId: TARGET_ID,
      status: "SUSPENDED",
      suspendedUntil: EXPIRES_AT.toISOString(),
    });
  });

  it("22. a ban notifies the banned account", async () => {
    const { service, notificationRows } = makeHarness();

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "fraud",
      admin: ADMIN,
    });

    expect(notificationRows).toHaveLength(1);
    expect(envelope(notificationRows[0]).status).toBe("BANNED");
  });

  it("23. a disable notifies the disabled account", async () => {
    const { service, notificationRows } = makeHarness();

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "disable",
      reason: "requested",
      admin: ADMIN,
    });

    expect(notificationRows).toHaveLength(1);
    expect(envelope(notificationRows[0]).status).toBe("DISABLED");
  });

  it("23b. a re-activation notifies the account too", async () => {
    const { service, notificationRows } = makeHarness(
      targetRow({ status: "SUSPENDED", suspendedUntil: EXPIRES_AT }),
    );

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "activate",
      reason: "appeal accepted",
      admin: ADMIN,
    });

    expect(notificationRows).toHaveLength(1);
    expect(envelope(notificationRows[0]).status).toBe("ACTIVE");
  });

  it("26-27. the target is the account itself, named as a USER", async () => {
    const { service, notificationRows } = makeHarness();

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "fraud",
      admin: ADMIN,
    });

    const data = envelope(notificationRows[0]);
    expect(data.targetType).toBe("USER");
    expect(data.targetId).toBe(TARGET_ID);
    expect(data.targetId).toBe(notificationRows[0].userId);
  });

  it("29. suspendedUntil appears only when there is a deadline", async () => {
    const suspended = makeHarness();
    await suspended.service.setStatus({
      targetUserId: TARGET_ID,
      action: "suspend",
      reason: "spam",
      admin: ADMIN,
      expiresAt: EXPIRES_AT,
    });
    expect(envelope(suspended.notificationRows[0])).toHaveProperty(
      "suspendedUntil",
      EXPIRES_AT.toISOString(),
    );

    const banned = makeHarness();
    await banned.service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "fraud",
      admin: ADMIN,
    });
    expect(envelope(banned.notificationRows[0])).not.toHaveProperty("suspendedUntil");
  });
});

// ---------------------------------------------------------------------------
// 25. privacy — the affected account is not told who acted
// ---------------------------------------------------------------------------

describe("AdminService.setStatus — the account is not told who acted", () => {
  it("25. the payload carries no actorId, no administrator, no reason", async () => {
    const { service, notificationRows } = makeHarness();

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "internal note: check the payment trail",
      admin: ADMIN,
    });

    const data = envelope(notificationRows[0]);
    expect(data).not.toHaveProperty("actorId");
    expect(Object.keys(data).sort()).toEqual(["status", "targetId", "targetType"]);

    const serialized = JSON.stringify(notificationRows);
    for (const forbidden of [
      "adminId",
      "adminName",
      "actorId",
      "reason",
      ADMIN_USER_ID,
      "admin-row-7",
      "SUPER_ADMIN",
      "internal note",
      "email",
      "passwordHash",
      "token",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 30-31. repetition and failure
// ---------------------------------------------------------------------------

describe("AdminService.setStatus — repetition and delivery", () => {
  it("30. saving the same status twice sends nothing the second time", async () => {
    const { service, notificationRows } = makeHarness(
      targetRow({ status: "BANNED", bannedAt: new Date() }),
    );

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "fraud",
      admin: ADMIN,
    });

    // The mutation still runs (and is still audited) — it is the message that
    // would be false, so no row is written.
    expect(notificationRows).toEqual([]);
  });

  it("31. a failed notification leaves the status change applied", async () => {
    const { service, prisma, tx, notificationRows } = makeHarness();
    prisma.notification.create.mockRejectedValueOnce(new Error("notification table unavailable"));

    // The status change is the real work and it is already committed; `notify`
    // swallows the delivery failure, so the account stays banned.
    const detail = await service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "fraud",
      admin: ADMIN,
    });

    expect(detail).toBeTruthy();
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
    expect(notificationRows).toEqual([]);
  });

  it("31b. the notification is written after the mutation commits, not inside it", async () => {
    const { service, tx, prisma } = makeHarness();

    await service.setStatus({
      targetUserId: TARGET_ID,
      action: "ban",
      reason: "fraud",
      admin: ADMIN,
    });

    const updateOrder = tx.user.update.mock.invocationCallOrder[0];
    const notifyOrder = prisma.notification.create.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(notifyOrder);
  });

  it("31c. a rejected status change notifies nobody", async () => {
    const { service, notificationRows, tx } = makeHarness();

    await expect(
      service.setStatus({ targetUserId: TARGET_ID, action: "ban", reason: "   ", admin: ADMIN }),
    ).rejects.toThrow();

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(notificationRows).toEqual([]);
  });
});
