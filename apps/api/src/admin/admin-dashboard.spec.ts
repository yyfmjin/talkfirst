import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase B1 — Dashboard.
 *
 * Two things are being pinned here, and they are independent:
 *
 *   1. **The numbers come from the right query.** A dashboard is only useful if
 *      each figure means what its label says. `admins` in particular used to
 *      count `User.isAdmin` — the legacy compatibility flag — rather than
 *      `AdminUser.isActive`. Those two agree today, so the bug would have been
 *      invisible until the first administrator was revoked. These tests assert
 *      the query, not just the returned number.
 *
 *   2. **Nothing leaks.** The dashboard reads `AdminAuditLog`, which carries
 *      `ip` and `userAgent`. A bare `findMany` would ship both to the browser in
 *      a summary nobody asked them for, and would start shipping any column
 *      added later. The final block walks the whole response and fails on any
 *      forbidden key, at any depth.
 *
 * Real HTTP access for all five roles, and the statistics against live
 * PostgreSQL, are verified separately in `scripts/phaseA-rbac-verify.mjs`.
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

function reflectorReturning(permission: string | undefined): Reflector {
  return { getAllAndOverride: jest.fn(() => permission) } as unknown as Reflector;
}

const admin = (role: AdminRole): ResolvedAdmin => ({
  userId: "admin-1",
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

/** Distinct, non-round values so a mis-wired field cannot pass by coincidence. */
type Counts = {
  users: number;
  active: number;
  suspended: number;
  banned: number;
  activeToday: number;
  todayNewUsers: number;
  newUsers7d: number;
  messagesToday: number;
  connections: number;
  reportsOpen: number;
  admins: number;
};

const COUNTS: Counts = {
  users: 168,
  active: 166,
  suspended: 3,
  banned: 2,
  activeToday: 12,
  todayNewUsers: 4,
  newUsers7d: 21,
  messagesToday: 90,
  connections: 44,
  reportsOpen: 7,
  admins: 9,
};

type AuditRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorType: "USER" | "SYSTEM";
  adminId: string | null;
  detail: string | null;
  createdAt: Date;
};

/** The shape of a SYSTEM row — no actor id is selected for that list. */
type SystemAuditRow = Omit<AuditRow, "actorType" | "adminId">;

function auditRow(over: Partial<AuditRow> & { id: string }): AuditRow {
  return {
    action: "ADMIN_USER_BAN",
    targetType: "USER",
    targetId: "user-9",
    actorType: "USER",
    adminId: "admin-1",
    detail: null,
    createdAt: new Date("2026-09-17T10:00:00.000Z"),
    ...over,
  };
}

const REPORT_ROW = {
  id: "report-1",
  reason: "HARASSMENT",
  status: "RESOLVED",
  messageId: null,
  momentId: null,
  createdAt: new Date("2026-09-17T09:00:00.000Z"),
  reporter: { id: "u-1", nickname: "Ann", email: "ann@example.test" },
  reportedUser: { id: "u-2", nickname: null, email: "bob@example.test" },
};

/** The shape of the argument objects the service hands to Prisma. */
type Call = {
  where?: {
    status?: string | { in: string[] };
    isActive?: boolean;
    isAdmin?: boolean;
    lastActiveAt?: { gte: Date };
    createdAt?: { gte: Date };
    deletedAt?: null;
    actorType?: string;
  };
  orderBy?: Record<string, string>;
  take?: number;
  select?: Record<string, unknown>;
};

function makeService(
  opts: {
    counts?: Partial<Counts>;
    audit?: AuditRow[];
    systemAudit?: SystemAuditRow[];
    reports?: unknown[];
  } = {},
) {
  const counts = { ...COUNTS, ...opts.counts };
  const calls = {
    userCount: [] as Call[],
    adminUserCount: [] as Call[],
    messageCount: [] as Call[],
    connectionCount: [] as Call[],
    reportCount: [] as Call[],
    reportFindMany: [] as Call[],
    auditFindMany: [] as Call[],
  };

  /**
   * The two signup windows both filter on `createdAt: { gte }`. They are told
   * apart by magnitude rather than by call order: "today" is at most ~24h back
   * while "last 7 days" is ~168h back, so a 48h threshold separates them
   * unambiguously even if the service reorders its queries.
   */
  const isTodayWindow = (gte: Date) =>
    gte.getTime() > Date.now() - 2 * 24 * 60 * 60 * 1000;

  const userCount = jest.fn(async (args: Call = {}) => {
    calls.userCount.push(args);
    const where = args.where ?? {};
    if (where.status === "ACTIVE") return counts.active;
    if (where.status === "SUSPENDED") return counts.suspended;
    if (where.status === "BANNED") return counts.banned;
    if (where.lastActiveAt) return counts.activeToday;
    if (where.createdAt) {
      return isTodayWindow(where.createdAt.gte) ? counts.todayNewUsers : counts.newUsers7d;
    }
    return counts.users;
  });

  const adminUserCount = jest.fn(async (args: Call = {}) => {
    calls.adminUserCount.push(args);
    return counts.admins;
  });

  const messageCount = jest.fn(async (args: Call = {}) => {
    calls.messageCount.push(args);
    return counts.messagesToday;
  });

  const connectionCount = jest.fn(async (args: Call = {}) => {
    calls.connectionCount.push(args);
    return counts.connections;
  });

  const reportCount = jest.fn(async (args: Call = {}) => {
    calls.reportCount.push(args);
    return counts.reportsOpen;
  });

  const reportFindMany = jest.fn(async (args: Call) => {
    calls.reportFindMany.push(args);
    return opts.reports ?? [REPORT_ROW];
  });

  const auditFindMany = jest.fn(async (args: Call) => {
    calls.auditFindMany.push(args);
    if (args.where?.actorType === "SYSTEM") return opts.systemAudit ?? [];
    return opts.audit ?? [];
  });

  const tx = {
    user: { count: userCount },
    adminUser: { count: adminUserCount },
    message: { count: messageCount },
    connection: { count: connectionCount },
    report: { count: reportCount, findMany: reportFindMany },
    adminAuditLog: { findMany: auditFindMany },
  };

  const prisma = { ...tx, $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)) };
  return { service: new AdminService(prisma as never), calls, prisma };
}

