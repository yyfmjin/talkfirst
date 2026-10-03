import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  REPORT_DETAIL_SELECT,
  REPORT_HISTORY_SELECT,
  REPORT_LIST_SELECT,
  type AdminReportListQuery,
} from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";
import { reflectorReturning } from "./test-reflector";

/**
 * Phase B4 — the reports queue and report detail.
 *
 * What is pinned here, and why each is not obvious:
 *
 *   1. **`targetType` is derived, and the filter and the label share one rule.**
 *      `Report` has no `targetType` column; it has two nullable pointers. The
 *      priority is `MOMENT > MESSAGE > USER` (PC-2.5.3), meaning
 *      `momentId IS NOT NULL` → `MOMENT`, else `messageId IS NOT NULL` →
 *      `MESSAGE`, else `USER`. If the filter and the value shown on the row ever
 *      disagreed, an operator would filter for "moment reports" and get rows
 *      labelled "user" — so every reading is asserted against the same fixtures.
 *
 *   2. **A missing target is a normal outcome, not a 500.** Neither
 *      `Report.messageId` nor `Report.momentId` has a foreign key, so a row can
 *      outlive either. A hard-deleted or soft-deleted message — or a moment that
 *      is simply gone — must produce `available: false`, never a thrown error
 *      and never a raw Prisma message on the wire.
 *
 *   3. **`count` and `findMany` see the same filter.** If they diverged, the
 *      total would describe a different result set than the rows and pagination
 *      would be wrong. Every filter test asserts both calls.
 *
 *   4. **Failures write no audit.** A 400/403/404 review attempt must leave the
 *      audit log untouched; only a successful transition writes exactly one
 *      `REPORT_*` row with `actorType = USER` and the acting admin's id.
 *
 *   5. **Nothing leaks.** The list is one of the widest responses in the
 *      console. The mock projects each row through the `select` the service
 *      asked for, exactly as Prisma would, so widening that select to include
 *      `passwordHash` makes the value appear and fail the deep scan — instead of
 *      passing because the fixture never held it.
 *
 * Real HTTP for all five roles, and every count against live PostgreSQL, are
 * verified in `scripts/phaseA-rbac-verify.mjs` (§4).
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

const admin = (role: AdminRole): ResolvedAdmin => ({
  userId: ADMIN_ID,
  adminUserId: "adminuser-1",
  role,
  isActive: true,
  legacy: false,
});

const ALL_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "MODERATOR",
  "SUPPORT",
  "ANALYST",
  "CONTENT_MANAGER",
];

const READ_ONLY_ROLES: AdminRole[] = ["SUPPORT", "ANALYST", "CONTENT_MANAGER"];
const WRITE_ROLES: AdminRole[] = ["SUPER_ADMIN", "MODERATOR"];

const ADMIN_ID = "9c4e1a52-7b3d-4e6f-8a11-2d5f9c0b7e34";
const REPORT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const MESSAGE_ID = "7f8e9d0c-1b2a-4c3d-9e8f-7a6b5c4d3e2f";
const MOMENT_ID = "8e7d6c5b-4a39-4281-9706-5c4d3e2f1a0b";
const REPORTER_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";
const REPORTED_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const GHOST_MESSAGE_ID = "00000000-1111-4222-8333-444444444444";
const GHOST_MOMENT_ID = "00000000-2222-4333-8444-555555555555";

/** A report row as it comes back with a *wide* select, secrets included. */
type ReportRow = {
  id: string;
  reason: string;
  description: string | null;
  status: string;
  messageId: string | null;
  momentId: string | null;
  createdAt: Date;
  reporter: Party;
  reportedUser: Party & { status: string };  // Present on the fixture on purpose: widening the select to include either of
  // these carries them into the response, where the deep scan fails. A fixture
  // without them could never catch that mistake.
  passwordHash: string;
  tokenHash: string;
};

type Party = {
  id: string;
  nickname: string | null;
  email: string;
  status: string;
  passwordHash?: string;
};

const REPORTER: Party = {
  id: REPORTER_ID,
  nickname: "Ann",
  email: "ann@example.test",
  status: "ACTIVE",
  passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
};

const REPORTED: Party = {
  id: REPORTED_ID,
  nickname: "Bob",
  email: "bob@example.test",
  status: "ACTIVE",
  passwordHash: "$2a$10$zyxwvutsrqponmlkjihgfe",
};

const USER_REPORT: ReportRow = {
  id: REPORT_ID,
  reason: "Harassment",
  description: "repeated messages",
  status: "OPEN",
  messageId: null,
  momentId: null,
  createdAt: new Date("2026-03-04T05:06:07.000Z"),
  reporter: REPORTER,
  reportedUser: REPORTED,
  passwordHash: "$2a$10$leakleakleakleakleakle",
  tokenHash: "eyJhbGciOiJIUzI1NiJ9.refresh.payload",
};

const MESSAGE_REPORT: ReportRow = {
  ...USER_REPORT,
  id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  reason: "Spam",
  messageId: MESSAGE_ID,
};

/**
 * PC-2.5.3: a report on a Moment.
 *
 * Written the way the API writes one — `momentId` set and `messageId` null —
 * because that shape is what the derived label has to survive. `momentId` has
 * no foreign key, so this row is expected to outlive the moment it points at.
 */
const MOMENT_REPORT: ReportRow = {
  ...USER_REPORT,
  id: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
  reason: "Inappropriate",
  messageId: null,
  momentId: MOMENT_ID,
};

