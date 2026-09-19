import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  DEFAULT_USER_SORT,
  USER_LIST_SELECT,
  USER_SORT_ORDERS,
  type AdminListQuery,
} from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase B2 — the users list.
 *
 * Three things are pinned here, and they are independent of each other:
 *
 *   1. **Every filter reaches the database.** `search`, `status`, `country`,
 *      `createdFrom`/`createdTo` and `sort` all have to end up in the `where` /
 *      `orderBy` Prisma actually receives, and `count` has to see the *same*
 *      filter as `findMany` — otherwise the total disagrees with the rows and
 *      pagination lies. These tests assert the query, not just the response.
 *
 *   2. **Client input never becomes a query verbatim.** `sort` goes through a
 *      whitelist, dates are shape-checked before parsing, and a status value is
 *      only used when it is a real status. An unknown sort is a 400 rather than
 *      a silent fallback, because a silent fallback looks like success.
 *
 *   3. **Nothing leaks.** The list is the widest user-shaped response in the
 *      console. The mock below projects each row through the `select` the
 *      service asked for — exactly as Prisma would — so adding `passwordHash`
 *      to that select makes the value appear and fail the deep scan, instead of
 *      passing because the fixture never contained it.
 *
 * Real HTTP for all five roles, and every count against live PostgreSQL, are
 * verified in `scripts/phaseA-rbac-verify.mjs` (§2d).
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

const VICTIM_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";

/** A row as it would come back with a *wide* select, secrets included. */
type Row = {
  id: string;
  email: string;
  nickname: string | null;
  countryCode: string | null;
  status: string;
  isAdmin: boolean;
  bannedAt: Date | null;
  banReason: string | null;
  suspendedUntil: Date | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  // Deliberately present on the fixture: if the service ever widens its select
  // to include it, the projection carries it into the response and the leak
  // scan fails. A fixture without it could never catch that mistake.
  passwordHash: string;
  refreshToken: string;
};

const FULL_ROW: Row = {
  id: VICTIM_ID,
  email: "ann@example.test",
  nickname: "Ann",
  countryCode: "US",
  status: "ACTIVE",
  isAdmin: false,
  bannedAt: null,
  banReason: null,
  suspendedUntil: null,
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  lastActiveAt: new Date("2026-02-03T04:05:06.000Z"),
  passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
  refreshToken: "eyJhbGciOiJIUzI1NiJ9.refresh.payload",
};

/** The argument objects the service hands to Prisma. */
type Where = {
  OR?: Array<Record<string, unknown>>;
  status?: string;
  countryCode?: string;
  createdAt?: { gte?: Date; lte?: Date };
};

type Call = {
  where?: Where;
  /** `unknown` values because a sort clause can be a string or `{ sort, nulls }`. */
  orderBy?: Record<string, unknown>;
  skip?: number;
  take?: number;
  select?: Record<string, unknown>;
  include?: unknown;
  data?: Record<string, unknown>;
};

/** Emulates Prisma's select: only the named columns come back. */
function project(row: Row, select: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = (row as unknown as Record<string, unknown>)[key];
  }
  return out;
}

function makeService(opts: { total?: number; rows?: Row[] } = {}) {
  const calls = {
    count: [] as Call[],
    findMany: [] as Call[],
    update: [] as Call[],
    noteCreate: [] as Call[],
    auditCreate: [] as Call[],
  };

  const count = jest.fn(async (args: Call = {}) => {
    calls.count.push(args);
    return opts.total ?? 1;
  });

  const findMany = jest.fn(async (args: Call) => {
    calls.findMany.push(args);
    return (opts.rows ?? [FULL_ROW]).map((row) => project(row, args.select ?? {}));
  });

  const update = jest.fn(async (args: Call) => {
    calls.update.push(args);
    return { id: VICTIM_ID };
  });

  const noteCreate = jest.fn(async (args: Call) => {
    calls.noteCreate.push(args);
    return { id: "note-1" };
  });

  const auditCreate = jest.fn(async (args: Call) => {
    calls.auditCreate.push(args);
    return { id: "audit-1" };
  });

  const target = {
    id: VICTIM_ID,
    status: "ACTIVE",
    bannedAt: null,
    banReason: null,
    suspendedUntil: null,
    adminUser: null,
    email: "ann@example.test",
    nickname: "Ann",
    avatarUrl: null,
    countryCode: "US",
    isAdmin: false,
    createdAt: FULL_ROW.createdAt,
    lastActiveAt: FULL_ROW.lastActiveAt,
    reportsReceived: [],
    reportsMade: [],
    adminNotes: [],
  };

  const userFindUnique = jest.fn(async () => target);

  const tx = {
    user: { count, findMany, update, findUnique: userFindUnique },
    adminNote: { create: noteCreate },
    adminAuditLog: { create: auditCreate, findMany: jest.fn(async () => []) },
    connection: { count: jest.fn(async () => 0) },
    report: { count: jest.fn(async () => 0) },
    block: { count: jest.fn(async () => 0) },
    socialAccount: { count: jest.fn(async () => 0) },
  };

  const prisma = {
    ...tx,
    user: { ...tx.user, findUnique: userFindUnique },
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), calls, prisma, target };
}

