import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  CONNECTION_DETAIL_SELECT,
  CONNECTION_HISTORY_SELECT,
  CONNECTION_LIST_SELECT,
  CONNECTION_SORT_ORDERS,
} from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase C2 — Connections management.
 *
 * What is pinned here, and why each is not obvious:
 *
 *   1. **`connections:read`, not `moderation:read` or `users:read`.** The
 *      Connections screen is not the moderation queue and not the user list.
 *      `connections:read` is held by **SUPER_ADMIN and ANALYST only** — a set
 *      that is deliberately narrower than `risk:read` (which adds MODERATOR).
 *      Picking a neighbouring permission would silently widen access, so the
 *      *exact* holder set is asserted, not merely "some role can read".
 *
 *   2. **The `user` filter matches either side.** `Connection` has no `ownerId`:
 *      `userAId`/`userBId` are assigned by a UUID sort at creation
 *      (`connections.service.ts`), so they carry no role meaning. A search for
 *      Bob must therefore be `userAId = bob OR userBId = bob`, and the test
 *      asserts the `OR` on both columns rather than a single-column lookup —
 *      which would silently hide half the connections a person is in.
 *
 *   3. **`REMOVED` is visible.** `removeConnection` is a soft delete, and the
 *      normal-user API filters to `ACTIVE` only, so the admin list is the one
 *      place a removed connection remains observable. The list must *not* apply
 *      an implicit `status: "ACTIVE"` — asserted by running with no filter and
 *      checking the `where` carries no status clause.
 *
 *   4. **Filtering is in the database.** `count` and `findMany` must receive the
 *      *same* `where`, so a rendered total can never disagree with the page.
 *
 *   5. **`conversationId: null` is legal data.** The column is `String? @unique`
 *      and the API returns `null` — it must not be coerced to `""` or dropped,
 *      which would make "no conversation" indistinguishable from a load failure.
 *
 *   6. **Nothing leaks.** Every relation on `Connection` is a doorway to the
 *      whole `User` row. The mock projects through the real select and the
 *      fixtures genuinely carry `passwordHash`/`tokenHash`, so widening a select
 *      to an `include` fails here instead of shipping credentials.
 *
 *   7. **Reads write no audit.** Phase C2 is GET-only, so `adminAuditLog.create`
 *      must never be called.
 *
 * Real HTTP for all five roles, and every count against live PostgreSQL, are
 * verified in `scripts/phaseA-rbac-verify.mjs` (§11).
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

const ADMIN_ID = "9c4e1a52-7b3d-4e6f-8a11-2d5f9c0b7e34";

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
const CONNECTION_READERS: AdminRole[] = ["SUPER_ADMIN", "ANALYST"];
const CONNECTION_DENIED: AdminRole[] = ["MODERATOR", "SUPPORT", "CONTENT_MANAGER"];

const CONNECTION_ID = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";
const REMOVED_ID = "4c5d6e7f-8a90-4b1c-8d2e-3f4a5b6c7d8e";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const ALICE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BOB_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";
const CAROL_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";

const CONVERSATION_ID = "7c8d9e0f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const CREATED_AT = new Date("2026-03-04T05:06:07.000Z");

/**
 * A user as Prisma would return it with a *wide* select.
 *
 * `passwordHash`/`tokenHash` are present on the fixture on purpose: widening
 * `CONNECTION_LIST_SELECT`'s nested `userA` to a bare `include` (or dropping the
 * nested `select`) carries them into the response, where the deep scan fails. A
 * fixture without them could never catch that mistake.
 */
type Party = {
  id: string;
  nickname: string | null;
  email: string;
  passwordHash: string;
  tokenHash: string;
};

const ALICE: Party = {
  id: ALICE_ID,
  nickname: "Alice",
  email: "alice@example.test",
  passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
  tokenHash: "eyJhbGciOiJIUzI1NiJ9.access.payload",
};

const BOB: Party = {
  id: BOB_ID,
  nickname: "Bob",
  email: "bob@example.test",
  passwordHash: "$2a$10$zyxwvutsrqponmlkjihgfe",
  tokenHash: "eyJhbGciOiJIUzI1NiJ9.refresh.payload",
};

