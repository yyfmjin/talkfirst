import { AdminService } from "./admin.service";
import { NotificationService } from "../notifications/notification.service";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * PC-3.1c — `REPORT_REVIEW`: the reporter is told the outcome of their report.
 *
 * Three things are non-obvious and each is pinned below.
 *
 *   1. **Only a real transition notifies.** `reviewReport` has always allowed
 *      the same action to be submitted twice — it re-writes the same status and
 *      appends a second audit row. A second notification would claim that
 *      something happened when nothing did, so an unchanged status sends
 *      nothing and the count stays "one transition, one message".
 *
 *   2. **The reviewing administrator is not in the payload.** The reporter is
 *      told *that* their report was looked at, never by whom or on what grounds.
 *      `data` therefore carries no `actorId` at all, and the whole row is scanned
 *      for the acting admin's id, role and the free-text reason — a field that
 *      is merely absent from the assertions would still be caught by the scan.
 *
 *   3. **Delivery cannot undo the review.** The notification is written after
 *      the transaction commits and `NotificationService.notify` never throws,
 *      so a broken notification path leaves the report resolved.
 */

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const REPORT_ID = "7c2f9a10-4b3d-4e6a-9f81-2c5d7e9a0b34";
const REPORTER_ID = "1a2b3c4d-5e6f-4a70-8b91-0c1d2e3f4a5b";
const REPORTED_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const ADMIN: ResolvedAdmin = {
  userId: "admin-user-1",
  adminUserId: "admin-row-1",
  role: "MODERATOR",
  isActive: true,
  legacy: false,
};

type Existing = {
  id: string;
  status: string;
  reportedUserId: string;
  reporterId: string;
};

type NotificationRow = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
};

function existingReport(over: Partial<Existing> = {}): Existing {
  return {
    id: REPORT_ID,
    status: "OPEN",
    reportedUserId: REPORTED_ID,
    reporterId: REPORTER_ID,
    ...over,
  };
}

/**
 * The real `AdminService` and the real `NotificationService` over one fake
 * client, so the row the tests assert on is the row that would reach
 * PostgreSQL rather than a stand-in for it.
 */
function makeHarness(over: Partial<Existing> = {}) {
  const notificationRows: NotificationRow[] = [];
  const tx = {
    report: {
      update: jest.fn(async (args: { where: { id: string }; data: { status: string } }) => ({
        id: args.where.id,
        status: args.data.status,
      })),
    },
    adminAuditLog: { create: jest.fn(async () => ({ id: "audit-1" })) },
  };
  const prisma = {
    report: {
      findUnique: jest.fn(
        async (_args: { where: { id: string }; select: Record<string, boolean> }) =>
          existingReport(over),
      ),
    },
    notification: {
      create: jest.fn(async (args: { data: NotificationRow }) => {
        notificationRows.push(args.data);
        return args.data;
      }),
    },
    $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)),
  };
  const service = new AdminService(prisma as never, new NotificationService(prisma as never));
  return { service, prisma, tx, notificationRows };
}

