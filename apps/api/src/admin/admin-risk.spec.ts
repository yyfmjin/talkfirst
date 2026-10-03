import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  RISK_RECENT_ACTIONS_SELECT,
  RISK_RECENT_REPORTS_SELECT,
} from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";
import { reflectorReturning } from "./test-reflector";

/**
 * Phase C1 — the Risk Center overview.
 *
 * What is pinned here, and why each is not obvious:
 *
 *   1. **`risk:read`, not `moderation:read`.** The Risk Center reads reports and
 *      user statuses, but it is not the moderation queue. `risk:read` is held by
 *      SUPER_ADMIN, MODERATOR and ANALYST — a *different* set from either
 *      `reports:read` (all five) or `moderation:read` (three, but not ANALYST).
 *      Picking the wrong permission would silently widen or narrow access, so
 *      the exact holder set is asserted, not just "some role can read".
 *
 *   2. **Every KPI is a real `count` with the filter it claims.** A KPI that
 *      counted the wrong thing would be indistinguishable from a correct one in
 *      the response shape. Each is asserted against the `where` the service
 *      actually sent to Prisma.
 *
 *   3. **No invented severity.** The response must contain no `riskLevel`,
 *      `riskScore` or `riskTier`. Those would be business rules nobody defined;
 *      Phase C forbids manufacturing them, so their *absence* is asserted rather
 *      than merely omitted by accident.
 *
 *   4. **`suspiciousSelfReports` is a row count, not a user accusation.** It
 *      counts `reporterId === reportedUserId` via a Prisma field reference. The
 *      test asserts the comparison is the column-to-column one, because
 *      comparing to a literal string would always be `false` and would silently
 *      report zero.
 *
 *   5. **Reading writes no audit.** Phase C is GET-only; a read that appended an
 *      audit row would corrupt the trail it exists to protect.
 *
 *   6. **Nothing leaks.** `RISK_RECENT_REPORTS_SELECT` joins two `User` rows, so
 *      widening it to an `include` would carry `passwordHash` into the payload.
 *      The mock projects through the real select, so that mistake surfaces here.
 *
 * Real HTTP for all five roles, and every count against live PostgreSQL, are
 * verified in `scripts/phaseA-rbac-verify.mjs` (§10d).
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

/** Read from the real matrix in `permissions.ts`, not assumed. */
const RISK_READERS: AdminRole[] = ["SUPER_ADMIN", "MODERATOR", "ANALYST"];
const RISK_DENIED: AdminRole[] = ["SUPPORT", "CONTENT_MANAGER"];

const ADMIN_ID = "9c4e1a52-7b3d-4e6f-8a11-2d5f9c0b7e34";
const REPORT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const REPORTER_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";
const REPORTED_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const SELF_ID = "7c8d9e0f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const MOMENT_ID = "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const MESSAGE_ID = "d4e5f6a7-8b9c-4d0e-9f1a-2b3c4d5e6f70";

type Party = {
  id: string;
  nickname: string | null;
  email: string;
  status?: string;
  passwordHash?: string;
};

const REPORTER: Party = {
  id: REPORTER_ID,
  nickname: "Ann",
  email: "ann@example.test",
  passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
};

const REPORTED: Party = {
  id: REPORTED_ID,
  nickname: "Bob",
  email: "bob@example.test",
  status: "ACTIVE",
  passwordHash: "$2a$10$zyxwvutsrqponmlkjihgfe",
};

/** A report row as Prisma would return it with a *wide* select, secrets included. */
type ReportRow = {
  id: string;
  reason: string;
  description: string | null;
  status: string;
  // The two target pointers. Both are nullable and neither is a foreign key,
  // which is what lets a report outlive the thing it points at.
  messageId: string | null;
  momentId: string | null;
  createdAt: Date;
  reporter: Party;
  reportedUser: Party;
  // Present on the fixture on purpose: widening the select to an `include`
  // carries them into the response, where the deep scan fails. A fixture
  // without them could never catch that mistake.
  passwordHash: string;
  tokenHash: string;
};

