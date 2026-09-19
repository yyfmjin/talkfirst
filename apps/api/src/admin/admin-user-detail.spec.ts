import { NotFoundException } from "@nestjs/common";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  USER_DETAIL_AUDIT_SELECT,
  USER_DETAIL_SELECT,
} from "./admin.service";
import { permissionsForRole, ROLE_ALLOWED_STATUS_ACTIONS } from "./permissions";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";

/**
 * Phase A+ — `GET /admin/users/:id` must 404 for an unknown id.
 *
 * The bug: `AdminService.userDetail` returned whatever `findUnique` produced,
 * and the controller wrapped it in the success envelope. For an id that does not
 * exist that meant **HTTP 200 with `{ success: true, data: null }`** — a caller
 * could not tell "no such user" from "user exists but is empty", and the console
 * hung on 「加载中…」 forever because `data` was never truthy and no error was
 * raised.
 *
 * These tests pin the fix at the layer that can actually regress: the service
 * throws, and the controller therefore cannot emit the success envelope. The
 * over-the-wire 404 is asserted in `apps/admin/test/e2e/admin-user-detail.spec.ts`
 * and in `scripts/phaseA-rbac-verify.mjs`.
 *
 * ## Phase B3 additions
 *
 * B3 turned this endpoint into one aggregate: the profile plus six real totals
 * plus a recent-audit page. The tests below cover the new numbers, the explicit
 * selects that replaced three bare relation reads, and the sensitive-field
 * guarantee that widening a response is most likely to break.
 *
 * The pre-B3 assertions were kept, not deleted. Two of them needed their
 * *expectations* widened because the response legitimately grew — that is a
 * contract update, and the assertions still test exactly what they always did
 * (a found user is returned inside the success envelope, looked up by primary
 * key). Nothing was weakened or removed.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
type Call = {
  where?: Record<string, unknown>;
  select?: Record<string, unknown>;
  include?: unknown;
  orderBy?: Record<string, unknown>;
  take?: number;
};

/**
 * Emulates Prisma's `select` projection, including nested relation selects.
 *
 * This is the load-bearing part of the harness. The fixture rows below carry
 * real secrets (`passwordHash`, `tokenHash`) and real report internals
 * (`description`), so if a query ever stops naming its fields the projection
 * returns those keys and the deep scans fail — which is the only way a unit test
 * can prove an *absence* that the code does not itself declare.
 */
function project(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue;
    const raw = row[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = (value as { select?: Record<string, unknown> }).select;
      if (Array.isArray(raw)) {
        out[key] = raw.map((item) => (nested ? project(item as Row, nested) : item));
      } else if (raw === null || raw === undefined) {
        out[key] = null;
      } else if (nested) {
        out[key] = project(raw as Row, nested);
      } else {
        out[key] = raw;
      }
    } else {
      out[key] = raw ?? null;
    }
  }
  return out;
}

/** Every key path in a JSON value, so a failure can name *where* the leak is. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => keyPaths(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...keyPaths(child, path)];
    });
  }
  return [];
}

/**
 * A `User` row as the database would hand it over — deliberately including the
 * columns this endpoint must never expose.
 */