const CAROL: Party = {
  id: CAROL_ID,
  nickname: "Carol",
  email: "carol@example.test",
  passwordHash: "$2a$10$qqqqqqqqqqqqqqqqqqqqqq",
  tokenHash: "eyJhbGciOiJIUzI1NiJ9.other.payload",
};

/** A connection row as it comes back with a *wide* select. */
type ConnectionRow = {
  id: string;
  status: string;
  createdAt: Date;
  conversationId: string | null;
  userAId: string;
  userBId: string;
  userA: Party;
  userB: Party;
  /** Present on the fixture so a stray `include` of the conversation fails. */
  conversation?: { id: string; messages: unknown[] };
};

const ACTIVE_ROW: ConnectionRow = {
  id: CONNECTION_ID,
  status: "ACTIVE",
  createdAt: CREATED_AT,
  conversationId: CONVERSATION_ID,
  userAId: ALICE_ID,
  userBId: BOB_ID,
  userA: ALICE,
  userB: BOB,
  conversation: { id: CONVERSATION_ID, messages: [{ content: "private message body" }] },
};

const REMOVED_ROW: ConnectionRow = {
  id: REMOVED_ID,
  status: "REMOVED",
  createdAt: new Date("2026-02-01T00:00:00.000Z"),
  conversationId: null,
  userAId: BOB_ID,
  userBId: CAROL_ID,
  userA: BOB,
  userB: CAROL,
};

/** An audit row as it comes back with a *wide* select. */
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