const REPORT_ROW: ReportRow = {
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

/**
 * An audit row as it comes back with a *wide* select.
 *
 * `ip`/`userAgent` are present on the fixture so that adding them to
 * `RISK_RECENT_ACTIONS_SELECT` fails the scan instead of silently passing.
 */
type AuditRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorType: string;
  adminId: string | null;
  detail: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
  ip: string;
  userAgent: string;
};

const USER_ACTION: AuditRow = {
  id: "audit-user-1",
  action: "ADMIN_USER_SUSPEND",
  targetType: "USER",
  targetId: REPORTED_ID,
  actorType: "USER",
  adminId: ADMIN_ID,
  detail: "suspend: confirmed spam",
  before: { status: "ACTIVE" },
  after: { status: "SUSPENDED" },
  createdAt: new Date("2026-03-06T00:00:00.000Z"),
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (sensitive)",
};

const SYSTEM_ACTION: AuditRow = {
  ...USER_ACTION,
  id: "audit-system-1",
  action: "SYSTEM_USER_SUSPENSION_EXPIRED",
  actorType: "SYSTEM",
  adminId: null,
  detail: "suspension expired",
  before: { status: "SUSPENDED" },
  after: { status: "ACTIVE" },
  createdAt: new Date("2026-03-07T00:00:00.000Z"),
};

/** The argument objects the service hands to Prisma. */
type Call = {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  skip?: number;
  take?: number;
  select?: Record<string, unknown>;
  include?: unknown;
};