/** Every key path in a nested value, e.g. `recentAudit[0].adminId`. */
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

// ---------------------------------------------------------------------------
// 1-5. access for every role
// ---------------------------------------------------------------------------

describe("Dashboard — role access", () => {
  it("1-5. every existing role holds dashboard:read", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "dashboard:read")).toBe(true);
    }
  });

  it("1-5b. the dashboard handler actually declares the permission", () => {
    // Reading the metadata off the real controller proves the route is gated,
    // rather than merely proving the matrix would allow it.
    const declared = Reflect.getMetadata(
      PERMISSION_METADATA_KEY,
      AdminController.prototype.dashboard,
    );
    expect(declared).toBe("dashboard:read");
  });

  it("1-5c. PermissionGuard lets each role through to the dashboard", () => {
    for (const role of ALL_ROLES) {
      const guard = new PermissionGuard(reflectorReturning("dashboard:read"));
      const context = httpContext({ admin: admin(role) });
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it("1-5d. an admin with no attached identity is still rejected", () => {
    const guard = new PermissionGuard(reflectorReturning("dashboard:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// 6-13. statistics
// ---------------------------------------------------------------------------

describe("Dashboard — statistics", () => {
  it("6-13. returns every count from its own query, with no cross-wiring", async () => {
    const { service } = makeService();
    const result = await service.dashboard();

    expect(result).toMatchObject({
      users: COUNTS.users,
      active: COUNTS.active,
      suspended: COUNTS.suspended,
      banned: COUNTS.banned,
      activeToday: COUNTS.activeToday,
      todayNewUsers: COUNTS.todayNewUsers,
      newUsers7d: COUNTS.newUsers7d,
      messagesToday: COUNTS.messagesToday,
      connections: COUNTS.connections,
      reportsOpen: COUNTS.reportsOpen,
      admins: COUNTS.admins,
    });
  });

  it("6-9. ACTIVE / SUSPENDED / BANNED are counted separately and include zero", async () => {
    // A zero is real business data — SUSPENDED is genuinely 0 in the current
    // database — so it must be returned, not omitted or coerced away.
    const { service } = makeService({ counts: { suspended: 0 } });
    const result = await service.dashboard();

    expect(result.suspended).toBe(0);
    expect(result.active).toBe(COUNTS.active);
    expect(result.banned).toBe(COUNTS.banned);
  });

  it("10-11. today and 7d signups are reported independently", async () => {
    const { service } = makeService();
    const result = await service.dashboard();

    // Distinct sources: if both fields were wired to the same query the UI
    // would show "4 new today" and "4 this week", which is a visible lie.
    expect(result.todayNewUsers).toBe(COUNTS.todayNewUsers);
    expect(result.newUsers7d).toBe(COUNTS.newUsers7d);
    expect(result.todayNewUsers).not.toBe(result.newUsers7d);
  });

  it("10-11b. the 7-day window is 7 * 24h back and the day window is local midnight", async () => {
    const { service, calls } = makeService();
    await service.dashboard();

    const createdBoundaries = calls.userCount
      .map((call) => call.where?.createdAt?.gte)
      .filter((value): value is Date => value instanceof Date);
    expect(createdBoundaries).toHaveLength(2);

    const todayBoundary = new Date();
    todayBoundary.setHours(0, 0, 0, 0);
    const midnight = createdBoundaries.find(
      (boundary) => boundary.getTime() === todayBoundary.getTime(),
    );
    expect(midnight).toBeDefined();

    const sevenDays = createdBoundaries.find((boundary) => boundary !== midnight)!;
    const hoursBack = (Date.now() - sevenDays.getTime()) / 3_600_000;
    // ~168h, allowing for the milliseconds spent inside the test.
    expect(hoursBack).toBeGreaterThan(167.9);
    expect(hoursBack).toBeLessThan(168.1);
  });

  it("12. reportsOpen counts OPEN reports only", async () => {
    const { service, calls } = makeService();
    await service.dashboard();
    expect(calls.reportCount).toContainEqual({ where: { status: "OPEN" } });
  });

  it("13. admins counts active AdminUser rows, not User.isAdmin", async () => {
    const { service, calls } = makeService();
    await service.dashboard();

    expect(calls.adminUserCount).toEqual([{ where: { isActive: true } }]);
    // The regression this guards: the legacy flag must not be used at all.
    expect(calls.userCount.some((call) => "isAdmin" in (call.where ?? {}))).toBe(false);
  });

  it("13b. a revoked administrator is not counted", async () => {
    const { service } = makeService({ counts: { admins: 8 } });
    const result = await service.dashboard();
    expect(result.admins).toBe(8);
  });

  it("runs every read inside one transaction, so the figures are consistent", async () => {
    const { service, prisma } = makeService();
    await service.dashboard();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 14-17. recent lists
// ---------------------------------------------------------------------------

describe("Dashboard — recent audit", () => {
  it("14. returns the audit feed newest-first with the agreed fields", async () => {
    const rows = [
      auditRow({ id: "a-1", action: "ADMIN_USER_BAN" }),
      auditRow({ id: "a-2", action: "REPORT_RESOLVED", targetType: "REPORT", targetId: "r-1" }),
    ];
    const { service, calls } = makeService({ audit: rows });
    const result = await service.dashboard();

    expect(result.recentAudit).toEqual(rows);
    expect(calls.auditFindMany[0]).toMatchObject({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        actorType: true,
        adminId: true,
        detail: true,
        createdAt: true,
      },
    });
  });

  it("14b. the audit select names exactly eight fields — no more", async () => {
    const { service, calls } = makeService();
    await service.dashboard();
    const select = calls.auditFindMany[0].select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual([
      "action",
      "actorType",
      "adminId",
      "createdAt",
      "detail",
      "id",
      "targetId",
      "targetType",
    ]);
  });

  it("15-16. a SYSTEM row surfaces actorType SYSTEM with a null adminId", async () => {
    const rows = [
      auditRow({
        id: "a-sys",
        action: "SYSTEM_USER_SUSPENSION_EXPIRED",
        actorType: "SYSTEM",
        adminId: null,
        detail: "Auto-released 2 expired suspension(s)",
      }),
    ];
    const { service } = makeService({ audit: rows });
    const result = await service.dashboard();

    expect(result.recentAudit[0]).toMatchObject({
      actorType: "SYSTEM",
      adminId: null,
      action: "SYSTEM_USER_SUSPENSION_EXPIRED",
    });
  });

  it("16b. a USER row keeps its administrator id", async () => {
    const { service } = makeService({ audit: [auditRow({ id: "a-user" })] });
    const result = await service.dashboard();
    expect(result.recentAudit[0]).toMatchObject({ actorType: "USER", adminId: "admin-1" });
  });
});

describe("Dashboard — recent system events", () => {
  it("17. queries SYSTEM rows only, and does not select an actor id", async () => {
    const rows = [
      {
        id: "sys-1",
        action: "SYSTEM_USER_SUSPENSION_EXPIRED",
        targetType: "USER",
        targetId: null,
        detail: "Auto-released 1 expired suspension(s)",
        createdAt: new Date("2026-09-17T11:00:00.000Z"),
      },
    ];
    const { service, calls } = makeService({ systemAudit: rows });
    const result = await service.dashboard();

    expect(result.recentSystemEvents).toEqual(rows);
    const systemQuery = calls.auditFindMany.find((call) => call.where?.actorType === "SYSTEM");
    expect(systemQuery).toMatchObject({
      where: { actorType: "SYSTEM" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        detail: true,
        createdAt: true,
      },
    });
    // This list is SYSTEM by definition; there is no actor id to render.
    expect((systemQuery!.select as Record<string, unknown>).adminId).toBeUndefined();
  });
});

describe("Dashboard — recent resolved reports", () => {
  it("filters to terminal statuses and selects identity only", async () => {
    const { service, calls } = makeService();
    const result = await service.dashboard();

    expect(result.recentResolvedReports).toEqual([REPORT_ROW]);
    expect(calls.reportFindMany[0]).toMatchObject({
      where: { status: { in: ["RESOLVED", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        reason: true,
        status: true,
        messageId: true,
        momentId: true,
        createdAt: true,
        reporter: { select: { id: true, nickname: true, email: true } },
        reportedUser: { select: { id: true, nickname: true, email: true } },
      },
    });
  });

  it("never asks for the reporter's or reported user's private columns", async () => {
    const { service, calls } = makeService();
    await service.dashboard();
    const select = calls.reportFindMany[0].select as {
      reporter: { select: Record<string, unknown> };
      reportedUser: { select: Record<string, unknown> };
    };
    for (const party of [select.reporter, select.reportedUser]) {
      expect(Object.keys(party.select).sort()).toEqual(["email", "id", "nickname"]);
    }
  });

  // ---- PC-2.5.6: the feed must be able to name the target --------------

  it("selects both target pointers, not just the message one", async () => {
    // A report has no targetType column, so a feed that omits momentId renders
    // "reported this person" for a report that was about a moment.
    const { service, calls } = makeService();
    await service.dashboard();
    const select = calls.reportFindMany[0].select as Record<string, unknown>;
    expect(select.momentId).toBe(true);
    expect(select.messageId).toBe(true);
  });

  it("a resolved moment report carries its momentId and a null messageId", async () => {
    const { service } = makeService({
      reports: [
        {
          ...REPORT_ROW,
          id: "report-moment-1",
          momentId: "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
        },
      ],
    });
    const result = await service.dashboard();
    const row = result.recentResolvedReports[0] as unknown as {
      momentId: string | null;
      messageId: string | null;
    };
    expect(row.momentId).toBe("c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
    expect(row.messageId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 18. empty data
// ---------------------------------------------------------------------------

describe("Dashboard — empty database", () => {
  it("18. an empty platform returns zeros and empty lists, not nulls", async () => {
    const { service } = makeService({
      counts: {
        users: 0,
        active: 0,
        suspended: 0,
        banned: 0,
        activeToday: 0,
        todayNewUsers: 0,
        newUsers7d: 0,
        messagesToday: 0,
        connections: 0,
        reportsOpen: 0,
        admins: 0,
      },
      audit: [],
      systemAudit: [],
      reports: [],
    });

    const result = await service.dashboard();

    expect(result).toMatchObject({
      users: 0,
      active: 0,
      suspended: 0,
      banned: 0,
      activeToday: 0,
      todayNewUsers: 0,
      newUsers7d: 0,
      messagesToday: 0,
      connections: 0,
      reportsOpen: 0,
      admins: 0,
    });
    // Arrays, so the UI can distinguish "nothing yet" from "failed to load".
    expect(result.recentAudit).toEqual([]);
    expect(result.recentSystemEvents).toEqual([]);
    expect(result.recentResolvedReports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 19-22. no sensitive fields
// ---------------------------------------------------------------------------

describe("Dashboard — no sensitive fields", () => {
  const FORBIDDEN = [
    "passwordHash",
    "tokenHash",
    "refreshToken",
    "accessToken",
    "ip",
    "userAgent",
  ];

  it("19-22. the response exposes no credential, ip or user-agent field", async () => {
    const { service } = makeService({
      audit: [
        auditRow({ id: "a-1" }),
        auditRow({ id: "a-sys", actorType: "SYSTEM", adminId: null }),
      ],
      systemAudit: [
        {
          id: "sys-1",
          action: "SYSTEM_USER_SUSPENSION_EXPIRED",
          targetType: "USER",
          targetId: null,
          detail: null,
          createdAt: new Date(),
        },
      ],
    });

    const result = await service.dashboard();
    const paths = keyPaths(result);

    for (const key of FORBIDDEN) {
      expect(paths.filter((path) => path.endsWith(`.${key}`))).toEqual([]);
    }
  });

  it("19-22b. the serialized response contains no secret-shaped value", async () => {
    const { service } = makeService();
    const result = await service.dashboard();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/\$2[aby]\$/); // bcrypt hash
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
    expect(serialized).not.toMatch(/Mozilla\/5\.0/); // user-agent
  });
});
