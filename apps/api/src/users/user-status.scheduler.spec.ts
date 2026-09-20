import { UserStatusScheduler } from "./user-status.scheduler";
import { NotificationService } from "../notifications/notification.service";
import type { SystemAuditInput } from "../admin/admin.service";

/**
 * Phase A+ — suspension expiry.
 *
 * Before this scheduler existed, `suspendedUntil` was written by
 * `AdminService.setStatus({action:"suspend"})` and then never read by anything.
 * A "temporary" suspension never ended, and the account stayed locked out with
 * `USER_DISABLED` forever.
 *
 * These tests drive the real `UserStatusScheduler` against a stateful user
 * store, so the three mandated cases (expired -> released, unexpired -> kept,
 * re-run -> no-op) are checked as behaviour rather than by reading source.
 *
 * Two independent things are asserted, on purpose:
 *   1. the *outcome* — which rows end up in which state;
 *   2. the *exact query contract* handed to Prisma, because the in-memory store
 *      below necessarily re-implements the predicate. Pinning `where`/`data`
 *      verbatim means a change to the filter cannot pass silently here.
 * The database's own reading of that predicate is verified separately against
 * real PostgreSQL in `scripts/phaseA-rbac-verify.mjs`.
 */

type Status = "ACTIVE" | "SUSPENDED" | "BANNED" | "DISABLED";

type Row = {
  id: string;
  status: Status;
  suspendedUntil: Date | null;
  bannedAt: Date | null;
  banReason: string | null;
  updatedAt: Date;
};

const BASE = new Date("2026-09-17T12:00:00.000Z");

function row(over: Partial<Row> & { id: string }): Row {
  return {
    status: "ACTIVE",
    suspendedUntil: null,
    bannedAt: null,
    banReason: null,
    updatedAt: BASE,
    ...over,
  };
}

type UpdateManyArgs = {
  where: { status: Status; suspendedUntil: { not: null; lte: Date } };
  data: Partial<Row>;
};

/**
 * The notification row the real `NotificationService` asks the fake client to
 * store. Asserting on this (rather than on a mocked `notify`) means the envelope
 * under test is the one that would reach PostgreSQL.
 */
type NotificationRow = {
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
};

function makeStore(rows: Row[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));

  // PC-3.1c — the sweep returns the rows it changed, because each released user
  // has to be told. Still one statement, and the predicate and payload are the
  // ones `updateMany` used: the test below pins both exactly.
  const updateManyAndReturn = jest.fn(async ({ where, data }: UpdateManyArgs) => {
    const released: { id: string }[] = [];
    for (const current of store.values()) {
      const matches =
        current.status === where.status &&
        current.suspendedUntil !== null &&
        current.suspendedUntil.getTime() <= where.suspendedUntil.lte.getTime();
      if (!matches) continue;
      // `updatedAt` is @updatedAt in the schema, so every real write bumps it.
      Object.assign(current, data, { updatedAt: new Date(BASE.getTime() + 1000) });
      released.push({ id: current.id });
    }
    return released;
  });

  // Stands in for `AdminService`. Records what the scheduler asked it to audit
  // so the SYSTEM-actor requirements can be asserted on the actual payload.
  const auditCalls: SystemAuditInput[] = [];
  const recordSystemAudit = jest.fn(async (input: SystemAuditInput) => {
    auditCalls.push(input);
    return { id: `audit-${auditCalls.length}` };
  });
  const recordAudit = jest.fn(async () => ({ id: "human-audit" }));
  const admin = { recordSystemAudit, recordAudit };

  // The real service over the same fake client, so what the tests read is the
  // row that would be written, not a stand-in for it.
  const notificationRows: NotificationRow[] = [];
  const prisma = {
    user: { updateManyAndReturn },
    notification: {
      create: jest.fn(async (args: { data: NotificationRow }) => {
        notificationRows.push(args.data);
        return args.data;
      }),
    },
  };
  const scheduler = new UserStatusScheduler(
    prisma as never,
    admin as never,
    new NotificationService(prisma as never),
  );
  return {
    store,
    updateManyAndReturn,
    scheduler,
    auditCalls,
    recordSystemAudit,
    recordAudit,
    notificationRows,
  };
}