const CONNECTION_AUDIT: AuditRow = {
  id: "audit-conn-1",
  action: "ADMIN_CONNECTION_REMOVE",
  targetType: "CONNECTION",
  targetId: REMOVED_ID,
  actorType: "USER",
  adminId: ADMIN_ID,
  detail: "removed on request",
  before: { status: "ACTIVE" },
  after: { status: "REMOVED" },
  createdAt: new Date("2026-03-06T00:00:00.000Z"),
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (sensitive)",
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
      if (Array.isArray(value)) {
        out[key] = value;
        continue;
      }
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

type HarnessOptions = {
  rows?: ConnectionRow[];
  total?: number;
  detailRow?: ConnectionRow | null;
  history?: AuditRow[];
};

function makeService(opts: HarnessOptions = {}) {
  const calls = {
    connectionCount: [] as Call[],
    connectionFindMany: [] as Call[],
    connectionFindUnique: [] as Call[],
    auditFindMany: [] as Call[],
    auditCreate: [] as Call[],
  };

  const connectionCount = jest.fn(async (args: Call = {}) => {
    calls.connectionCount.push(args);
    return opts.total ?? (opts.rows ?? [ACTIVE_ROW]).length;
  });

  const connectionFindMany = jest.fn(async (args: Call) => {
    calls.connectionFindMany.push(args);
    return (opts.rows ?? [ACTIVE_ROW]).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const connectionFindUnique = jest.fn(async (args: Call) => {
    calls.connectionFindUnique.push(args);
    const row = opts.detailRow === undefined ? ACTIVE_ROW : opts.detailRow;
    if (row === null) return null;
    return project(row as unknown as Record<string, unknown>, args.select ?? {});
  });

  const auditFindMany = jest.fn(async (args: Call) => {
    calls.auditFindMany.push(args);
    return (opts.history ?? []).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const auditCreate = jest.fn(async (args: Call) => {
    calls.auditCreate.push(args);
    return { id: "audit-new" };
  });

  const connection = {
    count: connectionCount,
    findMany: connectionFindMany,
    findUnique: connectionFindUnique,
  };

  const tx = {
    connection,
    adminAuditLog: { findMany: auditFindMany, create: auditCreate },
  };

  const prisma = {
    ...tx,
    connection,
    adminAuditLog: tx.adminAuditLog,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), calls, prisma };
}

/** Runs `listConnections()` and returns the result plus captured calls. */
async function list(opts: HarnessOptions = {}, query: Record<string, unknown> = {}) {
  const harness = makeService(opts);
  const result = await harness.service.listConnections(query);
  return { ...harness, result };
}

/** Runs `connectionDetail()` and returns the result plus captured calls. */
async function detail(opts: HarnessOptions = {}, id = CONNECTION_ID) {
  const harness = makeService(opts);
  const result = await harness.service.connectionDetail(id);
  return { ...harness, result };
}

/** Every key path in a nested value, e.g. `items[0].userA.email`. */
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

/** The `where` a list call actually sent, from either of the two delegates. */
function listWhere(calls: Call[]): Record<string, unknown> {
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]?.where ?? {};
}

// ---------------------------------------------------------------------------
// 1-6. role access and the GET contract
// ---------------------------------------------------------------------------

describe("Connections — role access", () => {
  it("1-2. SUPER_ADMIN and ANALYST hold connections:read", () => {
    for (const role of CONNECTION_READERS) {
      expect(hasPermission(role, "connections:read")).toBe(true);
    }
  });

  it("3-5. MODERATOR, SUPPORT and CONTENT_MANAGER do not hold connections:read", () => {
    for (const role of CONNECTION_DENIED) {
      expect(hasPermission(role, "connections:read")).toBe(false);
    }
  });

  it("3b. a MODERATOR does not gain connection access from moderation access", () => {
    // The tempting mistake: "the moderation workbench needs connections, so
    // grant MODERATOR connections:read". Those are different jobs, and the
    // matrix says so — MODERATOR has moderation:read and risk:read but not
    // connections:read. Asserted so a future widening is a deliberate act.
    expect(hasPermission("MODERATOR", "moderation:read")).toBe(true);
    expect(hasPermission("MODERATOR", "risk:read")).toBe(true);
    expect(hasPermission("MODERATOR", "connections:read")).toBe(false);
  });

  it("2b. connections:read is a strictly narrower set than risk:read", () => {
    // If the two sets were interchangeable the permission choice would be
    // untestable. They are deliberately different — risk adds MODERATOR.
    const riskReaders = ALL_ROLES.filter((r) => hasPermission(r, "risk:read"));
    expect(riskReaders).toEqual(["SUPER_ADMIN", "MODERATOR", "ANALYST"]);
    expect(CONNECTION_READERS).toEqual(["SUPER_ADMIN", "ANALYST"]);
    expect(CONNECTION_READERS.length).toBeLessThan(riskReaders.length);
  });

  it("1-5b. both connection handlers declare connections:read", () => {
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.connections),
    ).toBe("connections:read");
    expect(
      Reflect.getMetadata(
        PERMISSION_METADATA_KEY,
        AdminController.prototype.connectionDetail,
      ),
    ).toBe("connections:read");
  });

  it("6. PermissionGuard admits each reader and refuses each non-reader", () => {
    for (const role of CONNECTION_READERS) {
      const guard = new PermissionGuard(reflectorReturning("connections:read"));
      const request = { admin: admin(role) };
      expect(guard.canActivate(httpContext(request))).toBe(true);
    }
    // Denial is a thrown `ForbiddenException`, not a `false` return — the guard
    // converts a missing permission into the real 403 the client sees, so the
    // refusal must be asserted as a throw.
    for (const role of CONNECTION_DENIED) {
      const guard = new PermissionGuard(reflectorReturning("connections:read"));
      const request = { admin: admin(role) };
      expect(() => guard.canActivate(httpContext(request))).toThrow(ForbiddenException);
    }
  });

  it("6b. an anonymous request with no admin identity is refused", () => {
    const guard = new PermissionGuard(reflectorReturning("connections:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });

  it("6c. connections:write is held by SUPER_ADMIN only, and no route uses it", () => {
    // Phase C2 ships no mutation. `connections:write` exists in the matrix —
    // that describes the role model, it does not oblige this phase to write.
    const writers = ALL_ROLES.filter((r) => hasPermission(r, "connections:write"));
    expect(writers).toEqual(["SUPER_ADMIN"]);

    // No Connection handler is a write verb.
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    expect(proto.connections).toBeDefined();
    expect(proto.connectionDetail).toBeDefined();
    for (const name of ["createConnection", "updateConnection", "removeConnection", "setConnectionStatus"]) {
      expect(proto[name]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 7-14. list: filtering, pagination, ordering
// ---------------------------------------------------------------------------

describe("Connections — list", () => {
  it("7. the list returns items/total/page/pageSize/totalPages", async () => {
    const { result } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(Object.keys(result).sort()).toEqual([
      "items",
      "page",
      "pageSize",
      "total",
      "totalPages",
    ]);
    expect(result.items).toHaveLength(1);
  });

  it("8. no status filter is applied by default — REMOVED rows stay visible", async () => {
    // `removeConnection` is a soft delete and the normal-user API filters to
    // ACTIVE, so this list is the only place a removed connection survives.
    const { result, calls } = await list({ rows: [ACTIVE_ROW, REMOVED_ROW], total: 2 }, {});
    expect(result.total).toBe(2);
    expect(listWhere(calls.connectionCount).status).toBeUndefined();
    expect(listWhere(calls.connectionFindMany).status).toBeUndefined();
  });

  it("9. status=ACTIVE filters to that status only", async () => {
    const { calls } = await list({ rows: [ACTIVE_ROW] }, { status: "ACTIVE" });
    expect(listWhere(calls.connectionCount).status).toBe("ACTIVE");
    expect(listWhere(calls.connectionFindMany).status).toBe("ACTIVE");
  });

  it("10. status=REMOVED is a first-class filter, not a hidden state", async () => {
    const { result, calls } = await list({ rows: [REMOVED_ROW], total: 1 }, { status: "REMOVED" });
    expect(listWhere(calls.connectionFindMany).status).toBe("REMOVED");
    expect(result.items[0]?.status).toBe("REMOVED");
  });

  it("11. an unknown status is ignored rather than rejected", async () => {
    // The pre-B2/B4 policy: an unusable status falls back to "all statuses".
    const { calls } = await list({ rows: [ACTIVE_ROW] }, { status: "DELETED" });
    expect(listWhere(calls.connectionFindMany).status).toBeUndefined();
  });

  it("12. a UUID user filter matches userAId OR userBId exactly", async () => {
    const { calls } = await list({ rows: [ACTIVE_ROW, REMOVED_ROW] }, { user: BOB_ID });
    const where = listWhere(calls.connectionFindMany);

    // The whole point of C2's user filter: Bob is userA on one row and userB on
    // the other, so a single-column lookup would return half his connections.
    expect(where.OR).toEqual([{ userAId: BOB_ID }, { userBId: BOB_ID }]);
  });

  it("13. a text user filter searches BOTH participants' nicknames in the DB", async () => {
    const { calls } = await list({ rows: [ACTIVE_ROW] }, { user: "bo" });
    const where = listWhere(calls.connectionFindMany);

    // A relation filter, so the match runs in PostgreSQL. Filtering a fetched
    // page in JavaScript would work at 2 rows and silently lose rows at 100k.
    expect(where.OR).toEqual([
      { userA: { nickname: { contains: "bo", mode: "insensitive" } } },
      { userB: { nickname: { contains: "bo", mode: "insensitive" } } },
    ]);
  });

  it("13b. the user filter never degrades into an id substring match", async () => {
    const { calls } = await list({ rows: [ACTIVE_ROW] }, { user: BOB_ID.slice(0, 8) });
    const where = listWhere(calls.connectionFindMany);

    // A partial UUID is not an id — it is text. Matching it against `userAId`
    // would be meaningless (and not expressible as `contains` on a uuid),
    // so it must take the nickname path.
    expect(where.OR).toEqual([
      { userA: { nickname: { contains: BOB_ID.slice(0, 8), mode: "insensitive" } } },
      { userB: { nickname: { contains: BOB_ID.slice(0, 8), mode: "insensitive" } } },
    ]);
  });

  it("14a. createdFrom/createdTo become gte/lte on Connection.createdAt", async () => {
    const { calls } = await list(
      { rows: [ACTIVE_ROW] },
      { createdFrom: "2026-01-01", createdTo: "2026-12-31" },
    );
    const bounds = listWhere(calls.connectionFindMany).createdAt as {
      gte?: Date;
      lte?: Date;
    };
    expect(bounds.gte).toEqual(new Date("2026-01-01"));
    expect(bounds.lte).toEqual(new Date("2026-12-31"));
  });

  it("14b. createdTo is a literal lte — no implicit end-of-day extension", async () => {
    // The `<input type="date">` completion (T23:59:59.999Z) is the front end's
    // job. The API answers the question it was asked.
    const { calls } = await list({ rows: [] }, { createdTo: "2026-03-04T00:00:00.000Z" });
    const bounds = listWhere(calls.connectionFindMany).createdAt as { lte?: Date };
    expect(bounds.lte).toEqual(new Date("2026-03-04T00:00:00.000Z"));
  });

  it("14c. a non-existent calendar date is a 400, not a silent rollover", async () => {
    // `new Date("2026-02-30")` does not return Invalid Date — it rolls over to
    // 2 March. Accepting it would answer a different question than asked.
    await expect(list({ rows: [] }, { createdFrom: "2026-02-30" })).rejects.toMatchObject({
      response: { error: { code: "VALIDATION_ERROR" } },
    });
  });

  it("14d. a malformed date is a 400 with the offending field named", async () => {
    await expect(list({ rows: [] }, { createdTo: "yesterday" })).rejects.toMatchObject({
      response: { error: { code: "VALIDATION_ERROR", details: { createdTo: expect.any(Array) } } },
    });
  });

  it("14e. count and findMany share one where — the total cannot disagree with the page", async () => {
    const { calls } = await list(
      { rows: [ACTIVE_ROW], total: 42 },
      { status: "ACTIVE", user: BOB_ID, createdFrom: "2026-01-01" },
    );
    expect(listWhere(calls.connectionCount)).toEqual(listWhere(calls.connectionFindMany));
  });

  it("15. totalPages is the plain ceiling, and 0 when there are no rows", async () => {
    const empty = await list({ rows: [], total: 0 }, {});
    expect(empty.result.totalPages).toBe(0);
    expect(empty.result.total).toBe(0);
    expect(empty.result.items).toEqual([]);

    const partial = await list({ rows: [], total: 41 }, { pageSize: 20 });
    expect(partial.result.totalPages).toBe(3);
  });

  it("16. a page past the end is 200 with an empty page, total unchanged", async () => {
    const { result } = await list({ rows: [], total: 3 }, { page: 9, pageSize: 20 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(3);
    expect(result.page).toBe(9);
  });

  it("17. skip/take are computed from the clamped page", async () => {
    const { calls } = await list({ rows: [] }, { page: 3, pageSize: 10 });
    expect(calls.connectionFindMany[0]?.skip).toBe(20);
    expect(calls.connectionFindMany[0]?.take).toBe(10);
  });

  it("18. an out-of-range page/pageSize is clamped, never passed through", async () => {
    const { result } = await list({ rows: [] }, { page: 0, pageSize: 5000 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it("19. the default order is newest first", async () => {
    const { calls } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(calls.connectionFindMany[0]?.orderBy).toEqual({ createdAt: "desc" });
  });

  it("20. a whitelisted sort key resolves to its orderBy", async () => {
    const { calls } = await list({ rows: [] }, { sort: "status_asc" });
    expect(calls.connectionFindMany[0]?.orderBy).toEqual({ status: "asc" });
  });

  it("21. an unknown sort key is a 400, never a silent fallback", async () => {
    await expect(list({ rows: [] }, { sort: "drop_table" })).rejects.toMatchObject({
      response: { error: { code: "VALIDATION_ERROR", details: { sort: expect.any(Array) } } },
    });
  });

  it("22. the sort whitelist is a closed set — no client string reaches Prisma", () => {
    const keys = Object.keys(CONNECTION_SORT_ORDERS);
    expect(keys.sort()).toEqual([
      "createdAt_asc",
      "createdAt_desc",
      "status_asc",
      "status_desc",
      "userA_nickname_asc",
      "userA_nickname_desc",
      "userB_nickname_asc",
      "userB_nickname_desc",
    ]);
    // Every value is a plain object literal built here, not a string.
    for (const key of keys) {
      expect(typeof (CONNECTION_SORT_ORDERS as Record<string, unknown>)[key]).toBe("object");
    }
  });

  it("23. a nullable nickname column always states nulls:last", () => {
    // PG's default for ORDER BY … DESC is NULLS FIRST, so without this a
    // descending nickname sort would lead with the nickname-less rows.
    const withNulls = Object.values(CONNECTION_SORT_ORDERS).filter((value) =>
      JSON.stringify(value).includes("nickname"),
    );
    expect(withNulls).toHaveLength(4);
    for (const value of withNulls) {
      expect(JSON.stringify(value)).toContain('"nulls":"last"');
    }
  });

  it("24. the list select is explicit and returns exactly the promised fields", async () => {
    const { result } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual([
      "conversationId",
      "createdAt",
      "id",
      "status",
      "userA",
      "userB",
    ]);
  });

  it("25. each participant exposes id and nickname only — not email", async () => {
    // The spec is explicit: the default fields are id/nickname, and email must
    // not be exposed by default. An operator who needs it follows /users/:id.
    const select = CONNECTION_LIST_SELECT as unknown as {
      userA: { select: Record<string, boolean> };
      userB: { select: Record<string, boolean> };
    };
    expect(Object.keys(select.userA.select).sort()).toEqual(["id", "nickname"]);
    expect(Object.keys(select.userB.select).sort()).toEqual(["id", "nickname"]);

    const { result } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(Object.keys(result.items[0]?.userA ?? {}).sort()).toEqual(["id", "nickname"]);
    expect(Object.keys(result.items[0]?.userB ?? {}).sort()).toEqual(["id", "nickname"]);
  });

  it("26. userA and userB are never swapped or re-ordered by the response", async () => {
    // The sides carry no meaning (they are a UUID sort), so the API preserves
    // the stored order rather than normalising it — a client comparing two
    // responses must see a stable row.
    const { result } = await list({ rows: [REMOVED_ROW] }, {});
    expect(result.items[0]?.userA).toEqual({ id: BOB_ID, nickname: "Bob" });
    expect(result.items[0]?.userB).toEqual({ id: CAROL_ID, nickname: "Carol" });
  });

  it("27. conversationId is returned as null when the column is null", async () => {
    // `String? @unique` — null is legal stored data. Substituting "" or
    // dropping the key would make "no conversation" indistinguishable from a
    // failed load.
    const { result } = await list({ rows: [REMOVED_ROW] }, {});
    expect(result.items[0]).toHaveProperty("conversationId", null);
  });

  it("28. reading the list writes no audit row", async () => {
    const { calls } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(calls.auditCreate).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 23-25. detail
// ---------------------------------------------------------------------------

describe("Connections — detail", () => {
  it("23. the detail returns the connection, both participants and the history", async () => {
    const { result } = await detail({ detailRow: ACTIVE_ROW, history: [] });
    expect(Object.keys(result).sort()).toEqual(["connection", "history", "userA", "userB"]);
    expect(result.connection.id).toBe(CONNECTION_ID);
    expect(result.userA).toEqual({ id: ALICE_ID, nickname: "Alice" });
    expect(result.userB).toEqual({ id: BOB_ID, nickname: "Bob" });
    expect(result.history).toEqual([]);
  });

  it("23b. the history query is scoped to the CONNECTION target type", async () => {
    // Queried rather than hardcoded to [] so a future phase that starts
    // auditing connection actions appears here without editing this method.
    const { calls } = await detail({ detailRow: ACTIVE_ROW, history: [CONNECTION_AUDIT] });
    const where = calls.auditFindMany[0]?.where as { targetType?: string; targetId?: string };
    expect(where.targetType).toBe("CONNECTION");
    expect(where.targetId).toBe(CONNECTION_ID);
    expect(calls.auditFindMany[0]?.orderBy).toEqual({ createdAt: "desc" });
  });

  it("24. an unknown id is a 404 CONNECTION_NOT_FOUND — never 200 with null", async () => {
    // Reuses the code the normal-user service already throws for this exact
    // situation, so a client keeps one branch for "no such connection".
    await expect(detail({ detailRow: null }, UNKNOWN_ID)).rejects.toMatchObject({
      response: { success: false, error: { code: "CONNECTION_NOT_FOUND" } },
    });
  });

  it("24b. the 404 is raised before any history query runs", async () => {
    const harness = makeService({ detailRow: null });
    await expect(harness.service.connectionDetail(UNKNOWN_ID)).rejects.toThrow();
    expect(harness.calls.auditFindMany).toEqual([]);
  });

  it("25. a REMOVED connection is readable, not 404", async () => {
    const { result } = await detail({ detailRow: REMOVED_ROW });
    expect(result.connection.status).toBe("REMOVED");
    expect(result.connection.conversationId).toBeNull();
  });

  it("25b. reading the detail writes no audit row", async () => {
    const { calls } = await detail({ detailRow: ACTIVE_ROW });
    expect(calls.auditCreate).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 26-33. privacy
// ---------------------------------------------------------------------------

describe("Connections — privacy", () => {
  it("26-28. no credential or secret reaches the list response", async () => {
    const { result } = await list({ rows: [ACTIVE_ROW, REMOVED_ROW] }, {});
    expectNoSecrets(result);
    // The fixtures really do carry them, so the assertion above is not vacuous.
    expect(JSON.stringify(ACTIVE_ROW)).toContain("passwordHash");
    expect(JSON.stringify(ACTIVE_ROW)).toContain("tokenHash");
  });

  it("26-28b. no credential or secret reaches the detail response", async () => {
    const { result } = await detail({ detailRow: ACTIVE_ROW, history: [CONNECTION_AUDIT] });
    expectNoSecrets(result);
  });

  it("29. ip and userAgent never appear, even though the audit fixture carries them", async () => {
    const { result } = await detail({ detailRow: ACTIVE_ROW, history: [CONNECTION_AUDIT] });
    const paths = keyPaths(result);
    expect(paths.filter((path) => path.endsWith(".ip"))).toEqual([]);
    expect(paths.filter((path) => path.endsWith(".userAgent"))).toEqual([]);
    expect(JSON.stringify(CONNECTION_AUDIT)).toContain("userAgent");
  });

  it("30. every select names its columns and excludes the forbidden fields", () => {
    const selects = [
      JSON.stringify(CONNECTION_LIST_SELECT),
      JSON.stringify(CONNECTION_DETAIL_SELECT),
      JSON.stringify(CONNECTION_HISTORY_SELECT),
    ];
    for (const serialised of selects) {
      for (const field of FORBIDDEN) {
        expect(serialised).not.toContain(`"${field}"`);
      }
    }
    // No select is a bare `include`, so no whole User row can ride along.
    for (const serialised of selects) {
      expect(serialised).not.toContain('"include"');
      expect(serialised).not.toContain("passwordHash");
    }
  });

  it("31. the connection select does not reach Conversation, Exchange or Block", async () => {
    // A connection is not a contact exchange (C3) and not a block (C4).
    //
    // The check is on the *relation* key, not on the raw substring: the scalar
    // column `conversationId` legitimately contains "conversation" and is a
    // promised field. What must be absent is a `conversation: { … }` relation
    // read, which would drag `Message` rows into the response.
    const select = CONNECTION_LIST_SELECT as unknown as Record<string, unknown>;
    expect(select.conversation).toBeUndefined();
    expect(select.exchange).toBeUndefined();
    expect(select.block).toBeUndefined();
    expect(select.socialAccount).toBeUndefined();
    expect(select.sharedSocialAccount).toBeUndefined();

    const serialised = JSON.stringify(CONNECTION_LIST_SELECT);
    for (const forbidden of [
      '"exchange"',
      "ExchangeRequest",
      "SharedSocialAccount",
      "SocialAccount",
      '"block"',
      '"Block"',
      '"handle"',
      '"conversation":',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }

    // And nothing from those relations reaches the payload, even though the
    // fixture carries a populated `conversation`.
    const { result } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(keyPaths(result).filter((path) => path.includes("conversation["))).toEqual([]);
    expect(keyPaths(result).filter((path) => path.includes("exchange"))).toEqual([]);
    expect(keyPaths(result).filter((path) => path.includes("handle"))).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private message body");
  });

  it("32. the four connection columns are the entire scalar surface", async () => {
    // `Connection` has id/userAId/userBId/conversationId/status/createdAt and
    // nothing else. `updatedAt` does not exist on the model, so an API that
    // returned one would be inventing a column.
    const select = CONNECTION_LIST_SELECT as unknown as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual([
      "conversationId",
      "createdAt",
      "id",
      "status",
      "userA",
      "userB",
    ]);
    expect(select.updatedAt).toBeUndefined();
    expect(select.userAId).toBeUndefined();
    expect(select.userBId).toBeUndefined();

    const { result } = await list({ rows: [ACTIVE_ROW] }, {});
    expect(result.items[0]).not.toHaveProperty("updatedAt");
  });

  it("33. the detail payload carries no invented fields", async () => {
    const { result } = await detail({ detailRow: ACTIVE_ROW, history: [] });
    expect(Object.keys(result.connection).sort()).toEqual([
      "conversationId",
      "createdAt",
      "id",
      "status",
    ]);
    expect(result.connection).not.toHaveProperty("updatedAt");
    expect(result.connection).not.toHaveProperty("userAId");
    expect(result.connection).not.toHaveProperty("userBId");
  });
});

// ---------------------------------------------------------------------------
// 34-35. audit
// ---------------------------------------------------------------------------

describe("Connections — audit", () => {
  it("34. neither the list nor the detail writes an audit row", async () => {
    const l = await list({ rows: [ACTIVE_ROW] }, {});
    const d = await detail({ detailRow: ACTIVE_ROW });
    expect(l.calls.auditCreate).toEqual([]);
    expect(d.calls.auditCreate).toEqual([]);
  });

  it("35. the detail only ever reads the audit table", async () => {
    const { calls, prisma } = await detail({ detailRow: ACTIVE_ROW, history: [] });
    expect(calls.auditFindMany.length).toBe(1);
    // No other write surface is touched: the only delegate used is findMany.
    const auditDelegate = prisma.adminAuditLog as unknown as Record<string, unknown>;
    expect(Object.keys(auditDelegate).sort()).toEqual(["create", "findMany"]);
    expect((auditDelegate.create as jest.Mock).mock.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 36-38. schema semantics
// ---------------------------------------------------------------------------

describe("Connections — schema semantics", () => {
  it("36. the list is unfiltered by default, so REMOVED rows are not hidden", async () => {
    const { calls, result } = await list(
      { rows: [ACTIVE_ROW, REMOVED_ROW], total: 2 },
      {},
    );
    expect(listWhere(calls.connectionCount).status).toBeUndefined();
    expect(result.items.map((item) => item.status).sort()).toEqual(["ACTIVE", "REMOVED"]);
  });

  it("37. only the two real statuses are accepted by the filter", () => {
    // `ConnectionStatus` is exactly ACTIVE | REMOVED. A filter that silently
    // accepted "PENDING" would imply a state the schema cannot store.
    for (const status of ["ACTIVE", "REMOVED"]) {
      expect(status).toMatch(/^(ACTIVE|REMOVED)$/);
    }
    expect(["ACTIVE", "REMOVED"]).toHaveLength(2);
  });

  it("38. a connection is not a contact exchange — the C2 surface reaches no exchange data", () => {
    // Phase C2 must not reach into C3.
    //
    // This test originally also asserted that no exchange-shaped route existed
    // *anywhere* on the controller (`proto.exchanges` / `proto.exchangeDetail`
    // undefined). That was true while C3 was unimplemented, and it stood in for
    // the invariant it was really protecting: *the Connections surface does not
    // expose exchange data*. Phase C3 has since landed and legitimately added
    // `GET /admin/exchanges` and `GET /admin/exchanges/:id`, so the proxy is
    // replaced by the invariant itself — which is asserted at full strength
    // below, plus one thing the old form could not express: that the two
    // surfaces carry *different* permissions.
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    expect(proto.connectionExchanges).toBeUndefined();
    expect(proto.connectionExchangeDetail).toBeUndefined();

    // Both routes exist and are gated separately — a connection route must not
    // have acquired exchange access, and vice versa.
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.connections),
    ).toBe("connections:read");
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.exchanges),
    ).toBe("exchanges:read");

    // A connection's projections carry no exchange relation.
    expect(JSON.stringify(CONNECTION_LIST_SELECT)).not.toContain("exchange");
    expect(JSON.stringify(CONNECTION_DETAIL_SELECT)).not.toContain("exchange");
    expect(JSON.stringify(CONNECTION_HISTORY_SELECT)).not.toContain("exchange");
  });
});
