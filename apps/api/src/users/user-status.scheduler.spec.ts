import { UserStatusScheduler } from "./user-status.scheduler";
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

function makeStore(rows: Row[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));

  const updateMany = jest.fn(async ({ where, data }: UpdateManyArgs) => {
    let count = 0;
    for (const current of store.values()) {
      const matches =
        current.status === where.status &&
        current.suspendedUntil !== null &&
        current.suspendedUntil.getTime() <= where.suspendedUntil.lte.getTime();
      if (!matches) continue;
      // `updatedAt` is @updatedAt in the schema, so every real write bumps it.
      Object.assign(current, data, { updatedAt: new Date(BASE.getTime() + 1000) });
      count += 1;
    }
    return { count };
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

  const prisma = { user: { updateMany } };
  const scheduler = new UserStatusScheduler(prisma as never, admin as never);
  return { store, updateMany, scheduler, auditCalls, recordSystemAudit, recordAudit };
}

/** Builds a scheduler whose AdminService stub is not needed by the test. */
function makeBareScheduler(prisma: unknown) {
  return new UserStatusScheduler(prisma as never, {
    recordSystemAudit: jest.fn(async () => ({ id: "audit" })),
    recordAudit: jest.fn(async () => ({ id: "human-audit" })),
  } as never);
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
    const { updateMany, scheduler } = makeStore([
      row({ id: "contract", status: "SUSPENDED", suspendedUntil: past }),
    ]);

    await scheduler.releaseExpiredSuspensions(BASE);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { status: "SUSPENDED", suspendedUntil: { not: null, lte: BASE } },
      data: { status: "ACTIVE", suspendedUntil: null, bannedAt: null, banReason: null },
    });
  });

  it("the cron handler swallows a database error instead of crashing", async () => {
    const updateMany = jest.fn(async () => {
      throw new Error("connection terminated");
    });
    const scheduler = makeBareScheduler({ user: { updateMany } });

    await expect(scheduler.handleSuspensionExpiry()).resolves.toBeUndefined();
  });

  it("a failed sweep still clears the in-flight flag so later ticks run", async () => {
    let call = 0;
    const updateMany = jest.fn(async (_args: UpdateManyArgs): Promise<{ count: number }> => {
      call += 1;
      if (call === 1) throw new Error("transient");
      return { count: 0 };
    });
    const scheduler = makeBareScheduler({ user: { updateMany } });

    await expect(scheduler.releaseExpiredSuspensions(BASE)).rejects.toThrow("transient");
    // If the in-flight guard leaked, this second call would be skipped and
    // return 0 without ever reaching the database.
    await expect(scheduler.releaseExpiredSuspensions(BASE)).resolves.toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("skips a tick that overlaps a sweep which is still running", async () => {
    let releaseGate: (value: { count: number }) => void = () => undefined;
    const gate = new Promise<{ count: number }>((resolve) => {
      releaseGate = resolve;
    });
    const updateMany = jest.fn(async (_args: UpdateManyArgs) => gate);
    const scheduler = makeBareScheduler({ user: { updateMany } });

    const inFlight = scheduler.releaseExpiredSuspensions(BASE); // parks on the gate
    const overlapped = await scheduler.releaseExpiredSuspensions(BASE);

    expect(overlapped).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(1); // the second tick never queried

    releaseGate({ count: 0 });
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