/** Builds a scheduler whose AdminService stub is not needed by the test. */
function makeBareScheduler(prisma: unknown, notifications?: { notify: jest.Mock }) {
  return new UserStatusScheduler(
    prisma as never,
    {
      recordSystemAudit: jest.fn(async () => ({ id: "audit" })),
      recordAudit: jest.fn(async () => ({ id: "human-audit" })),
    } as never,
    (notifications ?? { notify: jest.fn(async () => undefined) }) as never,
  );
}

describe("UserStatusScheduler — suspension expiry", () => {
  // ---------------------------------------------------------------- Test 1
  it("Test 1: SUSPENDED with a past deadline is released to ACTIVE", async () => {
    const past = new Date(BASE.getTime() - 60_000);
    const { store, scheduler } = makeStore([
      row({ id: "u1", status: "SUSPENDED", suspendedUntil: past, banReason: "cooling off" }),
    ]);

    const released = await scheduler.releaseExpiredSuspensions(BASE);

    expect(released).toBe(1);
    expect(store.get("u1")).toMatchObject({
      status: "ACTIVE",
      suspendedUntil: null,
      bannedAt: null,
      banReason: null,
    });
  });

  // ---------------------------------------------------------------- Test 2
  it("Test 2: SUSPENDED with a future deadline stays SUSPENDED", async () => {
    const future = new Date(BASE.getTime() + 60_000);
    const { store, scheduler } = makeStore([
      row({ id: "u2", status: "SUSPENDED", suspendedUntil: future, banReason: "still serving" }),
    ]);

    const released = await scheduler.releaseExpiredSuspensions(BASE);

    expect(released).toBe(0);
    expect(store.get("u2")).toMatchObject({
      status: "SUSPENDED",
      suspendedUntil: future,
      banReason: "still serving",
      updatedAt: BASE, // untouched
    });
  });

  // ---------------------------------------------------------------- Test 3
  it("Test 3: re-running the sweep does not touch already-released users", async () => {
    const past = new Date(BASE.getTime() - 60_000);
    const { store, scheduler } = makeStore([
      row({ id: "u3", status: "SUSPENDED", suspendedUntil: past, banReason: "expired" }),
    ]);

    const first = await scheduler.releaseExpiredSuspensions(BASE);
    expect(first).toBe(1);
    const afterFirst = { ...store.get("u3")! };

    // Run it again, twice more, in the same instant.
    const second = await scheduler.releaseExpiredSuspensions(BASE);
    const third = await scheduler.releaseExpiredSuspensions(BASE);

    expect(second).toBe(0);
    expect(third).toBe(0);
    // No second write: not just "still ACTIVE" but provably not re-modified.
    expect(store.get("u3")).toEqual(afterFirst);
    expect(store.get("u3")!.updatedAt).toEqual(afterFirst.updatedAt);
  });

  // ------------------------------------------------- extra real behaviours
  it("releases exactly the expired rows in a mixed population", async () => {
    const past = new Date(BASE.getTime() - 1000);
    const future = new Date(BASE.getTime() + 1000);
    const { store, scheduler } = makeStore([
      row({ id: "expired", status: "SUSPENDED", suspendedUntil: past }),
      row({ id: "pending", status: "SUSPENDED", suspendedUntil: future }),
      row({ id: "no-deadline", status: "SUSPENDED", suspendedUntil: null }),
      row({ id: "active", status: "ACTIVE", suspendedUntil: past }),
      row({ id: "banned", status: "BANNED", suspendedUntil: past, bannedAt: past }),
      row({ id: "disabled", status: "DISABLED", suspendedUntil: past }),
    ]);

    const released = await scheduler.releaseExpiredSuspensions(BASE);

    expect(released).toBe(1);
    expect(store.get("expired")!.status).toBe("ACTIVE");
    // A SUSPENDED row with no deadline must NOT be released — `NULL <= now` is
    // not true, and this pins that the filter says `not: null` explicitly.
    expect(store.get("no-deadline")!.status).toBe("SUSPENDED");
    expect(store.get("pending")!.status).toBe("SUSPENDED");
    expect(store.get("active")!.status).toBe("ACTIVE");
    expect(store.get("banned")!.status).toBe("BANNED");
    expect(store.get("disabled")!.status).toBe("DISABLED");
  });

  it("treats a deadline exactly equal to now as expired (lte, not lt)", async () => {
    const { store, scheduler } = makeStore([
      row({ id: "boundary", status: "SUSPENDED", suspendedUntil: new Date(BASE.getTime()) }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(1);
    expect(store.get("boundary")!.status).toBe("ACTIVE");
  });

  it("uses a default clock of now when no instant is supplied", async () => {
    const past = new Date(Date.now() - 60_000);
    const { store, scheduler } = makeStore([
      row({ id: "default-clock", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions()).toBe(1);
    expect(store.get("default-clock")!.status).toBe("ACTIVE");
  });

  it("hands Prisma the exact filter and update payload", async () => {
    const past = new Date(BASE.getTime() - 60_000);
    const { updateManyAndReturn, scheduler } = makeStore([
      row({ id: "contract", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    await scheduler.releaseExpiredSuspensions(BASE);

    expect(updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(updateManyAndReturn.mock.calls[0][0]).toEqual({
      where: { status: "SUSPENDED", suspendedUntil: { not: null, lte: BASE } },
      data: { status: "ACTIVE", suspendedUntil: null, bannedAt: null, banReason: null },
      select: { id: true },
    });
  });

  it("the cron handler swallows a database error instead of crashing", async () => {
    const updateManyAndReturn = jest.fn(async () => {
      throw new Error("connection terminated");
    });
    const scheduler = makeBareScheduler({ user: { updateManyAndReturn } });

    await expect(scheduler.handleSuspensionExpiry()).resolves.toBeUndefined();
  });

  it("a failed sweep still clears the in-flight flag so later ticks run", async () => {
    let call = 0;
    const updateManyAndReturn = jest.fn(async (_args: UpdateManyArgs): Promise<{ id: string }[]> => {
      call += 1;
      if (call === 1) throw new Error("transient");
      return [];
    });
    const scheduler = makeBareScheduler({ user: { updateManyAndReturn } });

    await expect(scheduler.releaseExpiredSuspensions(BASE)).rejects.toThrow("transient");
    // If the in-flight guard leaked, this second call would be skipped and
    // return 0 without ever reaching the database.
    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(0);
    expect(updateManyAndReturn).toHaveBeenCalledTimes(2);
  });

  it("skips a tick that overlaps a sweep which is still running", async () => {
    let releaseGate: (value: { id: string }[]) => void = () => undefined;
    const gate = new Promise<{ id: string }[]>((resolve) => {
      releaseGate = resolve;
    });
    const updateManyAndReturn = jest.fn(async (_args: UpdateManyArgs) => gate);
    const scheduler = makeBareScheduler({ user: { updateManyAndReturn } });

    const inFlight = scheduler.releaseExpiredSuspensions(BASE); // parks on the gate
    const overlapped = await scheduler.releaseExpiredSuspensions(BASE);

    expect(overlapped).toBe(0);
    expect(updateManyAndReturn).toHaveBeenCalledTimes(1); // the second tick never queried

    releaseGate([]);
    await expect(inFlight).resolves.toBe(0);
  });
});

/**
 * SYSTEM audit on release — the machine-action half of the audit trail.
 *
 * Before the SYSTEM actor existed this sweep could not write an audit row at
 * all: `adminId` was a required FK and the only ways to fill it were to borrow
 * a real administrator's identity or to invent a login-able "system" account.
 * Both were rejected, so an expired suspension was released with no trace.
 *
 * The mandated cases below pin the behaviour that replaced that gap. Case 9 is
 * the important one: the row must describe a machine action without naming —
 * or being able to name — any human.
 */
describe("UserStatusScheduler — SYSTEM audit on release", () => {
  const past = new Date(BASE.getTime() - 60_000);
  const future = new Date(BASE.getTime() + 60_000);

  // ---------------------------------------------------- mandated case 5
  it("Test 5: releasing an expired suspension writes a SYSTEM audit entry", async () => {
    const { scheduler, auditCalls } = makeStore([
      row({ id: "u1", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(1);

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "SYSTEM_USER_SUSPENSION_EXPIRED",
      targetType: "USER",
      before: { status: "SUSPENDED" },
      after: { status: "ACTIVE" },
    });
    expect(auditCalls[0].detail).toContain("1");
  });

  // ---------------------------------------------------- mandated case 6
  it("Test 6: a sweep that releases nothing writes no audit entry", async () => {
    const { scheduler, auditCalls, recordSystemAudit } = makeStore([
      row({ id: "u2", status: "SUSPENDED", suspendedUntil: future }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(0);

    expect(auditCalls).toHaveLength(0);
    expect(recordSystemAudit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------- mandated case 7
  it("Test 7: a second tick does not append a duplicate audit entry", async () => {
    const { scheduler, auditCalls } = makeStore([
      row({ id: "u3", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(1);
    expect(auditCalls).toHaveLength(1);

    // Same instant, twice more. The predicate is self-consuming, so both runs
    // release zero rows — and therefore must write zero audit rows.
    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(0);
    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(0);

    expect(auditCalls).toHaveLength(1);
  });

  // ---------------------------------------------------- mandated case 8
  it("Test 8: a BANNED user is never released and produces no audit entry", async () => {
    const { store, scheduler, auditCalls } = makeStore([
      row({
        id: "u4",
        status: "BANNED",
        suspendedUntil: past,
        bannedAt: past,
        banReason: "permanent",
      }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(0);

    expect(store.get("u4")).toMatchObject({
      status: "BANNED",
      bannedAt: past,
      banReason: "permanent",
      updatedAt: BASE,
    });
    expect(auditCalls).toHaveLength(0);
  });

  it("Test 8b: BANNED is left alone even when mixed with an expired suspension", async () => {
    const { store, scheduler, auditCalls } = makeStore([
      row({ id: "banned", status: "BANNED", suspendedUntil: past, bannedAt: past }),
      row({ id: "expired", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    expect(await scheduler.releaseExpiredSuspensions(BASE)).toBe(1);
    expect(store.get("banned")!.status).toBe("BANNED");
    // One released batch -> exactly one row, and it does not mention the banned user.
    expect(auditCalls).toHaveLength(1);
    expect(JSON.stringify(auditCalls[0])).not.toContain("banned");
  });

  // ---------------------------------------------------- mandated case 9
  it("Test 9: the SYSTEM entry does not fabricate an administrator identity", async () => {
    const { scheduler, auditCalls, recordSystemAudit, recordAudit } = makeStore([
      row({ id: "u5", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    await scheduler.releaseExpiredSuspensions(BASE);

    // The scheduler must go through the SYSTEM-only entry point...
    expect(recordSystemAudit).toHaveBeenCalledTimes(1);
    // ...and never the general one, which is the path that takes an adminId.
    expect(recordAudit).not.toHaveBeenCalled();

    // The payload it handed over has no `adminId` property at all — the field
    // is structurally absent from `SystemAuditInput`, so there is nothing to
    // fill in and no UUID to borrow.
    const payload = auditCalls[0];
    expect(Object.prototype.hasOwnProperty.call(payload, "adminId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "actorType")).toBe(false);

    // No UUID-shaped value anywhere in the recorded entry.
    expect(JSON.stringify(payload)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it("Test 9b: the audit payload is trimmed to the same limits as a human entry", async () => {
    const { scheduler, auditCalls } = makeStore([
      row({ id: "u6", status: "SUSPENDED", suspendedUntil: past }),
    ]);
    await scheduler.releaseExpiredSuspensions(BASE);
    // System rows go through the same `recordAudit` body, so the column caps
    // apply identically — a scheduler cannot overflow the row either.
    expect(auditCalls[0].action.length).toBeLessThanOrEqual(64);
    expect((auditCalls[0].detail ?? "").length).toBeLessThanOrEqual(2000);
  });

  it("a failing audit write does not fail the sweep or block later ticks", async () => {
    const { store, scheduler, recordSystemAudit } = makeStore([
      row({ id: "u7", status: "SUSPENDED", suspendedUntil: past }),
    ]);
    recordSystemAudit.mockRejectedValueOnce(new Error("audit insert failed"));

    // The release already committed, so the user must stay released even if the
    // audit insert blows up; the gap is surfaced through the logger instead of
    // by locking the account again.
    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(1);
    expect(store.get("u7")!.status).toBe("ACTIVE");

    // A later tick still runs (the in-flight flag was cleared).
    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(0);
  });
});

/**
 * PC-3.1c — the released user is told, and telling them cannot undo the release.
 *
 * The sweep is the whole batch, so the two things that matter are: every released
 * user is notified (recipient = their own id), and one undeliverable notification
 * neither fails the sweep nor stops the users after it. The rows below are the
 * ones the real `NotificationService` hands to the fake client, so the envelope
 * asserted here is the one that would reach PostgreSQL.
 */
describe("UserStatusScheduler — USER_STATUS notification on release", () => {
  const past = new Date(BASE.getTime() - 60_000);

  it("each released user is notified with targetType USER and status ACTIVE", async () => {
    const { scheduler, notificationRows } = makeStore([
      row({ id: "released-1", status: "SUSPENDED", suspendedUntil: past }),
      row({ id: "released-2", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(2);

    expect(notificationRows).toHaveLength(2);
    expect(notificationRows.map((r) => r.userId).sort()).toEqual(["released-1", "released-2"]);
    for (const row of notificationRows) {
      expect(row.type).toBe("USER_STATUS");
      expect(row.title).toBe("账号状态已更新");
      const data = JSON.parse(row.data ?? "{}") as Record<string, unknown>;
      // The recipient is the target, and there is no actor: a timer is nobody.
      expect(data).toEqual({ targetType: "USER", targetId: row.userId, status: "ACTIVE" });
      expect(data).not.toHaveProperty("actorId");
      expect(data).not.toHaveProperty("suspendedUntil");
    }
  });

  it("a user whose deadline has not passed is not notified", async () => {
    const { scheduler, notificationRows } = makeStore([
      row({ id: "still-suspended", status: "SUSPENDED", suspendedUntil: new Date(BASE.getTime() + 60_000) }),
    ]);

    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(0);
    expect(notificationRows).toEqual([]);
  });

  it("a BANNED user is not notified", async () => {
    const { scheduler, notificationRows } = makeStore([
      row({ id: "banned-1", status: "BANNED", suspendedUntil: past, bannedAt: BASE }),
    ]);

    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(0);
    expect(notificationRows).toEqual([]);
  });

  it("a re-tick does not send a second notification", async () => {
    const { scheduler, notificationRows } = makeStore([
      row({ id: "once", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    await scheduler.releaseExpiredSuspensions(BASE);
    await scheduler.releaseExpiredSuspensions(BASE);

    expect(notificationRows).toHaveLength(1);
  });

  it("the notification carries no administrator identity", async () => {
    const { scheduler, notificationRows } = makeStore([
      row({ id: "private", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    await scheduler.releaseExpiredSuspensions(BASE);

    const serialized = JSON.stringify(notificationRows);
    for (const forbidden of ["email", "passwordHash", "token", "adminId", "adminName", "actorId", "reason"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("one undeliverable notification neither fails the sweep nor stops the batch", async () => {
    const rows = [
      row({ id: "first", status: "SUSPENDED", suspendedUntil: past }),
      row({ id: "second", status: "SUSPENDED", suspendedUntil: past }),
    ];
    const store = new Map(rows.map((r) => [r.id, { ...r }]));
    const delivered: string[] = [];
    const prisma = {
      user: {
        updateManyAndReturn: jest.fn(async () => {
          for (const current of store.values()) {
            Object.assign(current, { status: "ACTIVE", suspendedUntil: null });
          }
          return [{ id: "first" }, { id: "second" }];
        }),
      },
      notification: {
        create: jest.fn(async (args: { data: { userId: string } }) => {
          // The first delivery fails; the second must still be attempted.
          if (args.data.userId === "first") throw new Error("notification table unavailable");
          delivered.push(args.data.userId);
          return args.data;
        }),
      },
    };
    const scheduler = new UserStatusScheduler(
      prisma as never,
      { recordSystemAudit: jest.fn(async () => ({ id: "a" })), recordAudit: jest.fn() } as never,
      new NotificationService(prisma as never),
    );

    // The release is the safety-critical half: it must survive a broken
    // notification path, and the batch must not stop at the first failure.
    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(2);
    expect(store.get("first")!.status).toBe("ACTIVE");
    expect(store.get("second")!.status).toBe("ACTIVE");
    expect(delivered).toEqual(["second"]);
  });
});