/** Every key path in a nested value, e.g. `items[0].email`. */
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

/** Runs `searchUsers` and returns both the result and the captured calls. */
async function list(query: AdminListQuery, opts: { total?: number; rows?: Row[] } = {}) {
  const harness = makeService(opts);
  const result = await harness.service.searchUsers(query);
  return { ...harness, result };
}

/** The OR entries the service built, as a flat list of `field:op` markers. */
function orMarkers(call: Call): string[] {
  return (call.where?.OR ?? []).flatMap((entry) =>
    Object.entries(entry).map(([field, spec]) =>
      spec !== null && typeof spec === "object"
        ? `${field}:${Object.keys(spec as Record<string, unknown>).join("+")}`
        : `${field}:eq`,
    ),
  );
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
// 1-6. access
// ---------------------------------------------------------------------------

describe("Users list — role access", () => {
  it("1-5. every existing role holds users:read", () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, "users:read")).toBe(true);
    }
  });

  it("1-5b. the users handler declares users:read (the route is actually gated)", () => {
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.users)).toBe(
      "users:read",
    );
  });

  it("1-5c. PermissionGuard admits each role to the users list", () => {
    for (const role of ALL_ROLES) {
      const guard = new PermissionGuard(reflectorReturning("users:read"));
      expect(guard.canActivate(httpContext({ admin: admin(role) }))).toBe(true);
    }
  });

  it("1-5d. upgrading the list must not widen write access", () => {
    // B2 §十五: ANALYST and CONTENT_MANAGER keep users:read and gain nothing.
    for (const role of ["ANALYST", "CONTENT_MANAGER"] as AdminRole[]) {
      expect(hasPermission(role, "users:read")).toBe(true);
      expect(hasPermission(role, "users:write")).toBe(false);
    }
  });

  it("6. a request with no resolved admin identity is rejected", () => {
    const guard = new PermissionGuard(reflectorReturning("users:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// 7-10. pagination
// ---------------------------------------------------------------------------

describe("Users list — pagination", () => {
  it("7. page and pageSize become skip/take, and are echoed back", async () => {
    const { calls, result } = await list({ page: 3, pageSize: 10 });
    expect(calls.findMany[0].skip).toBe(20);
    expect(calls.findMany[0].take).toBe(10);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
  });

  it("8. count and findMany receive the identical filter, so total matches the rows", async () => {
    const { calls } = await list({ search: "ann", status: "ACTIVE", country: "US" });
    expect(calls.count).toHaveLength(1);
    expect(calls.findMany).toHaveLength(1);
    // Same object shape, same values. A total computed from a different filter
    // is the classic way pagination starts disagreeing with the page.
    expect(calls.count[0].where).toEqual(calls.findMany[0].where);
  });

  it("9. total is the database count and totalPages is its ceiling", async () => {
    const { result } = await list({ pageSize: 20 }, { total: 45 });
    expect(result.total).toBe(45);
    expect(result.totalPages).toBe(3);
  });

  it("9b. an empty result set has totalPages 0, never 1", async () => {
    // B2 §十: the console renders 「第 1 / 0 页」 if this is fudged to 1, so the
    // API reports the honest ceiling and the UI handles 0 as "no pages".
    const { result } = await list({}, { total: 0, rows: [] });
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("9c. totalPages is exactly ceil(total / pageSize) at the boundary", async () => {
    for (const [total, pageSize, want] of [
      [20, 20, 1],
      [21, 20, 2],
      [1, 20, 1],
      [100, 10, 10],
    ] as const) {
      const { result } = await list({ pageSize }, { total });
      expect(result.totalPages).toBe(want);
    }
  });

  it("10. page and pageSize keep their existing 1..1000 / 1..100 bounds", async () => {
    const { calls, result } = await list({ page: 5000, pageSize: 1000 });
    expect(result.page).toBe(1000);
    expect(result.pageSize).toBe(100);
    expect(calls.findMany[0].skip).toBe((1000 - 1) * 100);
  });
});

// ---------------------------------------------------------------------------
// 11-14. search
// ---------------------------------------------------------------------------

describe("Users list — search", () => {
  it("11. search matches email case-insensitively", async () => {
    const { calls } = await list({ search: "ANN@Example" });
    expect(calls.findMany[0].where?.OR).toContainEqual({
      email: { contains: "ANN@Example", mode: "insensitive" },
    });
  });

  it("12. search matches nickname case-insensitively", async () => {
    const { calls } = await list({ search: "ann" });
    expect(calls.findMany[0].where?.OR).toContainEqual({
      nickname: { contains: "ann", mode: "insensitive" },
    });
  });

  it("13. search on a UUID adds an exact id match, never a fuzzy one", async () => {
    const { calls } = await list({ search: VICTIM_ID });
    const markers = orMarkers(calls.findMany[0]);
    expect(markers).toContain("id:eq");
    // A partial uuid must not produce an id clause at all: `contains` on a uuid
    // column is not expressible, and a prefix match would be a surprise.
    const partial = await list({ search: VICTIM_ID.slice(0, 8) });
    expect(orMarkers(partial.calls.findMany[0])).not.toContain("id:eq");
  });

  it("13b. a non-UUID keyword still searches email and nickname", async () => {
    const { calls } = await list({ search: "victim" });
    expect(orMarkers(calls.findMany[0]).sort()).toEqual(["email:contains+mode", "nickname:contains+mode"]);
  });

  it("14. q still works on its own, and search wins when both are sent", async () => {
    const legacy = await list({ q: "legacy-keyword" });
    expect(legacy.calls.findMany[0].where?.OR).toContainEqual({
      email: { contains: "legacy-keyword", mode: "insensitive" },
    });

    const both = await list({ q: "old", search: "new" });
    expect(both.calls.findMany[0].where?.OR).toContainEqual({
      email: { contains: "new", mode: "insensitive" },
    });
    expect(JSON.stringify(both.calls.findMany[0].where)).not.toContain("old");
  });

  it("14b. a blank keyword adds no filter at all", async () => {
    for (const query of [{}, { search: "" }, { search: "   " }, { q: "" }] as AdminListQuery[]) {
      const { calls } = await list(query);
      expect(calls.findMany[0].where?.OR).toBeUndefined();
    }
  });

  it("14c. an over-long keyword is truncated rather than passed through", async () => {
    const { calls } = await list({ search: "x".repeat(500) });
    const email = (calls.findMany[0].where?.OR ?? []).find((e) => "email" in e) as {
      email: { contains: string };
    };
    expect(email.email.contains).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// 15-18. status
// ---------------------------------------------------------------------------

describe("Users list — status filter", () => {
  it("15-18. each of the four statuses becomes an equality filter", async () => {
    for (const status of ["ACTIVE", "DISABLED", "SUSPENDED", "BANNED"]) {
      const { calls } = await list({ status });
      expect(calls.findMany[0].where?.status).toBe(status);
    }
  });

  it("15-18b. DISABLED is still a first-class status, not a legacy alias", async () => {
    // B2 §六: DISABLED must not be dropped while the page is reworked.
    const { calls } = await list({ status: "disabled" });
    expect(calls.findMany[0].where?.status).toBe("DISABLED");
  });

  it("15-18c. an unknown status is ignored and the filter falls back to ALL", async () => {
    // The pre-B2 compatibility behaviour, kept on purpose (B2 §六).
    for (const status of ["ALL", "", "OPEN", "DELETED", "DROP TABLE"]) {
      const { calls } = await list({ status });
      expect(calls.findMany[0].where?.status).toBeUndefined();
    }
  });

  it("15-18d. status is matched case-insensitively", async () => {
    const { calls } = await list({ status: "banned" });
    expect(calls.findMany[0].where?.status).toBe("BANNED");
  });
});

// ---------------------------------------------------------------------------
// 19. country
// ---------------------------------------------------------------------------

describe("Users list — country filter", () => {
  it("19. country becomes an exact countryCode match", async () => {
    const { calls } = await list({ country: "US" });
    expect(calls.findMany[0].where?.countryCode).toBe("US");
  });

  it("19b. a lower-case code is normalised, not passed through", async () => {
    const { calls } = await list({ country: " cn " });
    expect(calls.findMany[0].where?.countryCode).toBe("CN");
  });

  it("19c. a value that cannot be a Char(2) code is ignored", async () => {
    // Same policy as an unknown status: a code that can never match would
    // otherwise return an empty list that looks like "no such users".
    for (const country of ["", "USA", "U", "1!", "ALL"]) {
      const { calls } = await list({ country });
      expect(calls.findMany[0].where?.countryCode).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 20-22, 28. dates
// ---------------------------------------------------------------------------

describe("Users list — createdAt range", () => {
  it("20. createdFrom becomes a lower bound (gte)", async () => {
    const { calls } = await list({ createdFrom: "2026-01-01T00:00:00.000Z" });
    const range = calls.findMany[0].where?.createdAt;
    expect(range?.gte?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range?.lte).toBeUndefined();
  });

  it("21. createdTo becomes an upper bound (lte)", async () => {
    const { calls } = await list({ createdTo: "2026-06-30T23:59:59.999Z" });
    const range = calls.findMany[0].where?.createdAt;
    expect(range?.lte?.toISOString()).toBe("2026-06-30T23:59:59.999Z");
    expect(range?.gte).toBeUndefined();
  });

  it("22. both bounds together produce a closed range", async () => {
    const { calls } = await list({
      createdFrom: "2026-01-01",
      createdTo: "2026-06-30",
    });
    const range = calls.findMany[0].where?.createdAt;
    expect(range?.gte?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(range?.lte?.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("22b. no dates means no createdAt clause at all (all time, the default)", async () => {
    const { calls } = await list({});
    expect(calls.findMany[0].where?.createdAt).toBeUndefined();
  });

  it("28. a malformed date is a 400 VALIDATION_ERROR naming the field", async () => {
    // B2 §八: never let a bad value reach Prisma and surface as a driver error.
    await expectValidationError(list({ createdFrom: "not-a-date" }), "createdFrom");
    await expectValidationError(list({ createdTo: "17/09/2026" }), "createdTo");
    await expectValidationError(list({ createdFrom: "2026-02-30" }), "createdFrom");
    await expectValidationError(list({ createdTo: "2026-13-01" }), "createdTo");
    await expectValidationError(list({ createdTo: "2026-04-31" }), "createdTo");
  });

  it("28d. a non-existent day is rejected, not rolled over into the next month", async () => {
    // `new Date("2026-02-30")` is *not* Invalid Date — it silently becomes
    // 2 March. A shape check alone would let the operator's filter mean a
    // different day than the one they typed.
    expect(new Date("2026-02-30").getTime()).not.toBeNaN();
    await expectValidationError(list({ createdFrom: "2026-02-30" }), "createdFrom");
  });

  it("28e. a real leap day is accepted", async () => {
    const { calls } = await list({ createdFrom: "2028-02-29" });
    expect(calls.findMany[0].where?.createdAt?.gte?.toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("28b. a rejected date never reaches the database", () => {
    const harness = makeService();
    // Validation runs before the transaction is opened, so a bad bound fails
    // without a single query being issued — not even the count.
    expect(() => harness.service.searchUsers({ createdFrom: "nope" })).toThrow(
      BadRequestException,
    );
    expect(harness.calls.count).toHaveLength(0);
    expect(harness.calls.findMany).toHaveLength(0);
  });

  it("28c. an inverted range is still a valid query (it simply matches nothing)", async () => {
    const { calls, result } = await list(
      { createdFrom: "2026-06-30", createdTo: "2026-01-01" },
      { total: 0, rows: [] },
    );
    expect(calls.findMany[0].where?.createdAt).toBeDefined();
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 23-27, 29. sort
// ---------------------------------------------------------------------------

describe("Users list — sort whitelist", () => {
  it("23-26. each supported sort maps to its own orderBy", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["createdAt_desc", { createdAt: "desc" }],
      ["createdAt_asc", { createdAt: "asc" }],
      // `nulls: "last"` is required, not cosmetic: PostgreSQL's default for a
      // DESC sort is NULLS FIRST, which would lead "最近活跃 倒序" with the
      // accounts that have never been active.
      ["lastActiveAt_desc", { lastActiveAt: { sort: "desc", nulls: "last" } }],
      ["lastActiveAt_asc", { lastActiveAt: { sort: "asc", nulls: "last" } }],
      ["nickname_asc", { nickname: "asc" }],
      ["nickname_desc", { nickname: "desc" }],
      ["status_asc", { status: "asc" }],
      ["status_desc", { status: "desc" }],
    ];
    for (const [key, want] of cases) {
      const { calls } = await list({ sort: key });
      expect(calls.findMany[0].orderBy).toEqual(want);
    }
  });

  it("23-26b. every nullable-column sort keeps never-active users at the end", async () => {
    for (const key of ["lastActiveAt_desc", "lastActiveAt_asc"] as const) {
      const { calls } = await list({ sort: key });
      const clause = calls.findMany[0].orderBy?.lastActiveAt as unknown as {
        sort: string;
        nulls: string;
      };
      expect(clause.nulls).toBe("last");
    }
  });

  it("23. omitting sort keeps the pre-B2 default order", async () => {
    const { calls } = await list({});
    expect(calls.findMany[0].orderBy).toEqual({ createdAt: "desc" });
    expect(USER_SORT_ORDERS[DEFAULT_USER_SORT]).toEqual({ createdAt: "desc" });
  });

  it("27. an unknown sort is a 400, never a silent fallback", async () => {
    // B2 §九: a silent fallback would make a client typo look like success.
    await expectValidationError(list({ sort: "email_asc" }), "sort");
    await expectValidationError(list({ sort: "createdAt desc" }), "sort");
    await expectValidationError(list({ sort: "createdAt" }), "sort");
    await expectValidationError(list({ sort: "id; DROP TABLE" }), "sort");
  });

  it("27b. the whitelist is the only path to orderBy — no column can be named by a client", async () => {
    const allowed = Object.keys(USER_SORT_ORDERS);
    const { calls } = await list({ sort: "nickname_asc" });
    // Every sort key in the map is a member of the whitelist, and the resolved
    // orderBy only ever names a column the whitelist mentions.
    expect(allowed).toContain("nickname_asc");
    expect(Object.keys(calls.findMany[0].orderBy ?? {})).toEqual(["nickname"]);
  });

  it("29. page bounds are clamped, not rejected", async () => {
    for (const [input, want] of [
      [0, 1],
      [-5, 1],
      [1, 1],
      [1000, 1000],
      [1001, 1000],
    ] as const) {
      const { result } = await list({ page: input });
      expect(result.page).toBe(want);
    }
    const nan = await list({ page: Number("abc") });
    expect(nan.result.page).toBe(1);
  });

  it("30. pageSize bounds are clamped, not rejected", async () => {
    for (const [input, want] of [
      [1, 1],
      [100, 100],
      [101, 100],
      [-1, 1],
    ] as const) {
      const { result } = await list({ pageSize: input });
      expect(result.pageSize).toBe(want);
    }
    // `0` and a non-numeric value fall back to the default (20), not to 1 —
    // the pre-B2 behaviour, preserved so the clamp rework changed nothing.
    for (const input of [0, Number("abc")]) {
      const { result } = await list({ pageSize: input });
      expect(result.pageSize).toBe(20);
    }
  });
});

// ---------------------------------------------------------------------------
// 31. empty result
// ---------------------------------------------------------------------------

describe("Users list — empty result", () => {
  it("31. an empty page is empty arrays and zeroes, not nulls", async () => {
    const { result } = await list({ search: "nobody-matches-this" }, { total: 0, rows: [] });
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    expect(JSON.stringify(result)).not.toContain("null");
  });

  it("31b. the response keeps every pre-existing key (additive only)", async () => {
    const { result } = await list({});
    for (const key of ["items", "total", "page", "pageSize"]) {
      expect(result).toHaveProperty(key);
    }
    expect(result).toHaveProperty("totalPages");
  });
});

// ---------------------------------------------------------------------------
// 32. sensitive fields
// ---------------------------------------------------------------------------

describe("Users list — sensitive field protection", () => {
  it("32. the select is an explicit allowlist — no include, no bare findMany", async () => {
    const { calls } = await list({});
    expect(calls.findMany[0].select).toBeDefined();
    expect(calls.findMany[0].include).toBeUndefined();
    expect(Object.keys(calls.findMany[0].select ?? {}).sort()).toEqual(
      Object.keys(USER_LIST_SELECT).sort(),
    );
  });

  it("32b. the allowlist exposes exactly the agreed columns", async () => {
    expect(Object.keys(USER_LIST_SELECT).sort()).toEqual(
      [
        "bannedAt",
        "banReason",
        "countryCode",
        "createdAt",
        "email",
        "id",
        "isAdmin",
        "lastActiveAt",
        "nickname",
        "status",
        "suspendedUntil",
      ].sort(),
    );
  });

  it("32c. a row projected through that select carries no secret, at any depth", async () => {
    // The fixture row *does* carry passwordHash/refreshToken, so this fails the
    // moment the select is widened rather than passing by accident.
    const { result } = await list({});
    const paths = keyPaths(result);
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "ip",
      "userAgent",
    ]) {
      expect(paths.filter((p) => p.endsWith(`.${forbidden}`))).toEqual([]);
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/\$2[aby]\$/);
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{4,}\./);
  });

  it("32d. no relation is loaded, so no nested user object can appear", async () => {
    const { result } = await list({});
    const nested = keyPaths(result).filter((p) => /^items\[\d+\]\.[a-zA-Z]+\.[a-zA-Z]/.test(p));
    expect(nested).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 33-34. the pre-existing write paths are untouched
// ---------------------------------------------------------------------------

describe("Users — pre-existing status action and audit still work", () => {
  it("33. POST /admin/users/:id/status keeps its action set and audit trail", async () => {
    const { service, calls } = makeService();
    await service.setStatus({
      targetUserId: VICTIM_ID,
      action: "ban",
      reason: "phase B2 regression check",
      admin: admin("SUPER_ADMIN"),
      ip: "203.0.113.7",
      userAgent: "jest",
    });

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].data?.status).toBe("BANNED");
    expect(calls.noteCreate).toHaveLength(1);
    expect(calls.auditCreate).toHaveLength(1);
    expect(calls.auditCreate[0].data?.action).toBe("ADMIN_USER_BAN");
    expect(calls.auditCreate[0].data?.targetType).toBe("USER");
  });

  it("33b. the role/action matrix is unchanged by the list rework", async () => {
    // B2 §十四/§十五: the list may not widen who can write.
    const { service } = makeService();
    await expect(
      service.setStatus({
        targetUserId: VICTIM_ID,
        action: "disable",
        reason: "analyst is read-only",
        admin: admin("ANALYST"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("34. reading the list writes no audit row", async () => {
    const { calls } = await list({ search: "ann", status: "ACTIVE" });
    expect(calls.auditCreate).toHaveLength(0);
  });

  it("34b. one transaction, two queries — the list never mutates anything", async () => {
    const { calls, prisma } = await list({ page: 2, pageSize: 5, sort: "nickname_asc" });
    expect((prisma.$transaction as jest.Mock).mock.calls).toHaveLength(1);
    expect(calls.count).toHaveLength(1);
    expect(calls.findMany).toHaveLength(1);
    expect(calls.update).toHaveLength(0);
    expect(calls.noteCreate).toHaveLength(0);
  });
});