const userRow: Row = {
  id: USER_ID,
  email: "member@example.test",
  passwordHash: "$2a$10$0123456789012345678901234567890123456789012345678901",
  emailVerified: true,
  status: "ACTIVE",
  nickname: "member",
  avatarUrl: null,
  birthDate: null,
  countryCode: "US",
  city: null,
  gender: "UNKNOWN",
  bio: null,
  lastActiveAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  isAdmin: false,
  bannedAt: null,
  banReason: null,
  suspendedUntil: null,
  adminUser: null,
  reportsReceived: [
    {
      id: "report-1",
      reporterId: "33333333-3333-4333-8333-333333333333",
      reportedUserId: USER_ID,
      messageId: null,
      reason: "SPAM",
      // Not selected by B3 — must not appear in the response.
      description: "internal triage note",
      status: "OPEN",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  ],
  reportsMade: [],
  adminNotes: [
    {
      id: "note-1",
      userId: USER_ID,
      adminId: ADMIN_ID,
      body: "looked into it",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
  ],
  // Decoy relations: no query may reach these, and none may ride along.
  refreshTokens: [{ id: "rt-1", tokenHash: "hash", ip: "1.2.3.4", userAgent: "curl" }],
  socialAccounts: [{ id: "sa-1", userId: USER_ID, platform: "TELEGRAM", handle: "@member" }],
  connectionsA: [],
  connectionsB: [],
  blocksMade: [],
  blocksReceived: [],
};

type Counts = {
  connection?: number;
  reportsReceived?: number;
  reportsMade?: number;
  blocksMade?: number;
  blocksReceived?: number;
  socialAccount?: number;
};

/** The audit row the endpoint's `findMany` returns when none is supplied. */
function auditRow(overrides: Row = {}): Row {
  return {
    id: "audit-1",
    action: "ADMIN_USER_BAN",
    targetType: "USER",
    targetId: USER_ID,
    actorType: "USER",
    adminId: ADMIN_ID,
    reason: "harassment",
    detail: "ban: harassment",
    before: { status: "ACTIVE" },
    after: { status: "BANNED" },
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    // Not selected — belongs to the audit screen only.
    ip: "203.0.113.7",
    userAgent: "jest/1.0",
    ...overrides,
  };
}

function makeService(found: Row | null = userRow, counts: Counts = {}, audit: Row[] = []) {
  const calls: { findUnique: Call[]; findMany: Call[]; count: (Call & { model: string })[] } = {
    findUnique: [],
    findMany: [],
    count: [],
  };

  const tx = {
    user: {
      findUnique: jest.fn(async (args: Call) => {
        calls.findUnique.push(args);
        return found ? project(found, args.select) : null;
      }),
    },
    connection: {
      count: jest.fn(async (args: Call) => {
        calls.count.push({ ...args, model: "connection" });
        return counts.connection ?? 0;
      }),
    },
    report: {
      count: jest.fn(async (args: Call) => {
        calls.count.push({ ...args, model: "report" });
        // The two report counts differ only by which column is filtered on.
        return "reportedUserId" in (args.where ?? {})
          ? (counts.reportsReceived ?? 0)
          : (counts.reportsMade ?? 0);
      }),
    },
    block: {
      count: jest.fn(async (args: Call) => {
        calls.count.push({ ...args, model: "block" });
        return "blockerId" in (args.where ?? {}) ? (counts.blocksMade ?? 0) : (counts.blocksReceived ?? 0);
      }),
    },
    socialAccount: {
      count: jest.fn(async (args: Call) => {
        calls.count.push({ ...args, model: "socialAccount" });
        return counts.socialAccount ?? 0;
      }),
    },
    adminAuditLog: {
      findMany: jest.fn(async (args: Call) => {
        calls.findMany.push(args);
        return audit.map((row) => project(row, args.select));
      }),
    },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), prisma, tx, calls };
}

describe("GET /admin/users/:id — unknown id", () => {
  it("1. userDetail throws a 404 instead of resolving to null", async () => {
    const { service } = makeService(null);

    await expect(service.userDetail("does-not-exist")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("2. the 404 uses the project error envelope and a domain code", async () => {
    const { service } = makeService(null);

    // The filter passes an exception payload through untouched when it carries
    // `success`, so whatever is asserted here is what the client receives.
    await expect(service.userDetail("does-not-exist")).rejects.toMatchObject({
      status: 404,
      response: {
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      },
    });
  });

  it("3. the controller cannot emit { success: true, data: null } for a missing user", async () => {
    const { service } = makeService(null);
    const controller = new AdminController(service);

    // If this ever resolves, the route is back to answering 200 with a null body.
    await expect(controller.user("does-not-exist")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("4. an existing user is still returned inside the success envelope", async () => {
    const { service, prisma, calls } = makeService(userRow);
    const controller = new AdminController(service);

    const body = await controller.user(USER_ID);

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: USER_ID, email: "member@example.test", status: "ACTIVE" });
    // The lookup is by primary key, and it happens exactly once.
    expect(calls.findUnique).toHaveLength(1);
    expect(calls.findUnique[0]).toMatchObject({ where: { id: USER_ID } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("4b. a missing user short-circuits before any count runs", async () => {
    const { service, calls } = makeService(null);

    await expect(service.userDetail(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    // Eight wasted aggregates on a 404 would be a quiet cost on every bad link.
    expect(calls.count).toHaveLength(0);
    expect(calls.findMany).toHaveLength(0);
  });
});

describe("GET /admin/users/:id — Phase B3 read access", () => {
  it("1-5. every role that may read the list may also read the detail", () => {
    for (const role of [
      "SUPER_ADMIN",
      "MODERATOR",
      "SUPPORT",
      "ANALYST",
      "CONTENT_MANAGER",
    ] as const) {
      expect(permissionsForRole(role)).toContain("users:read");
    }
  });

  it("5b. the detail route declares users:read, not a wider permission", () => {
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.user)).toBe(
      "users:read",
    );
  });

  it("5c. reading the detail does not require or grant users:write", () => {
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.user)).not.toBe(
      "users:write",
    );
    // The aggregate is read-only: nothing in B3 adds a write to this path.
    expect(ROLE_ALLOWED_STATUS_ACTIONS.ANALYST).toEqual([]);
    expect(ROLE_ALLOWED_STATUS_ACTIONS.CONTENT_MANAGER).toEqual([]);
  });
});

describe("GET /admin/users/:id — Phase B3 aggregate", () => {
  it("7. profileCompletion reuses the project's existing rule (nickname + birthDate)", async () => {
    const { service } = makeService(userRow);

    const detail = await service.userDetail(USER_ID);

    // `userRow` has a nickname but no birth date.
    expect(detail.profileCompleted).toBe(false);
    expect(detail.profileCompletion).toEqual({
      completed: 1,
      total: 2,
      percentage: 50,
      missing: ["birthDate"],
    });
  });

  it("7b. both fields present is 2 / 2 and profileCompleted true", async () => {
    const { service } = makeService({
      ...userRow,
      birthDate: new Date("1998-05-04T00:00:00.000Z"),
    });

    const detail = await service.userDetail(USER_ID);

    expect(detail.profileCompleted).toBe(true);
    expect(detail.profileCompletion).toEqual({
      completed: 2,
      total: 2,
      percentage: 100,
      missing: [],
    });
  });

  it("7c. neither field present is 0 / 2, and the boolean agrees with the score", async () => {
    const { service } = makeService({ ...userRow, nickname: null });

    const detail = await service.userDetail(USER_ID);

    expect(detail.profileCompleted).toBe(false);
    expect(detail.profileCompletion).toEqual({
      completed: 0,
      total: 2,
      percentage: 0,
      missing: ["nickname", "birthDate"],
    });
  });

  it("7d. an empty-string nickname counts as missing, matching the pre-B3 Boolean(...)", async () => {
    const { service } = makeService({ ...userRow, nickname: "" });

    const detail = await service.userDetail(USER_ID);

    // `Boolean("")` was already false before B3; the extraction must not have
    // changed that, or existing accounts would silently reclassify.
    expect(detail.profileCompletion.missing).toContain("nickname");
    expect(detail.profileCompleted).toBe(false);
  });

  it("7e. the raw birthDate is not part of the response", async () => {
    const { service } = makeService({
      ...userRow,
      birthDate: new Date("1998-05-04T00:00:00.000Z"),
    });

    const detail = await service.userDetail(USER_ID);

    // Read to evaluate the rule, then dropped — it is not in the B3 contract.
    expect(detail).not.toHaveProperty("birthDate");
  });

  it("8. connectionCount counts ACTIVE connections on either side", async () => {
    const { service, calls } = makeService(userRow, { connection: 7 });

    const detail = await service.userDetail(USER_ID);

    expect(detail.connectionCount).toBe(7);
    const call = calls.count.find((entry) => entry.model === "connection");
    expect(call?.where).toEqual({
      status: "ACTIVE",
      OR: [{ userAId: USER_ID }, { userBId: USER_ID }],
    });
  });

  it("8b. a REMOVED connection is not counted (existing Connection semantics)", async () => {
    const { service, calls } = makeService(userRow, { connection: 3 });

    await service.userDetail(USER_ID);

    // The filter is what enforces this: no status filter would count REMOVED rows
    // too, and would disagree with the dashboard's own `connections` KPI.
    expect(calls.count.find((entry) => entry.model === "connection")?.where).toMatchObject({
      status: "ACTIVE",
    });
  });

  it("9-10. report counts are separate totals, filtered on the correct column", async () => {
    const { service, calls } = makeService(userRow, { reportsReceived: 12, reportsMade: 4 });

    const detail = await service.userDetail(USER_ID);

    expect(detail.reportsReceivedCount).toBe(12);
    expect(detail.reportsMadeCount).toBe(4);

    const reportCalls = calls.count.filter((entry) => entry.model === "report");
    expect(reportCalls).toHaveLength(2);
    expect(reportCalls.map((entry) => entry.where)).toEqual([
      { reportedUserId: USER_ID },
      { reporterId: USER_ID },
    ]);
  });

  it("9b. a total larger than the recent list is reported honestly", async () => {
    const { service } = makeService(userRow, { reportsReceived: 40 });

    const detail = await service.userDetail(USER_ID);

    // Pre-B3 the screen showed `reportsReceived.length`, i.e. the 10-row window.
    expect(detail.reportsReceivedCount).toBe(40);
    expect(detail.reportsReceived.length).toBeLessThan(40);
  });

  it("11-12. block counts are separate totals, filtered on the correct column", async () => {
    const { service, calls } = makeService(userRow, { blocksMade: 5, blocksReceived: 2 });

    const detail = await service.userDetail(USER_ID);

    expect(detail.blocksMadeCount).toBe(5);
    expect(detail.blocksReceivedCount).toBe(2);

    const blockCalls = calls.count.filter((entry) => entry.model === "block");
    expect(blockCalls.map((entry) => entry.where)).toEqual([
      { blockerId: USER_ID },
      { blockedId: USER_ID },
    ]);
  });

  it("13. socialAccountCount is a count, and no account data is returned", async () => {
    const { service } = makeService(userRow, { socialAccount: 3 });

    const detail = await service.userDetail(USER_ID);

    expect(detail.socialAccountCount).toBe(3);
    // Only the number — no handle, no platform, no token.
    expect(detail).not.toHaveProperty("socialAccounts");
  });

  it("14. auditSummary is scoped to this user and shaped by the allowlist", async () => {
    const { service, calls } = makeService(userRow, {}, [auditRow()]);

    const detail = await service.userDetail(USER_ID);

    expect(calls.findMany).toHaveLength(1);
    expect(calls.findMany[0]).toMatchObject({
      where: { targetType: "USER", targetId: USER_ID },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    expect(detail.auditSummary).toHaveLength(1);
    expect(Object.keys(detail.auditSummary[0]).sort()).toEqual(
      Object.keys(USER_DETAIL_AUDIT_SELECT).sort(),
    );
  });

  it("15. empty relations are empty arrays, never null or undefined", async () => {
    const { service } = makeService({ ...userRow, reportsMade: [], adminNotes: [] }, {}, []);

    const detail = await service.userDetail(USER_ID);

    expect(detail.reportsMade).toEqual([]);
    expect(detail.adminNotes).toEqual([]);
    expect(detail.auditSummary).toEqual([]);
    expect(detail.connectionCount).toBe(0);
    expect(detail.reportsReceivedCount).toBe(0);
    expect(detail.blocksMadeCount).toBe(0);
    expect(detail.blocksReceivedCount).toBe(0);
    expect(detail.socialAccountCount).toBe(0);
  });

  it("16. every relation read is an explicit select — no bare include anywhere", async () => {
    const { service, calls } = makeService(userRow, {}, [auditRow()]);

    await service.userDetail(USER_ID);

    expect(calls.findUnique[0].include).toBeUndefined();
    expect(calls.findMany[0].include).toBeUndefined();
    // The three relations that used to be read without a `select`.
    const select = calls.findUnique[0].select ?? {};
    for (const relation of ["reportsReceived", "reportsMade", "adminNotes"]) {
      expect((select[relation] as { select?: unknown }).select).toBeDefined();
    }
    expect(USER_DETAIL_SELECT.reportsReceived).toHaveProperty("select");
    expect(USER_DETAIL_SELECT.reportsMade).toHaveProperty("select");
    expect(USER_DETAIL_SELECT.adminNotes).toHaveProperty("select");
  });

  it("16b. the detail select names exactly the fields it exposes", async () => {
    // A widened select is how a secret reaches a browser, so the field list is
    // pinned rather than trusted.
    expect(Object.keys(USER_DETAIL_SELECT).sort()).toEqual(
      [
        "adminNotes",
        "adminUser",
        "avatarUrl",
        "banReason",
        "bannedAt",
        "birthDate",
        "countryCode",
        "createdAt",
        "email",
        "id",
        "isAdmin",
        "lastActiveAt",
        "nickname",
        "reportsMade",
        "reportsReceived",
        "status",
        "suspendedUntil",
      ].sort(),
    );
  });

  it("17-20. no secret reaches the response, at any depth", async () => {
    const { service } = makeService(userRow, {}, [auditRow()]);

    const detail = await service.userDetail(USER_ID);
    const paths = keyPaths(detail);

    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "oauth",
      "secret",
    ]) {
      expect(paths.filter((path) => path.toLowerCase().includes(forbidden.toLowerCase()))).toEqual([]);
    }
    // The fixture *does* carry these keys, so the scan is not vacuous.
    expect(keyPaths(userRow)).toContain("passwordHash");
    expect(keyPaths(userRow)).toContain("refreshTokens[0].tokenHash");
  });

  it("20b. a report's internal description is not exposed", async () => {
    const { service } = makeService(userRow, {}, [auditRow()]);

    const detail = await service.userDetail(USER_ID);

    expect(JSON.stringify(detail)).not.toContain("internal triage note");
  });

  it("21-22. ip and userAgent stay off the user detail payload", async () => {
    const { service } = makeService(userRow, {}, [auditRow()]);

    const detail = await service.userDetail(USER_ID);
    const paths = keyPaths(detail);

    expect(paths.filter((path) => /(^|\.)ip$/.test(path))).toEqual([]);
    expect(paths.filter((path) => /userAgent$/i.test(path))).toEqual([]);
    // Not vacuous: the audit fixture carries both, and the select excludes them.
    expect(USER_DETAIL_AUDIT_SELECT).not.toHaveProperty("ip");
    expect(USER_DETAIL_AUDIT_SELECT).not.toHaveProperty("userAgent");
    expect(JSON.stringify(detail)).not.toContain("203.0.113.7");
  });

  it("23. a SYSTEM audit row is safe: adminId null, actorType SYSTEM", async () => {
    const { service } = makeService(userRow, {}, [
      auditRow({ id: "audit-sys", actorType: "SYSTEM", adminId: null, action: "USER_SUSPENSION_EXPIRED" }),
    ]);

    const detail = await service.userDetail(USER_ID);

    expect(detail.auditSummary[0]).toMatchObject({ actorType: "SYSTEM", adminId: null });
    // The distinction the UI depends on: a null adminId must never be an id.
    expect(typeof detail.auditSummary[0].adminId).not.toBe("string");
  });

  it("24. a USER audit row keeps its acting administrator", async () => {
    const { service } = makeService(userRow, {}, [auditRow()]);

    const detail = await service.userDetail(USER_ID);

    expect(detail.auditSummary[0]).toMatchObject({ actorType: "USER", adminId: ADMIN_ID });
  });

  it("24b. the aggregate is exactly eight reads, inside one transaction, and no write", async () => {
    const { service, calls, prisma } = makeService(userRow, {}, [auditRow()]);

    await service.userDetail(USER_ID);

    // One user lookup, six counts (connection, two report, two block, social)
    // and one audit page. Pinned as an exact number on purpose: if this grows, a
    // mutation or a stray query has crept into a GET.
    expect(calls.findUnique).toHaveLength(1);
    expect(calls.count).toHaveLength(6);
    expect(calls.findMany).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