/** The moment row as it comes back with a *wide* select, secrets included. */
const MOMENT_ROW = {
  id: MOMENT_ID,
  content: "testing the new profile layout",
  platform: "X",
  source: "USER",
  createdAt: new Date("2026-03-02T09:08:07.000Z"),
  // Neither of these is returned by momentSummary. They are here so that
  // widening its select carries them onto the wire and fails the deep scan
  // below, rather than passing because the fixture happened to be clean.
  videoUrl: "https://cdn.example.test/secret-clip.mp4",
  user: {
    id: REPORTED_ID,
    nickname: "Bob",
    email: "bob@example.test",
    passwordHash: "$2a$10$zyxwvutsrqponmlkjihgfe",
  },
};

/** The argument objects the service hands to Prisma. */
type Call = {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  skip?: number;
  take?: number;
  select?: Record<string, unknown>;
  include?: unknown;
  data?: Record<string, unknown>;
};

/** Emulates Prisma's select: only the named columns come back, recursively. */
function project(row: Record<string, unknown>, select: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (!select[key]) continue;
    const spec = select[key];
    const value = row[key];
    if (value !== null && typeof value === "object" && spec !== null && typeof spec === "object") {
      const nested = spec as { select?: Record<string, unknown> };
      out[key] = nested.select ? project(value as Record<string, unknown>, nested.select) : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

type HarnessOptions = {
  total?: number;
  rows?: ReportRow[];
  /** `null` models `findUnique` finding nothing. */
  detailRow?: ReportRow | null;
  message?: Record<string, unknown> | null;
  /** PC-2.5.3: `null` models the moment having been deleted. */
  moment?: Record<string, unknown> | null;
  history?: Array<Record<string, unknown>>;
  existingReport?: { id: string; status: string; reportedUserId: string } | null;
};

function makeService(opts: HarnessOptions = {}) {
  const calls = {
    count: [] as Call[],
    findMany: [] as Call[],
    detailFindUnique: [] as Call[],
    messageFindUnique: [] as Call[],
    momentFindUnique: [] as Call[],
    historyFindMany: [] as Call[],
    reportUpdate: [] as Call[],
    auditCreate: [] as Call[],
    reportFindUnique: [] as Call[],
  };

  const count = jest.fn(async (args: Call = {}) => {
    calls.count.push(args);
    return opts.total ?? (opts.rows ?? [USER_REPORT]).length;
  });

  const findMany = jest.fn(async (args: Call) => {
    calls.findMany.push(args);
    return (opts.rows ?? [USER_REPORT]).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const messageFindUnique = jest.fn(async (args: Call) => {
    calls.messageFindUnique.push(args);
    if (opts.message === undefined) {
      return {
        id: MESSAGE_ID,
        content: "meet me at the usual place",
        type: "TEXT",
        createdAt: new Date("2026-03-03T01:02:03.000Z"),
        deletedAt: null,
        sender: { id: REPORTER_ID, nickname: "Ann", email: "ann@example.test" },
      };
    }
    return opts.message;
  });

  /**
   * PC-2.5.3: the moment lookup behind the detail page.
   *
   * Projected through the caller's `select` exactly as Prisma would, and the
   * fixture carries `passwordHash` / `videoUrl` on purpose: widening
   * `momentSummary`'s select would then put them on the wire and the deep scan
   * in test 39 would fail, instead of passing because the fixture was clean.
   */
  const momentFindUnique = jest.fn(async (args: Call) => {
    calls.momentFindUnique.push(args);
    const row = opts.moment === undefined ? MOMENT_ROW : opts.moment;
    if (!row) return null;
    return project(row as unknown as Record<string, unknown>, args.select ?? {});
  });

  const historyFindMany = jest.fn(async (args: Call) => {
    calls.historyFindMany.push(args);
    return (
      opts.history ?? [
        {
          id: "audit-1",
          action: "REPORT_REVIEWING",
          targetType: "REPORT",
          targetId: REPORT_ID,
          actorType: "USER",
          adminId: ADMIN_ID,
          reason: "looking into it",
          detail: "looking into it",
          before: { status: "OPEN" },
          after: { status: "REVIEWING" },
          createdAt: new Date("2026-03-05T00:00:00.000Z"),
        },
      ]
    ).map((row) => project(row, args.select ?? {}));
  });

  /**
   * One `findUnique` stands behind both call sites.
   *
   * `reportDetail` selects the display columns; `reviewReport` selects
   * `{ id, status, reportedUserId }`. Prisma returns whichever columns were
   * asked for, so this projects through the caller's `select` and lets the two
   * shapes coexist — otherwise the review lookup would shadow the detail one
   * and every detail test would see a status-only row.
   */
  const reportFindUnique = jest.fn(async (args: Call) => {
    calls.reportFindUnique.push(args);
    const select = args.select ?? {};
    const wantsDisplayColumns = "reason" in select;

    if (wantsDisplayColumns) {
      calls.detailFindUnique.push(args);
      const row = opts.detailRow === undefined ? USER_REPORT : opts.detailRow;
      if (!row) return null;
      return project(row as unknown as Record<string, unknown>, select);
    }

    if (opts.existingReport === null) return null;
    const existing = opts.existingReport ?? {
      id: REPORT_ID,
      status: "OPEN",
      reportedUserId: REPORTED_ID,
    };
    return project(existing as unknown as Record<string, unknown>, select);
  });

  const reportUpdate = jest.fn(async (args: Call) => {
    calls.reportUpdate.push(args);
    const data = (args.data ?? {}) as { status?: string };
    return { id: REPORT_ID, status: data.status ?? "OPEN" };
  });

  const auditCreate = jest.fn(async (args: Call) => {
    calls.auditCreate.push(args);
    return { id: "audit-new" };
  });

  const report = {
    count,
    findMany,
    findUnique: reportFindUnique,
    update: reportUpdate,
  };

  const tx = {
    report,
    message: { findUnique: messageFindUnique },
    moment: { findUnique: momentFindUnique },
    adminAuditLog: { create: auditCreate, findMany: historyFindMany },
    user: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    adminNote: { create: jest.fn(async () => ({ id: "note-1" })) },
    connection: { count: jest.fn(async () => 0) },
    block: { count: jest.fn(async () => 0) },
    socialAccount: { count: jest.fn(async () => 0) },
  };

  const prisma = {
    ...tx,
    report: { ...report, findUnique: reportFindUnique },
    message: { findUnique: messageFindUnique },
    moment: { findUnique: momentFindUnique },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), calls, prisma };
}

/** Runs `listReports` and returns the result plus captured calls. */
async function list(query: AdminReportListQuery, opts: HarnessOptions = {}) {
  const harness = makeService(opts);
  const result = await harness.service.listReports(query);
  return { ...harness, result };
}

/** Every key path in a nested value, e.g. `items[0].reporter.email`. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => keyPaths(entry, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      `${prefix}.${key}`,
      ...keyPaths(child, `${prefix}.${key}`),
    ]);
  }
  return [];
}

/** The field names that must never reach a client, at any depth. */
const FORBIDDEN = [
  "passwordHash",
  "tokenHash",
  "refreshToken",
  "accessToken",
  "oauth",
  "secret",
  "ip",
  "userAgent",
];

function expectNoSecrets(payload: unknown) {
  const paths = keyPaths(payload);
  for (const field of FORBIDDEN) {
    expect(paths.filter((path) => path.toLowerCase().endsWith(`.${field.toLowerCase()}`))).toEqual([]);
  }
}

async function expectValidationError(promise: Promise<unknown>, field: string) {
  await expect(promise).rejects.toBeInstanceOf(BadRequestException);
  try {
    await promise;
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      success: boolean;
      error: { code: string; details?: Record<string, string[]> };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.details ?? {})).toEqual([field]);
  }
}

// ---------------------------------------------------------------------------
// 1-5. role access
// ---------------------------------------------------------------------------

describe("Reports — role access", () => {
  it("1-5. every existing role holds reports:read", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "reports:read")).toBe(true);
    }
  });

  it("1-5b. the list and detail handlers both declare reports:read", () => {
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.reports)).toBe(
      "reports:read",
    );
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.reportDetail),
    ).toBe("reports:read");
  });

  it("1-5c. PermissionGuard admits each role to the reports list", () => {
    for (const role of ALL_ROLES) {
      const guard = new PermissionGuard(reflectorReturning("reports:read"));
      expect(guard.canActivate(httpContext({ admin: admin(role) }))).toBe(true);
    }
  });

  it("1-5d. read-only roles gain reports:read but not reports:write", () => {
    for (const role of READ_ONLY_ROLES) {
      expect(hasPermission(role, "reports:read")).toBe(true);
      expect(hasPermission(role, "reports:write")).toBe(false);
    }
  });

  it("6. a request with no resolved admin identity is rejected", () => {
    const guard = new PermissionGuard(reflectorReturning("reports:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// 7-8. status
// ---------------------------------------------------------------------------

describe("Reports — status filter", () => {
  it("7. a known status becomes a `status` predicate", async () => {
    const { calls } = await list({ status: "REVIEWING" });
    expect(calls.count[0].where).toMatchObject({ status: "REVIEWING" });
    expect(calls.findMany[0].where).toMatchObject({ status: "REVIEWING" });
  });

  it("7b. status is case-normalised", async () => {
    const { calls } = await list({ status: "resolved" });
    expect(calls.findMany[0].where).toMatchObject({ status: "RESOLVED" });
  });

  it("8. an unknown status is ignored, not rejected (pre-B4 behaviour)", async () => {
    const { calls } = await list({ status: "BOGUS" });
    expect(calls.findMany[0].where?.status).toBeUndefined();
    expect(calls.count[0].where?.status).toBeUndefined();
  });

  it("8b. an absent status adds no predicate", async () => {
    const { calls } = await list({});
    expect(calls.findMany[0].where?.status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9-10. reason
// ---------------------------------------------------------------------------

describe("Reports — reason filter", () => {
  it("9. reason is an exact, case-insensitive match", async () => {
    const { calls } = await list({ reason: "Harassment" });
    expect(calls.findMany[0].where?.reason).toEqual({ equals: "Harassment", mode: "insensitive" });
  });

  it("9b. reason is not lowercased before the query (the column is free-form)", async () => {
    const { calls } = await list({ reason: "Spam" });
    expect(calls.findMany[0].where?.reason).toEqual({ equals: "Spam", mode: "insensitive" });
  });

  it("9c. a multi-word reason with a space survives intact", async () => {
    const { calls } = await list({ reason: "Sexual content" });
    expect(calls.findMany[0].where?.reason).toEqual({
      equals: "Sexual content",
      mode: "insensitive",
    });
  });

  it("10. an unmatched reason filters to nothing rather than erroring", async () => {
    const { result } = await list({ reason: "NoSuchReason" }, { rows: [], total: 0 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11-13. derived targetType
// ---------------------------------------------------------------------------

describe("Reports — derived targetType", () => {
  it("11. targetType=USER means neither pointer is set", async () => {
    const { calls } = await list({ targetType: "USER" });
    for (const call of [calls.findMany[0], calls.count[0]]) {
      expect(call.where?.messageId).toBeNull();
      expect(call.where?.momentId).toBeNull();
    }
  });

  it("12. targetType=MESSAGE means a message and no moment", async () => {
    const { calls } = await list({ targetType: "MESSAGE" });
    for (const call of [calls.findMany[0], calls.count[0]]) {
      expect(call.where?.messageId).toEqual({ not: null });
      // Without this, a moment report (messageId null) would answer a message
      // query — the badge and the filter would describe different rows.
      expect(call.where?.momentId).toBeNull();
    }
  });

  it("12b. targetType is case-normalised", async () => {
    const { calls } = await list({ targetType: "message" });
    expect(calls.findMany[0].where?.messageId).toEqual({ not: null });
  });

  it("13. an absent or unknown targetType adds no target predicate at all", async () => {
    for (const query of [{}, { targetType: "ALL" }, { targetType: "WEIRD" }]) {
      const { calls } = await list(query);
      const where = calls.findMany[0].where ?? {};
      expect("messageId" in where).toBe(false);
      expect("momentId" in where).toBe(false);
    }
  });

  it("13b. the filter and the displayed label agree for the same row", async () => {
    // A USER row: neither pointer. The API must both match it under
    // targetType=USER and label it USER — one rule, read two ways.
    const userDetail = await makeService({ detailRow: USER_REPORT }).service.reportDetail(REPORT_ID);
    expect(userDetail.target.targetType).toBe("USER");
    expect(userDetail.report.messageId).toBeNull();
    expect(userDetail.report.momentId).toBeNull();

    const messageDetail = await makeService({ detailRow: MESSAGE_REPORT }).service.reportDetail(
      REPORT_ID,
    );
    expect(messageDetail.target.targetType).toBe("MESSAGE");
    expect(messageDetail.report.messageId).toBe(MESSAGE_ID);

    const momentDetail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(
      REPORT_ID,
    );
    expect(momentDetail.target.targetType).toBe("MOMENT");
    expect(momentDetail.report.momentId).toBe(MOMENT_ID);
  });

  it("12c. targetType=MOMENT means a moment, and says nothing about messages", async () => {
    const { calls } = await list({ targetType: "MOMENT" });
    for (const call of [calls.findMany[0], calls.count[0]]) {
      expect(call.where?.momentId).toEqual({ not: null });
      // The MOMENT arm deliberately does not constrain messageId. A moment
      // report is always written with messageId null, so pinning it here would
      // add a condition with no way to be wrong — and would hide a row that
      // somehow carried both.
      expect("messageId" in (call.where ?? {})).toBe(false);
    }
  });

  it("12d. targetType=MOMENT is case-normalised", async () => {
    const { calls } = await list({ targetType: "moment" });
    expect(calls.findMany[0].where?.momentId).toEqual({ not: null });
  });

  it("12e. the three target predicates are mutually exclusive", async () => {
    const [user, message, moment] = await Promise.all(
      (["USER", "MESSAGE", "MOMENT"] as const).map(async (targetType) => {
        const { calls } = await list({ targetType });
        return calls.findMany[0].where ?? {};
      }),
    );

    // Whatever pointers a row carries, at most one of these three filters can
    // match it — which is what makes "filter by X" and "labelled X" the same
    // claim rather than two rules that happen to agree today.
    expect(user).toEqual({ messageId: null, momentId: null });
    expect(message).toEqual({ momentId: null, messageId: { not: null } });
    expect(moment).toEqual({ momentId: { not: null } });
  });
});

// ---------------------------------------------------------------------------
// 14-17. reporter / reportedUser
// ---------------------------------------------------------------------------

describe("Reports — party filters", () => {
  it("14. a reporter UUID is an exact id match, never a contains", async () => {
    const { calls } = await list({ reporter: REPORTER_ID });
    expect(calls.findMany[0].where?.reporter).toEqual({ id: REPORTER_ID });
  });

  it("15. reporter free text searches email and nickname", async () => {
    const { calls } = await list({ reporter: "ann" });
    expect(calls.findMany[0].where?.reporter).toEqual({
      OR: [
        { email: { contains: "ann", mode: "insensitive" } },
        { nickname: { contains: "ann", mode: "insensitive" } },
      ],
    });
  });

  it("16. a reportedUser UUID is an exact id match", async () => {
    const { calls } = await list({ reportedUser: REPORTED_ID });
    expect(calls.findMany[0].where?.reportedUser).toEqual({ id: REPORTED_ID });
  });

  it("17. reportedUser free text searches email and nickname", async () => {
    const { calls } = await list({ reportedUser: "bob" });
    expect(calls.findMany[0].where?.reportedUser).toEqual({
      OR: [
        { email: { contains: "bob", mode: "insensitive" } },
        { nickname: { contains: "bob", mode: "insensitive" } },
      ],
    });
  });

  it("17b. a blank party filter is dropped rather than matching everything loosely", async () => {
    const { calls } = await list({ reporter: "   " });
    expect(calls.findMany[0].where?.reporter).toBeUndefined();
  });

  it("17c. a UUID must not widen into a text search", async () => {
    const { calls } = await list({ reporter: REPORTER_ID });
    const clause = calls.findMany[0].where?.reporter as Record<string, unknown>;
    expect(clause.OR).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 18-20. dates
// ---------------------------------------------------------------------------

describe("Reports — date range", () => {
  it("18. createdFrom is an inclusive lower bound", async () => {
    const { calls } = await list({ createdFrom: "2026-03-01" });
    const createdAt = calls.findMany[0].where?.createdAt as { gte?: Date; lte?: Date };
    expect(createdAt.gte).toEqual(new Date("2026-03-01"));
    expect(createdAt.lte).toBeUndefined();
  });

  it("19. createdTo is an inclusive upper bound", async () => {
    const { calls } = await list({ createdTo: "2026-03-31T23:59:59.999Z" });
    const createdAt = calls.findMany[0].where?.createdAt as { gte?: Date; lte?: Date };
    expect(createdAt.lte).toEqual(new Date("2026-03-31T23:59:59.999Z"));
  });

  it("19b. both bounds together produce one createdAt block", async () => {
    const { calls } = await list({ createdFrom: "2026-03-01", createdTo: "2026-03-31" });
    const createdAt = calls.findMany[0].where?.createdAt as { gte?: Date; lte?: Date };
    expect(createdAt.gte).toEqual(new Date("2026-03-01"));
    expect(createdAt.lte).toEqual(new Date("2026-03-31"));
  });

  it("20. a non-existent calendar date is a 400 naming the field", async () => {
    await expectValidationError(list({ createdFrom: "2026-02-30" }), "createdFrom");
    await expectValidationError(list({ createdTo: "2026-02-30" }), "createdTo");
  });

  it("20b. a malformed date is a 400, not a silently dropped bound", async () => {
    await expectValidationError(list({ createdFrom: "17/09/2026" }), "createdFrom");
  });

  it("20c. an empty date string is treated as absent", async () => {
    const { calls } = await list({ createdFrom: "", createdTo: "   " });
    expect(calls.findMany[0].where?.createdAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 21-24. pagination and response shape
// ---------------------------------------------------------------------------

describe("Reports — pagination", () => {
  it("21. totalPages is the plain ceiling, matching the users list", async () => {
    const { result } = await list({}, { total: 45, rows: [] });
    expect(result).toMatchObject({ total: 45, page: 1, pageSize: 20, totalPages: 3 });
  });

  it("22. zero rows yields totalPages 0, never 1", async () => {
    const { result } = await list({}, { total: 0, rows: [] });
    expect(result.totalPages).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("23. an exact multiple does not add a phantom page", async () => {
    const { result } = await list({}, { total: 40, rows: [] });
    expect(result.totalPages).toBe(2);
  });

  it("24. a page past the end returns an empty items array, not a clamp", async () => {
    const { result, calls } = await list({ page: 200 }, { total: 5, rows: [] });
    expect(result.items).toEqual([]);
    expect(result.page).toBe(200);
    // skip is honoured as asked; it is not rewritten to the last page.
    expect(calls.findMany[0].skip).toBe(199 * 20);
  });

  it("24b. page and pageSize keep the shared clamps", async () => {
    const low = await list({ page: 0, pageSize: 0 });
    expect(low.result.page).toBe(1);
    expect(low.result.pageSize).toBe(20);

    const high = await list({ page: 5000, pageSize: 5000 });
    expect(high.result.page).toBe(1000);
    expect(high.result.pageSize).toBe(100);
  });

  it("24c. count and findMany receive the same filter", async () => {
    const { calls } = await list({ status: "OPEN", reason: "Spam", targetType: "MESSAGE" });
    expect(calls.count[0].where).toEqual(calls.findMany[0].where);
  });
});

describe("Reports — response shape", () => {
  it("25. the list returns items/total/page/pageSize/totalPages", async () => {
    const { result } = await list({});
    expect(Object.keys(result).sort()).toEqual(["items", "page", "pageSize", "total", "totalPages"]);
  });

  it("26. every item carries the fields the queue renders", async () => {
    const { result } = await list({});
    expect(Object.keys(result.items[0]).sort()).toEqual(
      [
        "createdAt",
        "description",
        "id",
        "messageId",
        "momentId",
        "reason",
        "reportedUser",
        "reporter",
        "status",
      ].sort(),
    );
  });

  it("27. the list select names every column (no bare include)", async () => {
    const { calls } = await list({});
    expect(calls.findMany[0].include).toBeUndefined();
    expect(Object.keys(calls.findMany[0].select ?? {}).sort()).toEqual(
      Object.keys(REPORT_LIST_SELECT).sort(),
    );
  });

  it("28. the list response leaks no secret at any depth", async () => {
    const { result } = await list({});
    expectNoSecrets(result);
  });

  it("28b. an over-wide select would be caught (the scan is not vacuous)", async () => {
    // Guards the guard: projecting the fixture without a select really does
    // carry passwordHash through, so test 28 is meaningful.
    const wide = project(USER_REPORT as unknown as Record<string, unknown>, {
      id: true,
      reporter: { select: { id: true, passwordHash: true } },
    });
    expect(() => expectNoSecrets(wide)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 29-31. detail
// ---------------------------------------------------------------------------

describe("Reports — detail", () => {
  it("29. a known id returns report, reporter, reportedUser, target, message, moment, history", async () => {
    const detail = await makeService({ detailRow: USER_REPORT }).service.reportDetail(REPORT_ID);
    expect(Object.keys(detail).sort()).toEqual([
      "history",
      "message",
      "moment",
      "report",
      "reportedUser",
      "reporter",
      "target",
    ]);
  });

  it("29b. the report block carries the fields the screen needs", async () => {
    const detail = await makeService({ detailRow: USER_REPORT }).service.reportDetail(REPORT_ID);
    expect(Object.keys(detail.report).sort()).toEqual([
      "createdAt",
      "description",
      "id",
      "messageId",
      "momentId",
      "reason",
      "status",
    ]);
  });

  it("29c. target names both pointers so the console needs no extra rule", async () => {
    const detail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(REPORT_ID);
    expect(detail.target).toEqual({
      targetType: "MOMENT",
      messageId: null,
      momentId: MOMENT_ID,
    });
  });

  it("30. an unknown id is a 404 REPORT_NOT_FOUND, never a 200 with null", async () => {
    const { service } = makeService({ detailRow: null });
    await expect(service.reportDetail(REPORT_ID)).rejects.toBeInstanceOf(NotFoundException);
    try {
      await service.reportDetail(REPORT_ID);
    } catch (error) {
      const body = (error as NotFoundException).getResponse() as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("REPORT_NOT_FOUND");
    }
  });

  it("31. reporter and reportedUser expose only id/nickname/email/status", async () => {
    const detail = await makeService({ detailRow: USER_REPORT }).service.reportDetail(REPORT_ID);
    expect(Object.keys(detail.reporter).sort()).toEqual(["email", "id", "nickname", "status"]);
    expect(Object.keys(detail.reportedUser).sort()).toEqual(["email", "id", "nickname", "status"]);
  });

  it("32. the detail select is explicit and matches the constant", async () => {
    const { service, calls } = makeService({ detailRow: USER_REPORT });
    await service.reportDetail(REPORT_ID);
    expect(Object.keys(calls.detailFindUnique[0].select ?? {}).sort()).toEqual(
      Object.keys(REPORT_DETAIL_SELECT).sort(),
    );
  });

  it("33. the detail payload leaks no secret at any depth", async () => {
    const detail = await makeService({ detailRow: USER_REPORT }).service.reportDetail(REPORT_ID);
    expectNoSecrets(detail);
  });
});

// ---------------------------------------------------------------------------
// 34-36. message tolerance
// ---------------------------------------------------------------------------

describe("Reports — message tolerance", () => {
  it("34. a report with no messageId reports available:false / NO_MESSAGE and never queries", async () => {
    const { service, calls } = makeService({ detailRow: USER_REPORT });
    const detail = await service.reportDetail(REPORT_ID);
    expect(detail.message).toEqual({ available: false, reason: "NO_MESSAGE" });
    expect(calls.messageFindUnique).toEqual([]);
  });

  it("35. an existing message returns a safe summary", async () => {
    const detail = await makeService({ detailRow: MESSAGE_REPORT }).service.reportDetail(REPORT_ID);
    expect(detail.message).toMatchObject({
      available: true,
      id: MESSAGE_ID,
      content: "meet me at the usual place",
    });
  });

  it("35b. the message summary exposes only the fields the screen renders", async () => {
    const detail = await makeService({ detailRow: MESSAGE_REPORT }).service.reportDetail(REPORT_ID);
    expect(Object.keys(detail.message as object).sort()).toEqual([
      "available",
      "content",
      "createdAt",
      "id",
      "sender",
      "type",
    ]);
  });

  it("36. a hard-deleted message yields available:false and does not throw", async () => {
    const { service } = makeService({ detailRow: MESSAGE_REPORT, message: null });
    const detail = await service.reportDetail(REPORT_ID);
    expect(detail.message).toEqual({ available: false, reason: "DELETED" });
  });

  it("36b. a soft-deleted message withholds its body", async () => {
    const { service } = makeService({
      detailRow: MESSAGE_REPORT,
      message: {
        id: MESSAGE_ID,
        content: "meet me at the usual place",
        type: "TEXT",
        createdAt: new Date("2026-03-03T01:02:03.000Z"),
        deletedAt: new Date("2026-03-04T00:00:00.000Z"),
        sender: { id: REPORTER_ID, nickname: "Ann", email: "ann@example.test" },
      },
    });
    const detail = await service.reportDetail(REPORT_ID);
    expect(detail.message).toEqual({ available: false, reason: "DELETED" });
  });

  it("36c. a dangling messageId does not turn the detail page into a 500", async () => {
    const { service } = makeService({
      detailRow: { ...MESSAGE_REPORT, messageId: GHOST_MESSAGE_ID },
      message: null,
    });
    await expect(service.reportDetail(REPORT_ID)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 47-53. moment tolerance
// ---------------------------------------------------------------------------

/**
 * PC-2.5.3: the moment arm, held to the same contract as the message arm.
 *
 * `Report.momentId` is a bare pointer with no foreign key, so a report is
 * expected to outlive the moment it points at. That makes `available: false` a
 * routine answer rather than a failure, and the tests below exist mostly to pin
 * the "never throws" half of that promise — a summary that raised instead would
 * turn an operator's page into a 500 precisely when the target was gone.
 */
describe("Reports — moment tolerance", () => {
  it("47. a report with no momentId reports available:false / NO_MOMENT and never queries", async () => {
    const { service, calls } = makeService({ detailRow: USER_REPORT });
    const detail = await service.reportDetail(REPORT_ID);
    expect(detail.moment).toEqual({ available: false, reason: "NO_MOMENT" });
    expect(calls.momentFindUnique).toEqual([]);
  });

  it("47b. the two arms are independent: a message report is NO_MOMENT and still resolves", async () => {
    const detail = await makeService({ detailRow: MESSAGE_REPORT }).service.reportDetail(REPORT_ID);
    expect(detail.moment).toEqual({ available: false, reason: "NO_MOMENT" });
    expect(detail.message).toMatchObject({ available: true, id: MESSAGE_ID });
  });

  it("48. an existing moment returns a summary of the reported content", async () => {
    const detail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(REPORT_ID);
    expect(detail.moment).toMatchObject({
      available: true,
      id: MOMENT_ID,
      content: "testing the new profile layout",
      platform: "X",
    });
    // A moment report carries no message, so the message arm stays empty.
    expect(detail.message).toEqual({ available: false, reason: "NO_MESSAGE" });
  });

  it("48b. the moment summary exposes only the fields the screen renders", async () => {
    const detail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(REPORT_ID);
    expect(Object.keys(detail.moment as object).sort()).toEqual([
      "author",
      "available",
      "content",
      "createdAt",
      "id",
      "platform",
      "source",
    ]);
  });

  it("48c. the moment lookup names every column (no bare include)", async () => {
    const { service, calls } = makeService({ detailRow: MOMENT_REPORT });
    await service.reportDetail(REPORT_ID);
    expect(calls.momentFindUnique[0].include).toBeUndefined();
    expect(Object.keys(calls.momentFindUnique[0].select ?? {}).sort()).toEqual([
      "content",
      "createdAt",
      "id",
      "platform",
      "source",
      "user",
    ]);
  });

  it("49. the moment summary leaks no secret at any depth", async () => {
    const detail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(REPORT_ID);
    expectNoSecrets(detail.moment);
  });

  it("49b. an over-wide moment select would be caught (the scan is not vacuous)", async () => {
    // Guards the guard: the fixture really does carry passwordHash and videoUrl,
    // so a momentSummary that selected them would fail test 49 rather than pass
    // because the row happened to be clean.
    const wide = project(MOMENT_ROW, {
      id: true,
      videoUrl: true,
      user: { select: { id: true, passwordHash: true } },
    });
    expect(() => expectNoSecrets(wide)).toThrow();
  });

  it("50. a moment that no longer exists yields available:false / DELETED and does not throw", async () => {
    const { service } = makeService({ detailRow: MOMENT_REPORT, moment: null });
    const detail = await service.reportDetail(REPORT_ID);
    expect(detail.moment).toEqual({ available: false, reason: "DELETED" });
  });

  it("50b. a dangling momentId does not turn the detail page into a 500", async () => {
    const { service } = makeService({
      detailRow: { ...MOMENT_REPORT, momentId: GHOST_MOMENT_ID },
      moment: null,
    });
    const detail = await service.reportDetail(REPORT_ID);
    expect(detail.report.momentId).toBe(GHOST_MOMENT_ID);
    expect(detail.moment).toEqual({ available: false, reason: "DELETED" });
    expect(detail.target.targetType).toBe("MOMENT");
  });

  it("51. the moment author is the reported user, never the reporter", async () => {
    const detail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(REPORT_ID);
    const moment = detail.moment as { available: true; author: { id: string } };
    expect(moment.author.id).toBe(REPORTED_ID);
    expect(detail.reporter.id).toBe(REPORTER_ID);
  });

  it("52. every list row carries both pointers, so the console can derive the label", async () => {
    const { result } = await list({}, { rows: [USER_REPORT, MESSAGE_REPORT, MOMENT_REPORT] });
    const items = result.items as Array<{ messageId: string | null; momentId: string | null }>;
    // The queue labels rows client-side from these two columns; a moment row
    // that arrived without momentId would render as a user report.
    expect(items[0]).toMatchObject({ messageId: null, momentId: null });
    expect(items[1]).toMatchObject({ messageId: MESSAGE_ID, momentId: null });
    expect(items[2]).toMatchObject({ messageId: null, momentId: MOMENT_ID });
  });

  it("52b. the moment summary leaks nothing for a moment report either", async () => {
    const detail = await makeService({ detailRow: MOMENT_REPORT }).service.reportDetail(REPORT_ID);
    expectNoSecrets(detail);
  });
});

// ---------------------------------------------------------------------------
// 37-39. review history
// ---------------------------------------------------------------------------

describe("Reports — review history", () => {
  it("37. history is read from AdminAuditLog scoped to this report", async () => {
    const { service, calls } = makeService({ detailRow: USER_REPORT });
    await service.reportDetail(REPORT_ID);
    expect(calls.historyFindMany[0].where).toEqual({ targetType: "REPORT", targetId: REPORT_ID });
    expect(calls.historyFindMany[0].orderBy).toEqual({ createdAt: "desc" });
  });

  it("38. the history select matches the constant and omits ip/userAgent", async () => {
    const { service, calls } = makeService({ detailRow: USER_REPORT });
    await service.reportDetail(REPORT_ID);
    const select = calls.historyFindMany[0].select ?? {};
    expect(Object.keys(select).sort()).toEqual(Object.keys(REPORT_HISTORY_SELECT).sort());
    expect(Object.keys(select)).not.toContain("ip");
    expect(Object.keys(select)).not.toContain("userAgent");
  });

  it("39. a SYSTEM row is representable (adminId null, actorType SYSTEM)", async () => {
    const detail = await makeService({
      detailRow: USER_REPORT,
      history: [
        {
          id: "audit-sys",
          action: "REPORT_REJECTED",
          targetType: "REPORT",
          targetId: REPORT_ID,
          actorType: "SYSTEM",
          adminId: null,
          reason: null,
          detail: null,
          before: { status: "OPEN" },
          after: { status: "REJECTED" },
          createdAt: new Date("2026-03-06T00:00:00.000Z"),
        },
      ],
    }).service.reportDetail(REPORT_ID);
    expect(detail.history[0]).toMatchObject({ actorType: "SYSTEM", adminId: null });
  });

  it("39b. the history payload leaks no ip/userAgent", async () => {
    const detail = await makeService({ detailRow: USER_REPORT }).service.reportDetail(REPORT_ID);
    expectNoSecrets(detail.history);
  });
});

// ---------------------------------------------------------------------------
// 40-46. review
// ---------------------------------------------------------------------------

describe("Reports — review", () => {
  const REVIEW_ARGS = [REPORT_ID, "reviewing", admin("MODERATOR"), "looking into it"] as const;

  it("40. reviewing moves the report to REVIEWING", async () => {
    const { service, calls } = makeService();
    await service.reviewReport(...REVIEW_ARGS);
    expect(calls.reportUpdate[0].data).toEqual({ status: "REVIEWING" });
  });

  it("41. resolved moves the report to RESOLVED", async () => {
    const { service, calls } = makeService();
    await service.reviewReport(REPORT_ID, "resolved", admin("MODERATOR"), "confirmed");
    expect(calls.reportUpdate[0].data).toEqual({ status: "RESOLVED" });
  });

  it("42. rejected moves the report to REJECTED", async () => {
    const { service, calls } = makeService();
    await service.reviewReport(REPORT_ID, "rejected", admin("MODERATOR"), "not a violation");
    expect(calls.reportUpdate[0].data).toEqual({ status: "REJECTED" });
  });

  it("43. a missing reason is a 400 and writes nothing", async () => {
    const { service, calls } = makeService();
    await expect(service.reviewReport(REPORT_ID, "resolved", admin("MODERATOR"), "   ")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(calls.reportUpdate).toEqual([]);
    expect(calls.auditCreate).toEqual([]);
  });

  it("44. an unknown report is a 404 and writes nothing", async () => {
    const { service, calls } = makeService({ existingReport: null });
    await expect(service.reviewReport(...REVIEW_ARGS)).rejects.toBeInstanceOf(NotFoundException);
    expect(calls.reportUpdate).toEqual([]);
    expect(calls.auditCreate).toEqual([]);
  });

  it("45. a successful review writes exactly one audit row, attributed to the human", async () => {
    const { service, calls } = makeService();
    await service.reviewReport(...REVIEW_ARGS);
    expect(calls.auditCreate).toHaveLength(1);
    expect(calls.auditCreate[0].data).toMatchObject({
      actorType: "USER",
      adminId: ADMIN_ID,
      action: "REPORT_REVIEWING",
      targetType: "REPORT",
      targetId: REPORT_ID,
    });
  });

  it("45b. the audit row records before/after status", async () => {
    const { service, calls } = makeService();
    await service.reviewReport(REPORT_ID, "resolved", admin("MODERATOR"), "confirmed");
    expect(calls.auditCreate[0].data).toMatchObject({
      before: { status: "OPEN" },
      after: { status: "RESOLVED" },
    });
  });

  it("45c. the action name tracks the verb", async () => {
    for (const [action, expected] of [
      ["reviewing", "REPORT_REVIEWING"],
      ["resolved", "REPORT_RESOLVED"],
      ["rejected", "REPORT_REJECTED"],
    ] as const) {
      const { service, calls } = makeService();
      await service.reviewReport(REPORT_ID, action, admin("MODERATOR"), "because");
      expect(calls.auditCreate[0].data).toMatchObject({ action: expected });
    }
  });

  it("45d. a moment report reviews even once its moment is gone", async () => {
    // momentId has no foreign key, so review must never route through the
    // moment lookup. A deleted target is exactly when an operator needs to
    // close the report — that path must not depend on the summary resolving.
    const { service, calls } = makeService({
      existingReport: { id: REPORT_ID, status: "OPEN", reportedUserId: REPORTED_ID },
      moment: null,
    });
    await service.reviewReport(REPORT_ID, "resolved", admin("MODERATOR"), "moment removed");
    expect(calls.reportUpdate[0].data).toEqual({ status: "RESOLVED" });
    expect(calls.momentFindUnique).toEqual([]);
    expect(calls.auditCreate[0].data).toMatchObject({
      action: "REPORT_RESOLVED",
      targetType: "REPORT",
      targetId: REPORT_ID,
    });
  });

  it("46. reviewReport never writes a SYSTEM row", async () => {
    const { service, calls } = makeService();
    await service.reviewReport(...REVIEW_ARGS);
    for (const call of calls.auditCreate) {
      const data = call.data as { actorType?: string; adminId?: string | null };
      expect(data.actorType).toBe("USER");
      expect(data.adminId).not.toBeNull();
    }
  });

  it("46b. the review route is gated on moderation:write (content moderation)", () => {
    // FIX (audit P013): adjudicating a report IS content moderation. Gating it
    // on `reports:write` meant CONTENT_MANAGER — the role defined as "content
    // moderation only" — could open the workbench and have every action refused,
    // while SUPPORT (which holds `reports:write` and should not ban anyone) could
    // adjudicate. `moderation:write` is held by SUPER_ADMIN, MODERATOR and
    // CONTENT_MANAGER only.
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.review)).toBe(
      "moderation:write",
    );
  });

  it("46c. only SUPER_ADMIN and MODERATOR hold reports:write", () => {
    for (const role of WRITE_ROLES) expect(hasPermission(role, "reports:write")).toBe(true);
    for (const role of READ_ONLY_ROLES) expect(hasPermission(role, "reports:write")).toBe(false);
  });

  it("46d. exactly SUPER_ADMIN, MODERATOR and CONTENT_MANAGER may adjudicate", () => {
    const holders = (["SUPER_ADMIN", "MODERATOR", "SUPPORT", "ANALYST", "CONTENT_MANAGER"] as const).filter(
      (role) => hasPermission(role, "moderation:write"),
    );
    expect([...holders].sort()).toEqual(["CONTENT_MANAGER", "MODERATOR", "SUPER_ADMIN"]);
  });
});