/** Emulates Prisma's select: only the named columns come back, recursively. */
function project(
  row: Record<string, unknown>,
  select: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (!select[key]) continue;
    const spec = select[key];
    const value = row[key];
    if (value !== null && typeof value === "object" && spec !== null && typeof spec === "object") {
      const nested = spec as { select?: Record<string, unknown> };
      out[key] = nested.select
        ? project(value as Record<string, unknown>, nested.select)
        : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Stands in for `tx.report.fields`.
 *
 * Prisma's field-reference API lets a filter compare two *columns*:
 *   `where: { reporterId: { equals: tx.report.fields.reportedUserId } }`
 * The mock must produce something recognisably a column reference, so the test
 * can assert the comparison is column-to-column rather than against a literal.
 */
const REPORT_FIELDS = {
  reportedUserId: { __fieldRef: "Report.reportedUserId" },
  reporterId: { __fieldRef: "Report.reporterId" },
};

const OVERVIEW = {
  totalReports: 9,
  openReports: 4,
  reviewingReports: 2,
  resolvedReports: 2,
  rejectedReports: 1,
  suspendedUsers: 3,
  bannedUsers: 1,
  disabledUsers: 2,
  activeUsers: 40,
  suspiciousSelfReports: 2,
};

type HarnessOptions = {
  overview?: Partial<typeof OVERVIEW>;
  reports?: ReportRow[];
  actions?: AuditRow[];
  signals?: ReportRow[];
};

function makeService(opts: HarnessOptions = {}) {
  const calls = {
    reportCount: [] as Call[],
    userCount: [] as Call[],
    reportFindMany: [] as Call[],
    auditFindMany: [] as Call[],
    auditCreate: [] as Call[],
  };

  /**
   * `report.count` is called once per report KPI. Each call carries the filter
   * that defines that KPI, so the test can assert the mapping by inspecting the
   * recorded args rather than by trusting the returned number.
   */
  const reportCount = jest.fn(async (args: Call = {}) => {
    calls.reportCount.push(args);
    const status = (args.where as { status?: string } | undefined)?.status;
    if (status === "OPEN") return opts.overview?.openReports ?? OVERVIEW.openReports;
    if (status === "REVIEWING") return opts.overview?.reviewingReports ?? OVERVIEW.reviewingReports;
    if (status === "RESOLVED") return opts.overview?.resolvedReports ?? OVERVIEW.resolvedReports;
    if (status === "REJECTED") return opts.overview?.rejectedReports ?? OVERVIEW.rejectedReports;
    if (args.where && "reporterId" in args.where) {
      return opts.overview?.suspiciousSelfReports ?? OVERVIEW.suspiciousSelfReports;
    }
    return opts.overview?.totalReports ?? OVERVIEW.totalReports;
  });

  const userCount = jest.fn(async (args: Call = {}) => {
    calls.userCount.push(args);
    const status = (args.where as { status?: string } | undefined)?.status;
    if (status === "SUSPENDED") return opts.overview?.suspendedUsers ?? OVERVIEW.suspendedUsers;
    if (status === "BANNED") return opts.overview?.bannedUsers ?? OVERVIEW.bannedUsers;
    if (status === "DISABLED") return opts.overview?.disabledUsers ?? OVERVIEW.disabledUsers;
    if (status === "ACTIVE") return opts.overview?.activeUsers ?? OVERVIEW.activeUsers;
    return 0;
  });

  /**
   * Two different `findMany`s share the `report` delegate: the recent-reports
   * feed and the suspicious-signals feed. They are distinguished by their
   * `where` — the signals query carries the self-report filter.
   */
  const reportFindMany = jest.fn(async (args: Call) => {
    calls.reportFindMany.push(args);
    const isSignals = Boolean(args.where && "reporterId" in args.where);
    const rows = isSignals ? (opts.signals ?? []) : (opts.reports ?? [REPORT_ROW]);
    return rows.map((row) => project(row as unknown as Record<string, unknown>, args.select ?? {}));
  });

  const auditFindMany = jest.fn(async (args: Call) => {
    calls.auditFindMany.push(args);
    return (opts.actions ?? [USER_ACTION, SYSTEM_ACTION]).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const auditCreate = jest.fn(async (args: Call) => {
    calls.auditCreate.push(args);
    return { id: "audit-new" };
  });

  const report = {
    count: reportCount,
    findMany: reportFindMany,
    fields: REPORT_FIELDS,
  };

  const tx = {
    report,
    user: { count: userCount, findMany: jest.fn(async () => []) },
    adminAuditLog: { findMany: auditFindMany, create: auditCreate },
  };

  const prisma = {
    ...tx,
    report,
    user: tx.user,
    adminAuditLog: tx.adminAuditLog,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), calls, prisma };
}

/** Runs `riskOverview()` and returns the result plus captured calls. */
async function risk(opts: HarnessOptions = {}) {
  const harness = makeService(opts);
  const result = await harness.service.riskOverview();
  return { ...harness, result };
}

/** Every key path in a nested value, e.g. `recentReports[0].reporter.email`. */
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
    expect(
      paths.filter((path) => path.toLowerCase().endsWith(`.${field.toLowerCase()}`)),
    ).toEqual([]);
  }
}

// ---------------------------------------------------------------------------
// 1-5, 28. role access and the GET contract
// ---------------------------------------------------------------------------

describe("Risk — role access", () => {
  it("1-3. SUPER_ADMIN, MODERATOR and ANALYST hold risk:read", () => {
    for (const role of RISK_READERS) {
      expect(hasPermission(role, "risk:read")).toBe(true);
    }
  });

  it("4. SUPPORT and CONTENT_MANAGER do not hold risk:read", () => {
    for (const role of RISK_DENIED) {
      expect(hasPermission(role, "risk:read")).toBe(false);
    }
  });

  it("4b. risk:read is NOT the same set as reports:read or moderation:read", () => {
    // If any of these three sets were accidentally interchangeable, the
    // permission choice would be untestable. They are deliberately different:
    //   reports:read    — all five roles
    //   moderation:read — three, including CONTENT_MANAGER but not ANALYST
    //   risk:read       — three, including ANALYST but not CONTENT_MANAGER
    const reportsReaders = ALL_ROLES.filter((r) => hasPermission(r, "reports:read"));
    const moderationReaders = ALL_ROLES.filter((r) => hasPermission(r, "moderation:read"));
    expect(reportsReaders).toHaveLength(5);
    expect(moderationReaders).toEqual(["SUPER_ADMIN", "MODERATOR", "CONTENT_MANAGER"]);
    expect(RISK_READERS).toEqual(["SUPER_ADMIN", "MODERATOR", "ANALYST"]);
    expect(RISK_READERS).not.toEqual(moderationReaders);
  });

  it("1-4c. the risk handler declares risk:read", () => {
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.risk)).toBe(
      "risk:read",
    );
  });

  it("5. PermissionGuard admits each reader and refuses each non-reader", () => {
    for (const role of RISK_READERS) {
      const guard = new PermissionGuard(reflectorReturning("risk:read"));
      const request = { admin: admin(role) };
      expect(guard.canActivate(httpContext(request))).toBe(true);
    }
    // Denial is a thrown `ForbiddenException`, not a `false` return — the guard
    // converts a missing permission into the real 403 the client sees, so the
    // refusal must be asserted as a throw.
    for (const role of RISK_DENIED) {
      const guard = new PermissionGuard(reflectorReturning("risk:read"));
      const request = { admin: admin(role) };
      expect(() => guard.canActivate(httpContext(request))).toThrow(ForbiddenException);
    }
  });

  it("5b. a request with no admin identity is refused", () => {
    const guard = new PermissionGuard(reflectorReturning("risk:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });

  it("28. reading the Risk Center writes no audit row", async () => {
    const harness = await risk();
    expect(harness.calls.auditCreate).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6-14. KPIs
// ---------------------------------------------------------------------------

describe("Risk — KPI definitions", () => {
  it("6. totalReports is an unfiltered report count", async () => {
    const { result, calls } = await risk();
    expect(result.overview.totalReports).toBe(OVERVIEW.totalReports);

    const totalCall = calls.reportCount.find(
      (call) => !call.where || Object.keys(call.where).length === 0,
    );
    expect(totalCall).toBeDefined();
    expect(totalCall?.where).toBeUndefined();
  });

  it("7-10. each report status KPI counts its own status", async () => {
    const { result, calls } = await risk();
    expect(result.overview.openReports).toBe(OVERVIEW.openReports);
    expect(result.overview.reviewingReports).toBe(OVERVIEW.reviewingReports);
    expect(result.overview.resolvedReports).toBe(OVERVIEW.resolvedReports);
    expect(result.overview.rejectedReports).toBe(OVERVIEW.rejectedReports);

    const statuses = calls.reportCount
      .map((call) => (call.where as { status?: string } | undefined)?.status)
      .filter(Boolean);
    expect(statuses).toEqual(
      expect.arrayContaining(["OPEN", "REVIEWING", "RESOLVED", "REJECTED"]),
    );
  });

  it("11-13. each user status KPI counts its own status", async () => {
    const { result, calls } = await risk();
    expect(result.overview.suspendedUsers).toBe(OVERVIEW.suspendedUsers);
    expect(result.overview.bannedUsers).toBe(OVERVIEW.bannedUsers);
    expect(result.overview.disabledUsers).toBe(OVERVIEW.disabledUsers);

    const statuses = calls.userCount
      .map((call) => (call.where as { status?: string } | undefined)?.status)
      .filter(Boolean);
    expect(statuses).toEqual(expect.arrayContaining(["SUSPENDED", "BANNED", "DISABLED"]));
  });

  it("14. suspiciousSelfReports compares reporterId to reportedUserId as columns", async () => {
    const { result, calls } = await risk();
    expect(result.overview.suspiciousSelfReports).toBe(OVERVIEW.suspiciousSelfReports);

    const selfCall = calls.reportCount.find((call) => call.where && "reporterId" in call.where);
    expect(selfCall).toBeDefined();

    // The comparison must be a *column reference*. Comparing to a string literal
    // would be permanently false — the count would always be 0 and the defect
    // this field exists to surface would stay invisible.
    const filter = (selfCall?.where as { reporterId?: { equals?: unknown } }).reporterId;
    expect(filter?.equals).toEqual(REPORT_FIELDS.reportedUserId);

    const serialised = JSON.stringify(filter);
    expect(serialised).not.toMatch(/"[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("14b. an empty database reports zeros rather than omitting the KPIs", async () => {
    const { result } = await risk({
      overview: {
        totalReports: 0,
        openReports: 0,
        reviewingReports: 0,
        resolvedReports: 0,
        rejectedReports: 0,
        suspendedUsers: 0,
        bannedUsers: 0,
        disabledUsers: 0,
        activeUsers: 0,
        suspiciousSelfReports: 0,
      },
    });
    for (const value of Object.values(result.overview)) {
      expect(value).toBe(0);
    }
    // Zero is a legal value and must still be present as a key.
    expect(Object.keys(result.overview)).toHaveLength(10);
  });

  it("3b. the response invents no severity field", async () => {
    const { result } = await risk();
    const keys = Object.keys(result.overview).map((key) => key.toLowerCase());
    for (const invented of ["risklevel", "riskscore", "risktier", "severity", "score"]) {
      expect(keys).not.toContain(invented);
    }
    // And nowhere else in the payload either.
    expect(JSON.stringify(result)).not.toMatch(/riskLevel|riskScore|riskTier/i);
  });
});

// ---------------------------------------------------------------------------
// 15-19. feeds
// ---------------------------------------------------------------------------

describe("Risk — recent feeds", () => {
  it("15. recentReports returns reports ordered newest first", async () => {
    const { result, calls } = await risk();
    expect(result.recentReports).toHaveLength(1);

    const feedCall = calls.reportFindMany.find(
      (call) => !call.where || !("reporterId" in call.where),
    );
    expect(feedCall?.orderBy).toEqual({ createdAt: "desc" });
  });

  it("18-19. every feed is capped at the recent limit", async () => {
    const { result, calls } = await risk();
    expect(calls.reportFindMany.every((call) => call.take === 10)).toBe(true);
    expect(calls.auditFindMany.every((call) => call.take === 10)).toBe(true);
    expect(result.recentActions.length).toBeLessThanOrEqual(10);
    expect(result.suspiciousSignals.length).toBeLessThanOrEqual(10);
  });

  it("17. recentActions selects the risk vocabulary only", async () => {
    const { result, calls } = await risk();
    expect(result.recentActions).toHaveLength(2);

    const where = calls.auditFindMany[0]?.where as { action?: { in?: string[] } };
    const actions = where?.action?.in ?? [];
    expect(actions).toEqual(
      expect.arrayContaining([
        "ADMIN_USER_BAN",
        "ADMIN_USER_SUSPEND",
        "REPORT_RESOLVED",
        "SYSTEM_USER_SUSPENSION_EXPIRED",
      ]),
    );
    // An internal note is not a risk event.
    expect(actions).not.toContain("ADMIN_USER_NOTE");
  });

  it("17b. a SYSTEM action stays machine-attributed and a USER action keeps its admin", async () => {
    const { result } = await risk();
    const system = result.recentActions.find((row) => row.actorType === "SYSTEM");
    const human = result.recentActions.find((row) => row.actorType === "USER");

    expect(system?.adminId).toBeNull();
    expect(human?.adminId).toBe(ADMIN_ID);
  });

  it("17c. before/after are carried so a row can state what changed", async () => {
    const { result } = await risk();
    const human = result.recentActions.find((row) => row.actorType === "USER");
    expect(human?.before).toEqual({ status: "ACTIVE" });
    expect(human?.after).toEqual({ status: "SUSPENDED" });
  });

  it("16. suspiciousSignals returns only self-report rows, newest first", async () => {
    const { result, calls } = await risk({ signals: [{ ...REPORT_ROW, id: SELF_ID }] });
    expect(result.suspiciousSignals).toHaveLength(1);

    const signalCall = calls.reportFindMany.find(
      (call) => call.where && "reporterId" in call.where,
    );
    expect(signalCall).toBeDefined();
    expect(signalCall?.orderBy).toEqual({ createdAt: "desc" });

    const filter = (signalCall?.where as { reporterId?: { equals?: unknown } }).reporterId;
    expect(filter?.equals).toEqual(REPORT_FIELDS.reportedUserId);
  });

  it("16b. the feeds are independent — no signals does not blank the reports feed", async () => {
    const { result } = await risk({ signals: [] });
    expect(result.suspiciousSignals).toEqual([]);
    expect(result.recentReports).toHaveLength(1);
  });

  // ---- PC-2.5.6: the feed must be able to name the target --------------

  it("16c. the feed selects both target pointers", () => {
    // A report has no targetType column. Without these two the console cannot
    // tell "reported this person" from "reported this person's moment", so
    // their presence is the contract, not an implementation detail.
    const keys = Object.keys(RISK_RECENT_REPORTS_SELECT);
    expect(keys).toEqual(expect.arrayContaining(["messageId", "momentId"]));
  });

  it("16d. a moment report carries its momentId and a null messageId", async () => {
    const { result } = await risk({
      reports: [{ ...REPORT_ROW, momentId: MOMENT_ID }],
    });
    expect(result.recentReports[0].momentId).toBe(MOMENT_ID);
    expect(result.recentReports[0].messageId).toBeNull();
  });

  it("16e. a person report keeps both pointers null", async () => {
    const { result } = await risk();
    expect(result.recentReports[0].momentId).toBeNull();
    expect(result.recentReports[0].messageId).toBeNull();
  });

  it("16f. a message report keeps momentId null", async () => {
    const { result } = await risk({
      reports: [{ ...REPORT_ROW, messageId: MESSAGE_ID }],
    });
    expect(result.recentReports[0].messageId).toBe(MESSAGE_ID);
    expect(result.recentReports[0].momentId).toBeNull();
  });

  it("16g. both pointers survive projection, so the priority rule has data", async () => {
    // The console resolves MOMENT > MESSAGE > USER; that resolution is only
    // possible if neither pointer is dropped on the way out.
    const { result } = await risk({
      reports: [{ ...REPORT_ROW, messageId: MESSAGE_ID, momentId: MOMENT_ID }],
    });
    expect(result.recentReports[0].momentId).toBe(MOMENT_ID);
    expect(result.recentReports[0].messageId).toBe(MESSAGE_ID);
  });
});

// ---------------------------------------------------------------------------
// 20-27. privacy
// ---------------------------------------------------------------------------

describe("Risk — privacy", () => {
  it("20-25. no credential or secret reaches the response", async () => {
    const { result } = await risk();
    expectNoSecrets(result);
    // The fixtures really do carry them, so the assertion above is not vacuous.
    expect(JSON.stringify(REPORT_ROW)).toContain("passwordHash");
    expect(JSON.stringify(USER_ACTION)).toContain("userAgent");
  });

  it("26-27. ip and userAgent never appear, even though the rows carry them", async () => {
    const { result } = await risk();
    const paths = keyPaths(result);
    expect(paths.filter((path) => path.endsWith(".ip"))).toEqual([]);
    expect(paths.filter((path) => path.endsWith(".userAgent"))).toEqual([]);
  });

  it("20-27b. the selects themselves exclude the forbidden fields", () => {
    const reportKeys = JSON.stringify(RISK_RECENT_REPORTS_SELECT);
    const actionKeys = JSON.stringify(RISK_RECENT_ACTIONS_SELECT);
    for (const field of FORBIDDEN) {
      expect(reportKeys).not.toContain(`"${field}"`);
      expect(actionKeys).not.toContain(`"${field}"`);
    }
    // The report feed must name its columns, never `include` a whole User.
    expect(reportKeys).not.toContain("passwordHash");
  });

  it("20-27c. the feeds select explicit identity columns only", () => {
    const select = RISK_RECENT_REPORTS_SELECT as unknown as {
      reporter: { select: Record<string, boolean> };
    };
    expect(Object.keys(select.reporter.select).sort()).toEqual(["email", "id", "nickname"]);
  });
});

// ---------------------------------------------------------------------------
// extra: the whole payload shape
// ---------------------------------------------------------------------------

describe("Risk — payload shape", () => {
  it("returns overview plus the three feeds, and nothing else", async () => {
    const { result } = await risk();
    expect(Object.keys(result).sort()).toEqual([
      "overview",
      "recentActions",
      "recentReports",
      "suspiciousSignals",
    ]);
  });

  it("the overview carries exactly the ten stored-fact counts", async () => {
    const { result } = await risk();
    expect(Object.keys(result.overview).sort()).toEqual([
      "activeUsers",
      "bannedUsers",
      "disabledUsers",
      "openReports",
      "rejectedReports",
      "resolvedReports",
      "reviewingReports",
      "suspendedUsers",
      "suspiciousSelfReports",
      "totalReports",
    ]);
  });
});