function envelope(row: NotificationRow): Record<string, unknown> {
  return JSON.parse(row.data ?? "{}") as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 11-16. the message itself
// ---------------------------------------------------------------------------

describe("AdminService.reviewReport — REPORT_REVIEW notification", () => {
  it("11. a report moved to RESOLVED notifies the reporter", async () => {
    const { service, notificationRows } = makeHarness();
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed");

    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0].userId).toBe(REPORTER_ID);
    expect(notificationRows[0].type).toBe("REPORT_REVIEW");
    expect(notificationRows[0].title).toBe("举报处理结果");
    expect(envelope(notificationRows[0]).status).toBe("RESOLVED");
  });

  it("12. a report moved to REJECTED notifies the reporter", async () => {
    const { service, notificationRows } = makeHarness();
    await service.reviewReport(REPORT_ID, "rejected", ADMIN, "not a violation");

    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0].userId).toBe(REPORTER_ID);
    expect(envelope(notificationRows[0]).status).toBe("REJECTED");
  });

  it("12b. a report taken up for REVIEWING notifies the reporter too", async () => {
    const { service, notificationRows } = makeHarness();
    await service.reviewReport(REPORT_ID, "reviewing", ADMIN, "looking into it");

    expect(notificationRows).toHaveLength(1);
    expect(envelope(notificationRows[0]).status).toBe("REVIEWING");
  });

  it("13-16. the envelope names the report and nothing else", async () => {
    const { service, notificationRows } = makeHarness();
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed");

    // Exact, not `toMatchObject`: an added `actorId` or `status: reason` must
    // fail here rather than pass as an extra key.
    expect(envelope(notificationRows[0])).toEqual({
      targetType: "REPORT",
      targetId: REPORT_ID,
      reportId: REPORT_ID,
      status: "RESOLVED",
    });
  });

  it("16b. the review reads the reporter's id — the select is pinned", async () => {
    const { service, prisma } = makeHarness();
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed");

    // `reporterId` was added to this select by PC-3.1c; the other three keys are
    // the pre-existing contract and must not drift.
    expect(prisma.report.findUnique.mock.calls[0][0]).toEqual({
      where: { id: REPORT_ID },
      select: { id: true, status: true, reportedUserId: true, reporterId: true },
    });
  });

  it("16c. the notification is written after the report update commits, not inside it", async () => {
    const { service, tx, prisma } = makeHarness();
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed");

    const updateOrder = tx.report.update.mock.invocationCallOrder[0];
    const notifyOrder = prisma.notification.create.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(notifyOrder);
  });
});

// ---------------------------------------------------------------------------
// 17-18. privacy
// ---------------------------------------------------------------------------

describe("AdminService.reviewReport — the reporter is not told who reviewed", () => {
  it("17. the payload carries no actorId", async () => {
    const { service, notificationRows } = makeHarness();
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed");

    const data = envelope(notificationRows[0]);
    expect(data).not.toHaveProperty("actorId");
    expect(Object.keys(data).sort()).toEqual(["reportId", "status", "targetId", "targetType"]);
  });

  it("18. no administrator identity or review reason reaches the row", async () => {
    const { service, notificationRows } = makeHarness();
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "internal note: check the IP logs");

    const serialized = JSON.stringify(notificationRows);
    for (const forbidden of [
      "adminId",
      "adminName",
      "actorId",
      "reason",
      "admin-user-1",
      "admin-row-1",
      "MODERATOR",
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
// 19-20. failure and repetition
// ---------------------------------------------------------------------------

describe("AdminService.reviewReport — delivery and repetition", () => {
  it("19. a failed notification leaves the review applied", async () => {
    const { service, prisma, tx } = makeHarness();
    prisma.notification.create.mockRejectedValueOnce(new Error("notification table unavailable"));

    // The review is the real work: it is already committed, and `notify` swallows
    // the delivery failure, so the outcome stands.
    await expect(service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed")).resolves.toEqual({
      id: REPORT_ID,
      status: "RESOLVED",
    });
    expect(tx.report.update).toHaveBeenCalledTimes(1);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it("20. re-submitting the same status sends no second notification", async () => {
    const { service, notificationRows, tx } = makeHarness({ status: "RESOLVED" });
    await service.reviewReport(REPORT_ID, "resolved", ADMIN, "confirmed again");

    expect(tx.report.update).toHaveBeenCalledTimes(1);
    expect(notificationRows).toEqual([]);
  });

  it("20b. a changed status on an already-reviewed report still notifies", async () => {
    const { service, notificationRows } = makeHarness({ status: "REVIEWING" });
    await service.reviewReport(REPORT_ID, "rejected", ADMIN, "not a violation");

    expect(notificationRows).toHaveLength(1);
    expect(envelope(notificationRows[0]).status).toBe("REJECTED");
  });

  it("20c. a missing reason writes nothing at all", async () => {
    const { service, notificationRows, tx } = makeHarness();
    await expect(service.reviewReport(REPORT_ID, "resolved", ADMIN, "  ")).rejects.toThrow();
    expect(tx.report.update).not.toHaveBeenCalled();
    expect(notificationRows).toEqual([]);
  });
});
