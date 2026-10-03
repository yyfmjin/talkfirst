import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import {
  PERMISSIONS,
  ROLE_ALLOWED_STATUS_ACTIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  type Permission,
} from "./permissions";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { ADMIN_PUBLIC_METADATA_KEY } from "./admin-public.decorator";
import { UuidParamPipe } from "./uuid-param.pipe";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase C5 — Integration.
 *
 * This suite exists to pin the contracts **between** the phases that already
 * shipped (B1 Dashboard, B2 Users, B3 User Detail/Status, B4 Reports,
 * B5 Moderation, C1 Risk, C2 Connections, C3 Exchanges, C4 Blocks). It
 * deliberately does not re-test any single domain: those suites own their own
 * rules. What is pinned here is only what a single-domain suite structurally
 * cannot see:
 *
 *   1. **One route table, introspected.** The `(method, path, permission)`
 *      triples are read off the real controller with `Reflect`, not copied from
 *      a comment. Any route that gains, loses or changes a gate fails here —
 *      which is what makes "page gate / nav gate / API gate agree" checkable
 *      instead of aspirational.
 *
 *   2. **The exact holder set of every read permission.** `§五` of the C5 brief
 *      asks specifically whether a MODERATOR gains Connections / Exchanges /
 *      Blocks through `moderation:read` or `risk:read`, and whether SUPPORT
 *      gains the advanced read-only domains. Those are assertions about the
 *      *matrix*, so they are asserted as whole sets, not as "some role can".
 *
 *   3. **Two screens that show the same number compute it the same way.**
 *      `Dashboard.connections`, `Dashboard.reportsOpen`, `Risk.overview.*` and
 *      `UserDetail.*Count` are cross-domain statements about the same rows. The
 *      `where` clauses are compared to each other, so a change to one screen's
 *      definition fails on the other.
 *
 *   4. **The places the definitions deliberately differ.** The connections
 *      *list* shows `REMOVED` rows while the *counts* are `ACTIVE`-only; the
 *      audit list has no `totalPages`. Both are documented product contracts,
 *      and both are pinned as "exactly this difference" so a future
 *      unification-by-refactor fails loudly instead of quietly changing a
 *      number an operator reads.
 *
 *   5. **GET never writes audit.** Every read method is driven against a mock
 *      whose `adminAuditLog.create` records, and the whole set is asserted to
 *      have written nothing. The write paths are asserted to still attribute to
 *      `USER` with a real `adminId`, and the machine path to `SYSTEM` with none.
 *
 *   6. **One error vocabulary.** The `*_NOT_FOUND` codes, the shared
 *      `VALIDATION_ERROR` envelope for malformed input, and — added by C5 — the
 *      rule that a path parameter which is not a UUID is a **400, not a 500**.
 *
 * Real HTTP, real PostgreSQL and every cross-domain count against independent
 * SQL are verified separately in `scripts/phaseA-rbac-verify.mjs` (§10h).
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

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

const ALICE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BOB_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";
/** A well-formed UUID that matches no fixture. */
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
/** A path parameter that is not a UUID at all. */
const NOT_A_UUID = "not-a-uuid";

type Call = { model: string; op: string; args: Record<string, unknown> };
type Overrides = Record<string, (args: Record<string, unknown>) => unknown>;

/**
 * A recording Prisma stand-in.
 *
 * Unlike the per-domain suites — which hand-build the two or three delegates
 * they need and omit the rest on purpose — this suite drives methods from nine
 * different screens, so the delegate set is open-ended. A `Proxy` gives every
 * model name a working delegate while still recording the exact `where`/`select`
 * each call carried, which is what the cross-domain comparisons need.
 *
 * The default answers are the empty ones (`count → 0`, `findMany → []`,
 * `findUnique → null`), so a method that is not explicitly fed a fixture is
 * exercised on its empty path and cannot silently rely on data.
 */
/**
 * Emulates Prisma's `select`: only the named columns come back, recursively.
 *
 * The mock must honour `select`, otherwise every "the response carries no
 * forbidden field" assertion would be measuring the fixture instead of the
 * projection — and would pass for a service that selected everything.
 */
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
        const nested = (spec as { select?: Record<string, unknown> }).select;
        out[key] = nested
          ? value.map((entry) => project(entry as Record<string, unknown>, nested))
          : value;
        continue;
      }
      const nested = spec as { select?: Record<string, unknown> };
      out[key] = nested.select ? project(value as Record<string, unknown>, nested.select) : value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function makePrisma(overrides: Overrides = {}) {
  const calls: Call[] = [];

  /** Emulates `prisma.report.fields.reportedUserId` used by the risk overview. */
  const fields = (model: string) =>
    new Proxy(
      {},
      { get: (_t, field: string) => ({ $field: `${model}.${String(field)}` }) },
    );

  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          if (op === "fields") return fields(model);
          return async (args: Record<string, unknown> = {}) => {
            calls.push({ model, op, args });
            const select = args.select as Record<string, unknown> | undefined;
            const apply = (row: unknown) => {
              if (!select || !row || typeof row !== "object") return row;
              if (Array.isArray(row)) {
                return row.map((entry) => project(entry as Record<string, unknown>, select));
              }
              return project(row as Record<string, unknown>, select);
            };

            const override = overrides[`${model}.${op}`];
            if (override) return apply(override(args));
            if (op === "count") return 0;
            if (op === "findMany") return [];
            if (op === "findUnique" || op === "findFirst") return null;
            if (op === "create") return { id: `${model}-created` };
            if (op === "update") return { id: `${model}-updated` };
            if (op === "updateMany") return { count: 1 };
            return null;
          };
        },
      },
    );

  const delegates = new Map<string, unknown>();
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== "string") return undefined;
        // The transaction client is the same recording object, so a write made
        // inside `$transaction` is recorded exactly like any other.
        if (prop === "$transaction") return async (fn: (client: unknown) => unknown) => fn(prisma);
        if (!delegates.has(prop)) delegates.set(prop, delegate(prop));
        return delegates.get(prop);
      },
    },
  );

  return { prisma: prisma as never, calls };
}

/**
 * Runs `run` and returns whatever it throws.
 *
 * Necessary because not every list method is `async`: `searchUsers` and
 * `listReports` validate their parameters **synchronously** and throw before a
 * promise exists, so `.catch()` never sees the error. `await` inside `try`
 * catches both shapes.
 */
async function capture(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return error;
  }
}

function callsOf(calls: Call[], model: string, op: string): Call[] {
  return calls.filter((c) => c.model === model && c.op === op);
}

function firstWhere(calls: Call[], model: string, op: string): Record<string, unknown> {
  const matches = callsOf(calls, model, op);
  expect(matches.length).toBeGreaterThan(0);
  return (matches[0]?.args.where ?? {}) as Record<string, unknown>;
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

/** The field names that must never reach an admin client, at any depth. */
const FORBIDDEN = [
  "passwordHash",
  "tokenHash",
  "refreshToken",
  "accessToken",
  "oauth",
  "secret",
  "clientSecret",
  "ip",
  "userAgent",
  "handle",
];

function expectNoSecrets(payload: unknown, label: string) {
  const paths = keyPaths(payload);
  for (const field of FORBIDDEN) {
    const hits = paths.filter((path) => path.toLowerCase().endsWith(`.${field.toLowerCase()}`));
    expect({ label, field, hits }).toEqual({ label, field, hits: [] });
  }
}

/** The response payload of a Nest `HttpException`, for code/status assertions. */
function thrownBy(error: unknown): { status: number; code: string; details?: unknown } {
  const exception = error as {
    getStatus?: () => number;
    getResponse?: () => { error?: { code?: string; details?: unknown } };
  };
  const response = exception.getResponse?.() ?? {};
  return {
    status: exception.getStatus?.() ?? 0,
    code: response.error?.code ?? "",
    details: response.error?.details,
  };
}

/**
 * Reads a source file relative to this spec.
 *
 * A few contracts in this suite are about the *shape* of the code rather than
 * its behaviour — "no `include` anywhere", "no select names a handle", "the
 * console's mirror of the matrix agrees with the server's". Those are exactly
 * the properties a future edit can break without any runtime test noticing, so
 * they are asserted against the source text.
 */
function readSource(...segments: string[]): string {
  return readFileSync(join(__dirname, ...segments), "utf8");
}

// ---------------------------------------------------------------------------
// 1. the route table, introspected from the real controller
// ---------------------------------------------------------------------------

/**
 * The expected `(method, path, permission)` triples.
 *
 * `permission: undefined` is a deliberate, documented exception: `GET /admin/me`
 * is reachable by any authenticated admin because it only reports the caller's
 * own identity. Because `PermissionGuard` is fail-closed (FIX, audit P006), that
 * exception is expressed in the code as an explicit `@AdminPublic()` — pinned by
 * test 3b below — rather than by an absent decorator.
 */
const ROUTE_TABLE: Array<{
  handler: keyof AdminController;
  method: RequestMethod;
  path: string;
  permission?: Permission;
}> = [
  { handler: "dashboard", method: RequestMethod.GET, path: "dashboard", permission: "dashboard:read" },
  { handler: "me", method: RequestMethod.GET, path: "me" },
  { handler: "users", method: RequestMethod.GET, path: "users", permission: "users:read" },
  { handler: "user", method: RequestMethod.GET, path: "users/:id", permission: "users:read" },
  { handler: "setStatus", method: RequestMethod.POST, path: "users/:id/status", permission: "users:write" },
  { handler: "patchStatus", method: RequestMethod.PATCH, path: "users/:id/status", permission: "users:write" },
  { handler: "addNote", method: RequestMethod.POST, path: "users/:id/notes", permission: "users:write" },
  { handler: "reports", method: RequestMethod.GET, path: "reports", permission: "reports:read" },
  { handler: "reportDetail", method: RequestMethod.GET, path: "reports/:id", permission: "reports:read" },
  { handler: "review", method: RequestMethod.POST, path: "reports/:id/review", permission: "moderation:write" },
  { handler: "audit", method: RequestMethod.GET, path: "audit", permission: "audit:read" },
  { handler: "risk", method: RequestMethod.GET, path: "risk", permission: "risk:read" },
  { handler: "connections", method: RequestMethod.GET, path: "connections", permission: "connections:read" },
  { handler: "connectionDetail", method: RequestMethod.GET, path: "connections/:id", permission: "connections:read" },
  { handler: "exchanges", method: RequestMethod.GET, path: "exchanges", permission: "exchanges:read" },
  { handler: "exchangeDetail", method: RequestMethod.GET, path: "exchanges/:id", permission: "exchanges:read" },
  { handler: "blocks", method: RequestMethod.GET, path: "blocks", permission: "blocks:read" },
  {
    handler: "blockDetail",
    method: RequestMethod.GET,
    path: "blocks/:blockerId/:blockedId",
    permission: "blocks:read",
  },
  // Phase O2 — site operations (HTTP access logs). `ops:read`, not `audit:read`:
  // these rows carry raw client IP and User-Agent, so the holder set is narrowed
  // to SUPER_ADMIN and ANALYST.
  {
    handler: "accessLogs",
    method: RequestMethod.GET,
    path: "access-logs",
    permission: "ops:read",
  },
  {
    handler: "accessLogStats",
    method: RequestMethod.GET,
    path: "access-logs/stats",
    permission: "ops:read",
  },
  {
    handler: "accessLog",
    method: RequestMethod.GET,
    path: "access-logs/:id",
    permission: "ops:read",
  },
];

describe("C5 §1 — the admin route table and its gates", () => {
  it("1. every route declares exactly the documented path and HTTP method", () => {
    for (const route of ROUTE_TABLE) {
      const target = AdminController.prototype[route.handler];
      expect({
        handler: route.handler,
        path: Reflect.getMetadata(PATH_METADATA, target),
        method: Reflect.getMetadata(METHOD_METADATA, target),
      }).toEqual({ handler: route.handler, path: route.path, method: route.method });
    }
  });

  it("2. every route declares exactly the documented permission", () => {
    for (const route of ROUTE_TABLE) {
      const declared = Reflect.getMetadata(
        PERMISSION_METADATA_KEY,
        AdminController.prototype[route.handler],
      );
      expect({ handler: route.handler, permission: declared ?? undefined }).toEqual({
        handler: route.handler,
        permission: route.permission,
      });
    }
  });

  it("3. only /admin/me is ungated, and it is a GET of the caller's own identity", () => {
    const ungated = ROUTE_TABLE.filter((r) => r.permission === undefined);
    expect(ungated.map((r) => r.path)).toEqual(["me"]);
    expect(ungated[0]?.method).toBe(RequestMethod.GET);
  });

  it("3b. every ungated route is explicitly @AdminPublic(), and nothing else is (fail-closed)", () => {
    // FIX (audit P006): `PermissionGuard` denies a route that declares neither a
    // permission nor this marker, so the two sets must line up exactly — an
    // extra marker would silently open a route, a missing one would 403 it.
    const declaredPublic = Object.getOwnPropertyNames(AdminController.prototype).filter(
      (handler) => {
        // Indexed once into a typed local: `Reflect.getMetadata`'s `target`
        // parameter is `Object`, and the double cast above yields `unknown`.
        const member = (AdminController.prototype as unknown as Record<string, unknown>)[handler];
        return (
          typeof member === "function" &&
          Reflect.getMetadata(ADMIN_PUBLIC_METADATA_KEY, member as object) === true
        );
      },
    );
    expect([...declaredPublic].sort()).toEqual(
      ROUTE_TABLE.filter((r) => r.permission === undefined)
        .map((r) => r.handler as string)
        .sort(),
    );
  });

  it("4. no route uses a permission outside the real matrix", () => {
    for (const route of ROUTE_TABLE) {
      if (!route.permission) continue;
      expect(PERMISSIONS).toContain(route.permission);
    }
  });

  it("5. C2/C3/C4 stay read-only: their write permissions gate no route", () => {
    const declared = new Set(ROUTE_TABLE.map((r) => r.permission));
    for (const unused of ["connections:write", "exchanges:write", "blocks:write"] as const) {
      expect(declared.has(unused)).toBe(false);
      // The permission still exists — the matrix describes the role model, and
      // the phases simply did not ship a mutation. Both halves matter.
      expect(PERMISSIONS).toContain(unused);
    }
  });

  it("5b. no permission that gates a route is unreachable by every role", () => {
    // A gate nobody can pass is a dead route, and a gate reached only through
    // the wrong role is the P013 defect class (审核工作台 open to the
    // content-moderation role while its one write route demanded a permission
    // that role never had). Checked over the introspected table, so removing or
    // re-pointing a gate fails here.
    for (const route of ROUTE_TABLE) {
      if (!route.permission) continue;
      const holders = ALL_ROLES.filter((role) => hasPermission(role, route.permission as Permission));
      expect({ route: route.path, holders: holders.length > 0 }).toEqual({
        route: route.path,
        holders: true,
      });
    }
  });

  it("5c. the two write permissions that gate routes have no third home", () => {
    // `moderation:write` must be held by exactly the content-facing roles, so
    // that "who can adjudicate" stays a deliberate list rather than an accident
    // of the matrix.
    const moderationWriters = ALL_ROLES.filter((role) => hasPermission(role, "moderation:write"));
    expect(moderationWriters).toEqual(["SUPER_ADMIN", "MODERATOR", "CONTENT_MANAGER"]);
  });

  it("6. there is no Risk mutation route and no risk write permission at all", () => {
    const riskRoutes = ROUTE_TABLE.filter((r) => r.path.startsWith("risk"));
    expect(riskRoutes).toHaveLength(1);
    expect(riskRoutes[0]?.method).toBe(RequestMethod.GET);
    expect(PERMISSIONS).not.toContain("risk:write");
  });

  it("7. no admin route is a DELETE or PUT", () => {
    const mutating = ROUTE_TABLE.filter(
      (r) => r.method === RequestMethod.DELETE || r.method === RequestMethod.PUT,
    );
    expect(mutating).toEqual([]);
  });

  it("8. the two user-status verbs are the same operation on the same gate", () => {
    const post = ROUTE_TABLE.find((r) => r.handler === "setStatus");
    const patch = ROUTE_TABLE.find((r) => r.handler === "patchStatus");
    expect(post?.path).toBe(patch?.path);
    expect(post?.permission).toBe(patch?.permission);
  });
});

// ---------------------------------------------------------------------------
// 2. the role matrix, as whole sets
// ---------------------------------------------------------------------------

/** The exact holder set of every read permission the console navigates by. */
const READER_SETS: Record<string, AdminRole[]> = {
  "dashboard:read": ALL_ROLES,
  "users:read": ALL_ROLES,
  "reports:read": ALL_ROLES,
  "risk:read": ["SUPER_ADMIN", "MODERATOR", "ANALYST"],
  "connections:read": ["SUPER_ADMIN", "ANALYST"],
  "exchanges:read": ["SUPER_ADMIN", "ANALYST"],
  "blocks:read": ["SUPER_ADMIN", "ANALYST"],
  "audit:read": ALL_ROLES,
};

describe("C5 §2 — RBAC consistency across the console", () => {
  it("9. each read permission has exactly its documented holder set", () => {
    for (const [permission, expected] of Object.entries(READER_SETS)) {
      const holders = ALL_ROLES.filter((role) => hasPermission(role, permission as Permission));
      expect({ permission, holders }).toEqual({ permission, holders: expected });
    }
  });

  it("10. MODERATOR gains no advanced read domain from moderation or risk access", () => {
    // The tempting mistake: "moderation deals with abuse, so MODERATOR needs the
    // block list". It has moderation:read and risk:read and neither of the three
    // relationship domains.
    expect(hasPermission("MODERATOR", "moderation:read")).toBe(true);
    expect(hasPermission("MODERATOR", "risk:read")).toBe(true);
    for (const permission of ["connections:read", "exchanges:read", "blocks:read"] as const) {
      expect({ permission, allowed: hasPermission("MODERATOR", permission) }).toEqual({
        permission,
        allowed: false,
      });
    }
  });

  it("11. SUPPORT gains no advanced read domain at all", () => {
    for (const permission of [
      "risk:read",
      "connections:read",
      "exchanges:read",
      "blocks:read",
      "settings:read",
      "admins:read",
    ] as const) {
      expect({ permission, allowed: hasPermission("SUPPORT", permission) }).toEqual({
        permission,
        allowed: false,
      });
    }
  });

  it("12. ANALYST holds every read domain and no write permission anywhere", () => {
    for (const permission of Object.keys(READER_SETS) as Permission[]) {
      expect({ permission, allowed: hasPermission("ANALYST", permission) }).toEqual({
        permission,
        allowed: true,
      });
    }
    const writes = ROLE_PERMISSIONS.ANALYST.filter((p) => p.endsWith(":write"));
    expect(writes).toEqual([]);
  });

  it("13. ANALYST holds every navigation-gating read, and no write anywhere", () => {
    // The eight permissions the console's navigation is filtered by. ANALYST is
    // read-only-everything, so it sees the whole menu.
    for (const permission of Object.keys(READER_SETS) as Permission[]) {
      expect({ permission, allowed: hasPermission("ANALYST", permission) }).toEqual({
        permission,
        allowed: true,
      });
    }
    expect(ROLE_PERMISSIONS.ANALYST.filter((p) => p.endsWith(":write"))).toEqual([]);
  });

  it("13b. ANALYST reads reports without holding moderation:read — the two are different axes", () => {
    // Surprising but deliberate: the moderation workbench is gated on
    // `reports:read` (it reads the same report data), so ANALYST can open it
    // while holding no `moderation:read` at all. `moderation:read` belongs to a
    // standalone moderation domain that does not exist yet.
    expect(hasPermission("ANALYST", "reports:read")).toBe(true);
    expect(hasPermission("ANALYST", "moderation:read")).toBe(false);
    expect(hasPermission("ANALYST", "admins:read")).toBe(false);
    // And the roles that do hold it are exactly the three content-facing ones.
    const moderationHolders = ALL_ROLES.filter((r) => hasPermission(r, "moderation:read"));
    expect(moderationHolders).toEqual(["SUPER_ADMIN", "MODERATOR", "CONTENT_MANAGER"]);
  });

  it("14. SUPER_ADMIN holds the entire matrix", () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(PERMISSIONS);
  });

  it("15. CONTENT_MANAGER is confined to content moderation", () => {
    for (const permission of [
      "risk:read",
      "connections:read",
      "exchanges:read",
      "blocks:read",
      "users:write",
      "reports:write",
    ] as const) {
      expect({ permission, allowed: hasPermission("CONTENT_MANAGER", permission) }).toEqual({
        permission,
        allowed: false,
      });
    }
  });

  it("16. the three relationship domains are exactly the same holder set", () => {
    const sets = (["connections:read", "exchanges:read", "blocks:read"] as const).map((p) =>
      ALL_ROLES.filter((role) => hasPermission(role, p)),
    );
    expect(sets[0]).toEqual(sets[1]);
    expect(sets[1]).toEqual(sets[2]);
  });

  it("17. every read permission is strictly wider than the relationship domains", () => {
    // A sanity check on the *shape* of the matrix: the relationship domains are
    // the narrowest reads, so nothing that reads less may read them.
    const relationship = ["SUPER_ADMIN", "ANALYST"];
    for (const permission of ["reports:read", "users:read", "risk:read"] as const) {
      const holders = ALL_ROLES.filter((role) => hasPermission(role, permission));
      for (const holder of relationship) expect(holders).toContain(holder);
      expect(holders.length).toBeGreaterThanOrEqual(relationship.length);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. GET writes no audit; the write paths keep their actors
// ---------------------------------------------------------------------------

/** Every read method the admin console can reach. */
const READ_METHODS: Array<[string, (service: AdminService) => Promise<unknown>]> = [
  ["dashboard", (s) => s.dashboard()],
  ["me", (s) => s.me(admin("SUPER_ADMIN"))],
  ["searchUsers", (s) => s.searchUsers({})],
  ["userDetail", (s) => s.userDetail(UNKNOWN_ID)],
  ["listReports", (s) => s.listReports({})],
  ["reportDetail", (s) => s.reportDetail(UNKNOWN_ID)],
  ["listAudit", (s) => s.listAudit(1, 20)],
  ["riskOverview", (s) => s.riskOverview()],
  ["listConnections", (s) => s.listConnections({})],
  ["connectionDetail", (s) => s.connectionDetail(UNKNOWN_ID)],
  ["listExchanges", (s) => s.listExchanges({})],
  ["exchangeDetail", (s) => s.exchangeDetail(UNKNOWN_ID)],
  ["listBlocks", (s) => s.listBlocks({})],
  ["blockDetail", (s) => s.blockDetail(UNKNOWN_ID, UNKNOWN_ID)],
];

describe("C5 §3 — audit boundary", () => {
  it("18. not one read method writes an AdminAuditLog row", async () => {
    // Driven one at a time so a failure names the offending method rather than
    // reporting "something in the read surface wrote an audit row".
    for (const [name, run] of READ_METHODS) {
      const { prisma, calls } = makePrisma();
      const service = new AdminService(prisma);
      // Four of these reject with a 404 on the empty fixtures — that is the
      // documented behaviour and irrelevant here; what matters is the absence
      // of a write.
      await run(service).catch(() => undefined);
      expect({ method: name, auditWrites: callsOf(calls, "adminAuditLog", "create").length }).toEqual(
        { method: name, auditWrites: 0 },
      );
    }
  });

  it("19. no read method touches the audit table except to read it", async () => {
    // `findMany` is the feed/history read and `count` is the audit list's total;
    // anything else would be a write or a mutation reaching the audit trail.
    const READ_OPS = ["findMany", "count"];
    for (const [name, run] of READ_METHODS) {
      const { prisma, calls } = makePrisma();
      const service = new AdminService(prisma);
      await run(service).catch(() => undefined);
      const otherOps = calls
        .filter((c) => c.model === "adminAuditLog")
        .map((c) => c.op)
        .filter((op) => !READ_OPS.includes(op));
      expect({ method: name, otherOps }).toEqual({ method: name, otherOps: [] });
    }
  });

  it("20. a status change still attributes to USER with a real adminId", async () => {
    const { prisma, calls } = makePrisma({
      "user.findUnique": () => ({
        id: ALICE_ID,
        status: "ACTIVE",
        bannedAt: null,
        banReason: null,
        suspendedUntil: null,
        adminUser: null,
      }),
    });
    const service = new AdminService(prisma);
    await service
      .setStatus({
        targetUserId: ALICE_ID,
        action: "disable",
        reason: "integration check",
        admin: admin("SUPER_ADMIN"),
      })
      .catch(() => undefined);

    const writes = callsOf(calls, "adminAuditLog", "create");
    expect(writes).toHaveLength(1);
    const data = writes[0]?.args.data as Record<string, unknown>;
    expect(data.actorType).toBe("USER");
    expect(data.adminId).toBe(ADMIN_ID);
    expect(data.action).toBe("ADMIN_USER_DISABLE");
    expect(data.targetType).toBe("USER");
  });

  it("21. a report review still attributes to USER with a real adminId", async () => {
    const { prisma, calls } = makePrisma({
      "report.findUnique": () => ({ id: UNKNOWN_ID, status: "OPEN", reportedUserId: ALICE_ID }),
      "report.update": () => ({ id: UNKNOWN_ID, status: "RESOLVED" }),
    });
    const service = new AdminService(prisma);
    await service.reviewReport(UNKNOWN_ID, "resolved", admin("SUPER_ADMIN"), "handled");

    const data = callsOf(calls, "adminAuditLog", "create")[0]?.args.data as Record<string, unknown>;
    expect(data.actorType).toBe("USER");
    expect(data.adminId).toBe(ADMIN_ID);
    expect(data.targetType).toBe("REPORT");
    expect(data.targetId).toBe(UNKNOWN_ID);
  });

  it("22. the machine path is SYSTEM with no adminId, and cannot borrow one", async () => {
    const { prisma, calls } = makePrisma();
    const service = new AdminService(prisma);
    await service.recordSystemAudit({
      action: "SYSTEM_USER_SUSPENSION_EXPIRED",
      targetType: "USER",
      targetId: ALICE_ID,
    });

    const data = callsOf(calls, "adminAuditLog", "create")[0]?.args.data as Record<string, unknown>;
    expect(data.actorType).toBe("SYSTEM");
    expect(data.adminId).toBeNull();
  });

  it("23. the forbidden actor shapes are rejected before reaching the database", async () => {
    const { prisma, calls } = makePrisma();
    const service = new AdminService(prisma);

    // SYSTEM with a human id: the forgery the DB CHECK exists to prevent.
    await expect(
      service.recordAudit({ actorType: "SYSTEM", adminId: ADMIN_ID, action: "X" }),
    ).rejects.toMatchObject({ status: 400 });
    // USER with no owner: an unattributable human action.
    await expect(
      service.recordAudit({ actorType: "USER", adminId: null, action: "X" }),
    ).rejects.toMatchObject({ status: 400 });

    expect(callsOf(calls, "adminAuditLog", "create")).toEqual([]);
  });

  it("24. a write and its audit row share one transaction", async () => {
    const { prisma, calls } = makePrisma({
      "report.findUnique": () => ({ id: UNKNOWN_ID, status: "OPEN", reportedUserId: ALICE_ID }),
      "report.update": () => ({ id: UNKNOWN_ID, status: "RESOLVED" }),
    });
    const service = new AdminService(prisma);
    await service.reviewReport(UNKNOWN_ID, "resolved", admin("SUPER_ADMIN"), "handled");

    // Both the mutation and the audit write happen through the transaction
    // client; if either left the transaction, the ordering guarantee is gone.
    const updateIndex = calls.findIndex((c) => c.model === "report" && c.op === "update");
    const auditIndex = calls.findIndex((c) => c.model === "adminAuditLog" && c.op === "create");
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(auditIndex).toBeGreaterThan(updateIndex);
  });
});

// ---------------------------------------------------------------------------
// 4. cross-domain counting: two screens, one definition
// ---------------------------------------------------------------------------

describe("C5 §4 — Dashboard ↔ the domain lists", () => {
  it("25. Dashboard.connections counts ACTIVE rows, like every other connection count", async () => {
    const dash = makePrisma();
    await new AdminService(dash.prisma).dashboard();
    const dashWhere = firstWhere(dash.calls, "connection", "count");

    const detail = makePrisma({
      "user.findUnique": () => ({ id: ALICE_ID, birthDate: null, nickname: null, avatarUrl: null }),
    });
    await new AdminService(detail.prisma).userDetail(ALICE_ID);
    const detailWhere = firstWhere(detail.calls, "connection", "count");

    expect(dashWhere).toEqual({ status: "ACTIVE" });
    // The user-detail count is the same definition, narrowed to one person.
    expect(detailWhere.status).toBe(dashWhere.status);
    expect(detailWhere.OR).toEqual([{ userAId: ALICE_ID }, { userBId: ALICE_ID }]);
  });

  it("26. Dashboard.reportsOpen and Risk.openReports are the same query", async () => {
    const dash = makePrisma();
    await new AdminService(dash.prisma).dashboard();
    const dashOpen = callsOf(dash.calls, "report", "count").find(
      (c) => (c.args.where as { status?: string } | undefined)?.status === "OPEN",
    );

    const risk = makePrisma();
    await new AdminService(risk.prisma).riskOverview();
    const riskOpen = callsOf(risk.calls, "report", "count").find(
      (c) => (c.args.where as { status?: string } | undefined)?.status === "OPEN",
    );

    expect(dashOpen?.args.where).toEqual({ status: "OPEN" });
    expect(riskOpen?.args.where).toEqual(dashOpen?.args.where);
  });

  it("27. Dashboard counts administrators from AdminUser.isActive, never User.isAdmin", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).dashboard();

    expect(firstWhere(calls, "adminUser", "count")).toEqual({ isActive: true });
    // `User.isAdmin` is the Phase A compatibility fallback for *identity*, not a
    // population count; counting it would report a different number.
    for (const call of callsOf(calls, "user", "count")) {
      expect(call.args.where ?? {}).not.toHaveProperty("isAdmin");
    }
  });

  it("28. every Dashboard user-state count is a stored status, and they partition", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).dashboard();

    const statuses = callsOf(calls, "user", "count")
      .map((c) => (c.args.where as { status?: string } | undefined)?.status)
      .filter(Boolean);
    expect(statuses.sort()).toEqual(["ACTIVE", "BANNED", "SUSPENDED"]);
    // `users` (the total) is a bare count, so ACTIVE + SUSPENDED + BANNED +
    // DISABLED is the same population. DISABLED is the only one not on the
    // dashboard, which is why the total cannot be derived from the three.
    expect(callsOf(calls, "user", "count").some((c) => Object.keys(c.args.where ?? {}).length === 0)).toBe(
      true,
    );
  });

  it("29. Dashboard messagesToday excludes soft-deleted messages", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).dashboard();
    const where = firstWhere(calls, "message", "count");
    expect(where.deletedAt).toBeNull();
  });

  it("30. every Dashboard feed is capped, so no feed can be a full table dump", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).dashboard();

    const feeds = calls.filter((c) => c.op === "findMany");
    expect(feeds.length).toBeGreaterThanOrEqual(3);
    for (const feed of feeds) {
      expect({ model: feed.model, take: feed.args.take }).toEqual({ model: feed.model, take: 10 });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. cross-domain counting: User Detail ↔ the domain lists
// ---------------------------------------------------------------------------

describe("C5 §5 — User Detail ↔ the domain lists", () => {
  const detailCalls = async () => {
    const harness = makePrisma({
      "user.findUnique": () => ({
        id: ALICE_ID,
        nickname: null,
        avatarUrl: null,
        birthDate: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    });
    await new AdminService(harness.prisma).userDetail(ALICE_ID);
    return harness.calls;
  };

  it("31. reportsReceivedCount is the same filter the reports list uses for that user", async () => {
    const detail = await detailCalls();
    const list = makePrisma();
    await new AdminService(list.prisma).listReports({ reportedUser: ALICE_ID });

    const countWheres = callsOf(detail, "report", "count").map(
      (c) => (c.args.where ?? {}) as Record<string, unknown>,
    );
    const countWhere = countWheres.find((w) => "reportedUserId" in w) as Record<string, unknown>;
    const listWhere = firstWhere(list.calls, "report", "count");

    // Two spellings, one set of rows: the user page counts by the scalar FK, the
    // reports list filters through the relation. `Report.reportedUserId` is
    // required and `reportedUser` is its relation, so `{ reportedUser: { id } }`
    // selects exactly the rows `{ reportedUserId: id }` selects. Pinned as an
    // equivalence so neither spelling can drift into a different meaning — e.g.
    // a relation filter that also matched by nickname.
    expect(listWhere).toEqual({ reportedUser: { id: ALICE_ID } });
    expect(countWhere).toEqual({ reportedUserId: ALICE_ID });
    expect(listWhere.reportedUser).toEqual({ id: countWhere.reportedUserId });
  });

  it("32. reportsMadeCount is the same filter the reports list uses for the reporter", async () => {
    const detail = await detailCalls();
    const list = makePrisma();
    await new AdminService(list.prisma).listReports({ reporter: ALICE_ID });

    // Two report counts live on the user page; pick each by the column it
    // filters on rather than by position, so a reordering cannot make this test
    // compare the wrong pair.
    const countWheres = callsOf(detail, "report", "count").map(
      (c) => (c.args.where ?? {}) as Record<string, unknown>,
    );
    const received = countWheres.find((w) => "reportedUserId" in w);
    const made = countWheres.find((w) => "reporterId" in w);
    const listWhere = firstWhere(list.calls, "report", "count");

    expect(listWhere).toEqual({ reporter: { id: ALICE_ID } });
    expect(made).toEqual({ reporterId: ALICE_ID });
    expect(received).toEqual({ reportedUserId: ALICE_ID });
    expect(listWhere.reporter).toEqual({ id: made?.reporterId });
    // The two counts are different questions about the same person.
    expect(made).not.toEqual(received);
  });

  it("32b. a non-UUID reporter filter is a text search, so the two spellings diverge there", async () => {
    // The equivalence above holds for a UUID only. Any other text searches email
    // and nickname, which is a different question — and exactly the reason the
    // relation filter exists.
    const list = makePrisma();
    await new AdminService(list.prisma).listReports({ reporter: "alice" });
    const where = firstWhere(list.calls, "report", "count");
    expect(where.reporter).toHaveProperty("OR");
    expect(where).not.toHaveProperty("reporterId");
  });

  it("33. blocksMadeCount and blocksReceivedCount match the blocks list's two side filters", async () => {
    const detail = await detailCalls();
    const made = makePrisma();
    await new AdminService(made.prisma).listBlocks({ blocker: ALICE_ID });
    const received = makePrisma();
    await new AdminService(received.prisma).listBlocks({ blocked: ALICE_ID });

    const countWheres = callsOf(detail, "block", "count").map((c) => c.args.where);
    expect(firstWhere(made.calls, "block", "count")).toEqual({ blockerId: ALICE_ID });
    expect(firstWhere(received.calls, "block", "count")).toEqual({ blockedId: ALICE_ID });
    expect(countWheres).toContainEqual({ blockerId: ALICE_ID });
    expect(countWheres).toContainEqual({ blockedId: ALICE_ID });
  });

  it("34. the direction is never swapped: made and received are different filters", async () => {
    const detail = await detailCalls();
    const wheres = callsOf(detail, "block", "count").map(
      (c) => (c.args.where ?? {}) as Record<string, unknown>,
    );
    const made = wheres.find((w) => "blockerId" in w);
    const received = wheres.find((w) => "blockedId" in w);
    expect(made).toEqual({ blockerId: ALICE_ID });
    expect(received).toEqual({ blockedId: ALICE_ID });
    expect(made).not.toEqual(received);
  });

  it("35. connectionCount differs from the connections list by exactly the status filter", async () => {
    const detail = await detailCalls();
    const list = makePrisma();
    await new AdminService(list.prisma).listConnections({ user: ALICE_ID });

    const countWhere = firstWhere(detail, "connection", "count");
    const listWhere = firstWhere(list.calls, "connection", "count");

    // The list is an inspection console and shows REMOVED rows on purpose; the
    // counts mean "currently connected". Pinned as *exactly* this difference so
    // a future "unification" cannot quietly change either number.
    const { status, ...withoutStatus } = countWhere;
    expect(status).toBe("ACTIVE");
    expect(withoutStatus).toEqual(listWhere);
    expect(listWhere).not.toHaveProperty("status");
  });

  it("36. the either-side rule is used by the count and the list alike", async () => {
    const detail = await detailCalls();
    const list = makePrisma();
    await new AdminService(list.prisma).listConnections({ user: ALICE_ID });

    const eitherSide = [{ userAId: ALICE_ID }, { userBId: ALICE_ID }];
    expect(firstWhere(detail, "connection", "count").OR).toEqual(eitherSide);
    expect(firstWhere(list.calls, "connection", "count").OR).toEqual(eitherSide);
  });

  it("37. socialAccountCount counts rows and never reads a handle", async () => {
    const detail = await detailCalls();
    const where = firstWhere(detail, "socialAccount", "count");
    expect(where).toEqual({ userId: ALICE_ID });
    // A count cannot leak a handle; the guarantee is that this is a count.
    expect(callsOf(detail, "socialAccount", "findMany")).toEqual([]);
    expect(callsOf(detail, "socialAccount", "findUnique")).toEqual([]);
  });

  it("38. every aggregate is a count, never the length of a capped list", async () => {
    const detail = await detailCalls();
    // Eight aggregates, all `count`: connection, the two report totals, the two
    // content subsets, the two block sides and social accounts. The recent lists
    // are `take: 10` windows and must not be the source of any of these numbers.
    const counts = callsOf(detail, "connection", "count").length +
      callsOf(detail, "report", "count").length +
      callsOf(detail, "block", "count").length +
      callsOf(detail, "socialAccount", "count").length;
    expect(counts).toBe(8);
    for (const feed of callsOf(detail, "adminAuditLog", "findMany")) {
      expect(feed.args.take).toBe(10);
    }
  });

  // ---------------------------------------------------------------- C-c

  /** The two report counts on the user page that name a single column. */
  const totalsOf = (calls: Call[]) =>
    callsOf(calls, "report", "count")
      .map((c) => (c.args.where ?? {}) as Record<string, unknown>)
      .filter((w) => !("OR" in w));

  /** The two that carry the content arm. */
  const contentsOf = (calls: Call[]) =>
    callsOf(calls, "report", "count")
      .map((c) => (c.args.where ?? {}) as Record<string, unknown>)
      .filter((w) => "OR" in w);

  it("39b. the two report totals still name one column and nothing else", async () => {
    const detail = await detailCalls();
    const totals = totalsOf(detail);

    // The PC-2.5.8b lock, stated as an exact set: `reportsReceivedCount` counts
    // every row naming this user (USER, MESSAGE and MOMENT alike) and not one
    // condition has been added to make the content pair work.
    expect(totals).toHaveLength(2);
    expect(totals).toEqual([{ reportedUserId: ALICE_ID }, { reporterId: ALICE_ID }]);
    for (const where of totals) {
      expect(Object.keys(where)).toHaveLength(1);
    }
  });

  it("39c. the content KPIs are exactly the MOMENT ∪ MESSAGE filters the reports list uses", async () => {
    const detail = await detailCalls();
    const moment = makePrisma();
    await new AdminService(moment.prisma).listReports({ targetType: "MOMENT" });
    const message = makePrisma();
    await new AdminService(message.prisma).listReports({ targetType: "MESSAGE" });
    const user = makePrisma();
    await new AdminService(user.prisma).listReports({ targetType: "USER" });

    const momentArm = (firstWhere(moment.calls, "report", "count").momentId ?? {}) as object;
    const messageWhere = firstWhere(message.calls, "report", "count");
    const userWhere = firstWhere(user.calls, "report", "count");

    const contents = contentsOf(detail);
    expect(contents).toHaveLength(2);

    for (const where of contents) {
      // Two arms, in the frozen priority: MOMENT first, MESSAGE second.
      const [first, second] = where.OR as Array<Record<string, unknown>>;
      expect(first).toEqual({ momentId: momentArm });
      expect(second).toEqual({ momentId: messageWhere.momentId, messageId: messageWhere.messageId });
      // And they partition: a person report, which is what `targetType=USER`
      // selects, satisfies neither arm.
      expect(userWhere).toEqual({ messageId: null, momentId: null });
      // The second arm must pin `momentId: null`. Without it the OR would not be
      // a partition and a row carrying both pointers would be counted twice.
      expect(second.momentId).toBeNull();
    }

    // Direction is preserved: one content KPI is about the reportee, the other
    // about the reporter — never both, never swapped.
    expect(contents.find((w) => "reportedUserId" in w)).toMatchObject({
      reportedUserId: ALICE_ID,
    });
    expect(contents.find((w) => "reporterId" in w)).toMatchObject({ reporterId: ALICE_ID });
  });

  it("39d. the content pair adds no relation filter, so a deleted moment still counts", async () => {
    const detail = await detailCalls();

    // `Report.momentId` has no foreign key. Any `moment: { ... }` predicate here
    // would turn the KPI into a join and silently stop counting reports whose
    // moment has since been removed.
    for (const where of contentsOf(detail)) {
      expect(where).not.toHaveProperty("moment");
      expect(JSON.stringify(where)).not.toContain("deletedAt");
    }
    expect(callsOf(detail, "moment", "count")).toEqual([]);
  });

  it("39e. the risk overview's self-report signal is untouched by the new KPIs", async () => {
    const risk = makePrisma();
    await new AdminService(risk.prisma).riskOverview();

    const riskCounts = callsOf(risk.calls, "report", "count");
    // Six: the unfiltered total, the four statuses, and the column-to-column
    // self-report comparison. The content KPIs live on the user page only, so
    // this list must be exactly what it was before.
    expect(riskCounts).toHaveLength(6);

    const selfReport = riskCounts
      .map((c) => (c.args.where ?? {}) as Record<string, unknown>)
      .find((w) => "reporterId" in w);
    expect(selfReport).toBeDefined();
    // Still a column reference, and still the only condition on it — the signal
    // is defined as `reporterId == reportedUserId`, not as anything target-aware.
    expect(Object.keys(selfReport as object)).toEqual(["reporterId"]);
    expect((selfReport as { reporterId: { equals: unknown } }).reporterId).toHaveProperty("equals");
  });
});

// ---------------------------------------------------------------------------
// 6. one error vocabulary
// ---------------------------------------------------------------------------

describe("C5 §6 — the shared error contract", () => {
  it("39. every detail route answers its own NOT_FOUND code for an unknown id", async () => {
    const expected: Array<[string, () => Promise<unknown>, string]> = [
      ["users", () => new AdminService(makePrisma().prisma).userDetail(UNKNOWN_ID), "USER_NOT_FOUND"],
      ["reports", () => new AdminService(makePrisma().prisma).reportDetail(UNKNOWN_ID), "REPORT_NOT_FOUND"],
      [
        "connections",
        () => new AdminService(makePrisma().prisma).connectionDetail(UNKNOWN_ID),
        "CONNECTION_NOT_FOUND",
      ],
      ["exchanges", () => new AdminService(makePrisma().prisma).exchangeDetail(UNKNOWN_ID), "EXCHANGE_NOT_FOUND"],
      [
        "blocks",
        () => new AdminService(makePrisma().prisma).blockDetail(UNKNOWN_ID, UNKNOWN_ID),
        "BLOCK_NOT_FOUND",
      ],
    ];

    for (const [name, run, code] of expected) {
      const failure = thrownBy(await capture(run));
      expect({ name, ...failure }).toEqual({ name, status: 404, code, details: undefined });
    }
  });

  it("40. the UUID pipe answers the project envelope and names the offending parameter", () => {
    // This is the defect C5 found and fixed. Prisma answers a non-UUID with
    // P2023, which is not an HttpException, so it surfaced as a 500
    // INTERNAL_ERROR on all nine id-addressed entry points. Observed against the
    // real API before the fix; the per-domain specs could not see it because
    // their mocked Prisma never parses a UUID.
    const pipe = new UuidParamPipe();

    const failure = thrownBy(
      (() => {
        try {
          pipe.transform(NOT_A_UUID, { type: "param", data: "blockerId" } as never);
          return new Error("expected a rejection");
        } catch (error) {
          return error;
        }
      })(),
    );
    expect(failure).toEqual({
      status: 400,
      code: "VALIDATION_ERROR",
      details: { blockerId: ["blockerId must be a UUID"] },
    });

    // The key is the parameter the client actually sent, not a fixed `id`.
    const asId = thrownBy(
      (() => {
        try {
          pipe.transform("abc", { type: "param", data: "id" } as never);
          return new Error("expected a rejection");
        } catch (error) {
          return error;
        }
      })(),
    );
    expect(Object.keys(asId.details as Record<string, unknown>)).toEqual(["id"]);
  });

  it("40b. the pipe passes a well-formed UUID through untouched", () => {
    const pipe = new UuidParamPipe();
    // Uppercase, and the nil UUID, are both valid — the check is on shape only,
    // so it must not narrow what the database accepts.
    for (const value of [UNKNOWN_ID, ALICE_ID, ALICE_ID.toUpperCase()]) {
      expect(pipe.transform(value, { type: "param", data: "id" } as never)).toBe(value);
    }
  });

  it("40c. every id @Param in the controller is guarded by the pipe", () => {
    // The pipe only helps where it is attached. This is the assertion that keeps
    // a future route from being added without it — the same class of omission
    // that produced the 500s in the first place.
    const source = readSource("admin.controller.ts");
    const params = [...source.matchAll(/@Param\("([^"]+)"(,\s*([^)]+))?\)/g)];
    expect(params.length).toBeGreaterThanOrEqual(10);
    for (const [raw, name, , pipes] of params) {
      expect({ raw, name, guarded: (pipes ?? "").includes("UuidParamPipe") }).toEqual({
        raw,
        name,
        guarded: true,
      });
    }
    // And the route table's own id parameters are all covered by that set.
    const idParams = ROUTE_TABLE.flatMap((r) =>
      [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string),
    );
    expect([...new Set(idParams)].sort()).toEqual(
      [...new Set(params.map((m) => m[1] as string))].sort(),
    );
  });

  it("41. the malformed-id guard is a wire concern, so the service keeps its rule order", async () => {
    // Deliberately NOT a service-level check: `setStatus` must still answer
    // REASON_REQUIRED for a missing reason, whatever the id looks like. Moving
    // the UUID check into the service would silently renumber these codes.
    const missingReason = thrownBy(
      await capture(() =>
        new AdminService(makePrisma().prisma).setStatus({
          targetUserId: NOT_A_UUID,
          action: "disable",
          admin: admin("SUPER_ADMIN"),
        }),
      ),
    );
    expect(missingReason).toMatchObject({ status: 400, code: "REASON_REQUIRED" });

    const missingReportReason = thrownBy(
      await capture(() =>
        new AdminService(makePrisma().prisma).reviewReport(
          NOT_A_UUID,
          "resolved",
          admin("SUPER_ADMIN"),
          undefined,
        ),
      ),
    );
    expect(missingReportReason).toMatchObject({ status: 400, code: "REASON_REQUIRED" });
  });

  it("41b. the pipe's UUID shape is character-identical to the service's", () => {
    // Two literals, one rule. If they drift, a value the pipe accepts could
    // still reach Prisma and 500 — the exact failure this phase fixed.
    //
    // FIX (post-audit): this reads the pipe in its SHARED home
    // (`common/uuid-param.pipe.ts`), which is where the implementation moved so
    // the member API could use it too. It previously read the admin module's own
    // copy; once that became a re-export shim, keeping the assertion pointed at
    // the shim would have compared `admin.service.ts` against a MIRROR of the
    // regex rather than the live literal — so an edit to the real pipe alone
    // would no longer have been caught. Pointing at the implementation keeps the
    // original guarantee.
    const pipeSource = readSource("..", "common", "uuid-param.pipe.ts");
    const serviceSource = readSource("admin.service.ts");
    const extract = (source: string) => {
      const match = source.match(/const UUID_RE = (\/.*\/i);/);
      expect(match).not.toBeNull();
      return match?.[1];
    };
    expect(extract(pipeSource)).toBe(extract(serviceSource));
  });

  it("42. an unknown sort is the same 400 envelope on all four sortable lists", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["users", () => new AdminService(makePrisma().prisma).searchUsers({ sort: "bogus" })],
      ["connections", () => new AdminService(makePrisma().prisma).listConnections({ sort: "bogus" })],
      ["exchanges", () => new AdminService(makePrisma().prisma).listExchanges({ sort: "bogus" })],
      ["blocks", () => new AdminService(makePrisma().prisma).listBlocks({ sort: "bogus" })],
    ];

    for (const [name, run] of cases) {
      const failure = thrownBy(await capture(run));
      expect({ name, status: failure.status, code: failure.code }).toEqual({
        name,
        status: 400,
        code: "VALIDATION_ERROR",
      });
      expect(Object.keys(failure.details as Record<string, unknown>)).toEqual(["sort"]);
    }
  });

  it("43. an impossible calendar date is the same 400 envelope on all five lists", async () => {
    // `new Date("2026-02-30")` silently rolls over to 2 March, so this is a
    // calendar check, not a shape check.
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["users", () => new AdminService(makePrisma().prisma).searchUsers({ createdFrom: "2026-02-30" })],
      ["reports", () => new AdminService(makePrisma().prisma).listReports({ createdTo: "2026-02-30" })],
      [
        "connections",
        () => new AdminService(makePrisma().prisma).listConnections({ createdFrom: "2026-02-30" }),
      ],
      ["exchanges", () => new AdminService(makePrisma().prisma).listExchanges({ createdTo: "2026-02-30" })],
      ["blocks", () => new AdminService(makePrisma().prisma).listBlocks({ createdFrom: "2026-02-30" })],
    ];

    for (const [name, run] of cases) {
      const failure = thrownBy(await capture(run));
      expect({ name, status: failure.status, code: failure.code }).toEqual({
        name,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
  });

  it("44. a non-ISO date string is rejected rather than parsed by the runtime", async () => {
    const failure = thrownBy(
      await capture(() => new AdminService(makePrisma().prisma).searchUsers({ createdFrom: "09/17/2026" })),
    );
    expect(failure).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
  });

  it("45. an unknown status filter is ignored, not rejected — the documented split", async () => {
    // Dates and sort reject; status ignores. Both are contracts, and the
    // difference is deliberate (B2 §六 / §八 / §九).
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).searchUsers({ status: "NOT_A_STATUS" });
    expect(firstWhere(calls, "user", "count")).not.toHaveProperty("status");

    const conn = makePrisma();
    await new AdminService(conn.prisma).listConnections({ status: "NOT_A_STATUS" });
    expect(firstWhere(conn.calls, "connection", "count")).not.toHaveProperty("status");

    const exch = makePrisma();
    await new AdminService(exch.prisma).listExchanges({ status: "NOT_A_STATUS" });
    expect(firstWhere(exch.calls, "exchangeRequest", "count")).not.toHaveProperty("status");
  });

  it("46. a non-UUID filter value is a nickname search, not an error", async () => {
    // The guard added in §40 applies to path parameters only. In a list filter a
    // non-UUID is meaningful input, and rejecting it would break the contract.
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).listConnections({ user: "alice" });
    const where = firstWhere(calls, "connection", "count");
    expect(where.OR).toBeDefined();
    expect(JSON.stringify(where)).not.toContain("id: \"alice\"");
  });
});

// ---------------------------------------------------------------------------
// 7. pagination, dates and sorting: one contract, five screens
// ---------------------------------------------------------------------------

describe("C5 §7 — list contract consistency", () => {
  /** Every list endpoint, addressed through its real service method. */
  const LISTS: Array<[string, (service: AdminService, query: Record<string, unknown>) => Promise<unknown>]> = [
    ["users", (s, q) => s.searchUsers(q)],
    ["reports", (s, q) => s.listReports(q)],
    ["connections", (s, q) => s.listConnections(q)],
    ["exchanges", (s, q) => s.listExchanges(q)],
    ["blocks", (s, q) => s.listBlocks(q)],
  ];

  /** The Prisma model each list counts and pages over. */
  const MODEL: Record<string, string> = {
    users: "user",
    reports: "report",
    connections: "connection",
    exchanges: "exchangeRequest",
    blocks: "block",
  };

  /** Runs one list and returns its envelope plus the calls it made. */
  async function runList(name: string, query: Record<string, unknown> = {}, overrides: Overrides = {}) {
    const entry = LISTS.find(([n]) => n === name);
    if (!entry) throw new Error(`unknown list: ${name}`);
    const harness = makePrisma(overrides);
    const result = (await entry[1](new AdminService(harness.prisma), query)) as Record<string, unknown>;
    return { ...harness, result };
  }

  it("47. all five lists clamp page and pageSize identically", async () => {
    for (const [name] of LISTS) {
      const { result } = await runList(name);
      expect({ name, page: result.page, pageSize: result.pageSize }).toEqual({
        name,
        page: 1,
        pageSize: 20,
      });
    }
  });

  it("48. pageSize 5000 clamps to 100 on all five, never to 1000", async () => {
    for (const [name] of LISTS) {
      const { result } = await runList(name, { pageSize: 5000 });
      expect({ name, pageSize: result.pageSize }).toEqual({ name, pageSize: 100 });
    }
  });

  it("49. an out-of-range page is 200 with no items, keeping page and total", async () => {
    // `page` stays the value the caller sent — the endpoint never silently
    // jumps to the last page, which would make the answer look like the
    // question.
    const tenRows: Overrides = {};
    for (const model of Object.values(MODEL)) tenRows[`${model}.count`] = () => 10;

    for (const [name] of LISTS) {
      const { result } = await runList(name, { page: 999 }, tenRows);
      expect({ name, ...result }).toMatchObject({
        name,
        items: [],
        total: 10,
        page: 999,
        totalPages: 1,
      });
    }
  });

  it("50. totalPages is the plain ceiling, so zero rows is zero pages", async () => {
    for (const [name] of LISTS) {
      const { result } = await runList(name);
      expect({ name, total: result.total, totalPages: result.totalPages }).toEqual({
        name,
        total: 0,
        totalPages: 0,
      });
    }
  });

  it("51. count and findMany receive the same where, so a total cannot disagree with its page", async () => {
    const queries: Array<[string, Record<string, unknown>]> = [
      ["users", { search: "a", status: "ACTIVE" }],
      ["reports", { status: "OPEN" }],
      ["connections", { status: "ACTIVE" }],
      ["exchanges", { status: "PENDING" }],
      ["blocks", { user: UNKNOWN_ID }],
    ];

    for (const [name, query] of queries) {
      const { calls } = await runList(name, query);
      const model = MODEL[name] as string;
      const countWhere = firstWhere(calls, model, "count");
      const listWhere = firstWhere(calls, model, "findMany");
      expect({ name, same: JSON.stringify(countWhere) === JSON.stringify(listWhere) }).toEqual({
        name,
        same: true,
      });
      // Filters are pushed into the database, never applied to a page in JS.
      expect({ name, skip: callsOf(calls, model, "findMany")[0]?.args.skip }).toEqual({ name, skip: 0 });
      expect({ name, take: callsOf(calls, model, "findMany")[0]?.args.take }).toEqual({ name, take: 20 });
    }
  });

  it("52. the audit list keeps its own documented envelope — no totalPages", async () => {
    // Pre-existing and deliberate: the audit screen computes the page count
    // itself. Pinned so that "unifying" it is a decision, not a refactor
    // side-effect, and so the frontend contract cannot drift from the backend.
    const { prisma } = makePrisma();
    const result = (await new AdminService(prisma).listAudit(2, 20)) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(["items", "page", "pageSize", "total"]);
    expect(result.page).toBe(2);
  });

  it("53. createdTo is an inclusive upper bound on every list that accepts it", async () => {
    const queries: Array<[string, Record<string, unknown>]> = [
      ["users", { createdTo: "2026-03-01" }],
      ["reports", { createdTo: "2026-03-01" }],
      ["connections", { createdTo: "2026-03-01" }],
      ["exchanges", { createdTo: "2026-03-01" }],
      ["blocks", { createdTo: "2026-03-01" }],
    ];

    for (const [name, query] of queries) {
      const { calls } = await runList(name, query);
      const where = firstWhere(calls, MODEL[name] as string, "count");
      const bound = (where.createdAt as { lte?: Date } | undefined)?.lte;
      expect({ name, isDate: bound instanceof Date }).toEqual({ name, isDate: true });
      // `lte`, never `lt` — a `createdTo` of 2026-03-01 must include that day.
      expect({ name, ops: Object.keys(where.createdAt as object) }).toEqual({ name, ops: ["lte"] });
    }
  });

  it("54. createdFrom is an inclusive lower bound on every list that accepts it", async () => {
    const queries: Array<[string, Record<string, unknown>]> = [
      ["users", { createdFrom: "2026-03-01" }],
      ["reports", { createdFrom: "2026-03-01" }],
      ["connections", { createdFrom: "2026-03-01" }],
      ["exchanges", { createdFrom: "2026-03-01" }],
      ["blocks", { createdFrom: "2026-03-01" }],
    ];

    for (const [name, query] of queries) {
      const { calls } = await runList(name, query);
      const where = firstWhere(calls, MODEL[name] as string, "count");
      expect({ name, ops: Object.keys(where.createdAt as object) }).toEqual({ name, ops: ["gte"] });
    }
  });

  it("55. both bounds together are one createdAt range on every list", async () => {
    const queries: Array<[string, Record<string, unknown>]> = [
      ["users", { createdFrom: "2026-03-01", createdTo: "2026-03-31" }],
      ["reports", { createdFrom: "2026-03-01", createdTo: "2026-03-31" }],
      ["connections", { createdFrom: "2026-03-01", createdTo: "2026-03-31" }],
      ["exchanges", { createdFrom: "2026-03-01", createdTo: "2026-03-31" }],
      ["blocks", { createdFrom: "2026-03-01", createdTo: "2026-03-31" }],
    ];

    for (const [name, query] of queries) {
      const { calls } = await runList(name, query);
      const where = firstWhere(calls, MODEL[name] as string, "count");
      const range = where.createdAt as { gte?: Date; lte?: Date };
      // One range object, not two competing filters — otherwise one bound would
      // silently overwrite the other.
      expect({ name, ops: Object.keys(range).sort() }).toEqual({ name, ops: ["gte", "lte"] });
      expect(range.gte?.getTime()).toBeLessThan(range.lte?.getTime() ?? 0);
    }
  });

  it("56. an unknown sort is rejected on all four sortable lists, never defaulted", async () => {
    // A silent fallback would answer `sort=userA_nickname` with createdAt_desc
    // and look like it worked. `reports` has no `sort` parameter at all, which
    // is itself the contract.
    for (const [name] of LISTS.filter(([n]) => n !== "reports")) {
      const failure = thrownBy(await capture(() => runList(name, { sort: "bogus" })));
      expect({ name, status: failure.status, code: failure.code }).toEqual({
        name,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
  });

  it("57. reports exposes no sort parameter, and adding one would be a new contract", async () => {
    const { calls } = await runList("reports", { sort: "bogus" });
    // Unknown query parameters are ignored rather than rejected; the point here
    // is that `sort` cannot influence the order of the reports queue.
    const orderBy = callsOf(calls, "report", "findMany")[0]?.args.orderBy;
    expect(orderBy).toEqual({ createdAt: "desc" });
  });
});

// ---------------------------------------------------------------------------
// 8. privacy across every domain
// ---------------------------------------------------------------------------

describe("C5 §8 — privacy boundary", () => {
  it("56. no list response carries a forbidden field at any depth", async () => {
    const lists: Array<[string, (s: AdminService) => Promise<unknown>]> = [
      ["dashboard", (s) => s.dashboard()],
      ["risk", (s) => s.riskOverview()],
      ["users", (s) => s.searchUsers({})],
      ["reports", (s) => s.listReports({})],
      ["connections", (s) => s.listConnections({})],
      ["exchanges", (s) => s.listExchanges({})],
      ["blocks", (s) => s.listBlocks({})],
      ["audit", (s) => s.listAudit(1, 20)],
      ["me", (s) => s.me(admin("SUPER_ADMIN"))],
    ];

    for (const [name, run] of lists) {
      const { prisma } = makePrisma({
        "user.findUnique": () => ({
          id: ADMIN_ID,
          email: "a@b.test",
          nickname: null,
          avatarUrl: null,
          status: "ACTIVE",
          isAdmin: true,
          createdAt: new Date(),
          lastActiveAt: null,
        }),
      });
      const result = await run(new AdminService(prisma));
      expectNoSecrets(result, name);
    }
  });

  it("57. no detail response carries a forbidden field at any depth", async () => {
    const details: Array<[string, (s: AdminService) => Promise<unknown>]> = [
      [
        "userDetail",
        (s) =>
          s.userDetail(ALICE_ID),
      ],
      ["reportDetail", (s) => s.reportDetail(UNKNOWN_ID)],
      ["connectionDetail", (s) => s.connectionDetail(UNKNOWN_ID)],
      ["exchangeDetail", (s) => s.exchangeDetail(UNKNOWN_ID)],
      ["blockDetail", (s) => s.blockDetail(UNKNOWN_ID, UNKNOWN_ID)],
    ];

    for (const [name, run] of details) {
      const { prisma } = makePrisma({
        // Fixtures are deliberately *wide*: every scalar the row has, including
        // the sensitive ones. A `select` is what keeps them out of the response.
        "user.findUnique": () => ({
          id: ALICE_ID,
          email: "alice@example.test",
          nickname: null,
          avatarUrl: null,
          status: "ACTIVE",
          isAdmin: false,
          bannedAt: null,
          banReason: null,
          suspendedUntil: null,
          createdAt: new Date(),
          lastActiveAt: null,
          birthDate: null,
          passwordHash: "$2b$10$must-not-leak",
          reportsReceived: [],
          reportsMade: [],
          adminNotes: [],
        }),
        "report.findUnique": () => ({
          id: UNKNOWN_ID,
          reason: "HARASSMENT",
          status: "OPEN",
          messageId: null,
          createdAt: new Date(),
          reporter: { id: ALICE_ID, nickname: null },
          reportedUser: { id: BOB_ID, nickname: null },
          passwordHash: "$2b$10$must-not-leak",
        }),
        "connection.findUnique": () => ({
          id: UNKNOWN_ID,
          status: "ACTIVE",
          createdAt: new Date(),
          conversationId: null,
          userA: { id: ALICE_ID, nickname: null },
          userB: { id: BOB_ID, nickname: null },
        }),
        "exchangeRequest.findUnique": () => ({
          id: UNKNOWN_ID,
          connectionId: null,
          conversationId: UNKNOWN_ID,
          platforms: [],
          message: null,
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
          requester: { id: ALICE_ID, nickname: null },
          receiver: { id: BOB_ID, nickname: null },
          passwordHash: "$2b$10$must-not-leak",
        }),
        "block.findUnique": () => ({
          blockerId: ALICE_ID,
          blockedId: BOB_ID,
          createdAt: new Date(),
          blocker: { id: ALICE_ID, nickname: null },
          blocked: { id: BOB_ID, nickname: null },
          socialAccounts: [{ id: "sa", handle: "PW_INT_SECRET_HANDLE" }],
        }),
      });

      // The four list-shaped details reject on empty history; a rejection is a
      // documented 404 path and is not what this test is about.
      const result = await run(new AdminService(prisma)).catch(() => undefined);
      if (result !== undefined) expectNoSecrets(result, name);
    }
  });

  it("58. the admin service reads SocialAccount only to count it", async () => {
    const source = readSource("admin.service.ts");
    // Every mention of `socialAccount` as a *delegate call* must be a count.
    const calls = source.match(/\.socialAccount\.[a-zA-Z]+\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toBe(".socialAccount.count(");
    }
    // And no select anywhere names the handle column.
    expect(source).not.toMatch(/handle:\s*true/);
  });

  it("59. the admin service contains no include, so no relation rides along", async () => {
    const source = readSource("admin.service.ts");
    expect(source).not.toMatch(/\binclude:/);
  });

  it("60. the audit screen is the only place ip and userAgent are selected", async () => {
    const source = readSource("admin.service.ts");
    // `listAudit` returns whole audit rows by design — that screen exists to
    // show where an action came from. Every *other* audit select is a named
    // constant that omits them.
    const namedSelects = source.match(/export const [A-Z_]*HISTORY_SELECT[\s\S]*?\} as const/g) ?? [];
    expect(namedSelects.length).toBeGreaterThanOrEqual(4);
    for (const select of namedSelects) {
      expect(select).not.toMatch(/\bip:\s*true/);
      expect(select).not.toMatch(/userAgent:\s*true/);
    }
  });

  it("61. the dashboard never returns a User object tree", async () => {
    const { prisma } = makePrisma({
      "report.findMany": () => [
        {
          id: UNKNOWN_ID,
          reason: "HARASSMENT",
          status: "RESOLVED",
          messageId: null,
          createdAt: new Date(),
          reporter: { id: ALICE_ID, nickname: null, email: "a@b.test", passwordHash: "x" },
          reportedUser: { id: BOB_ID, nickname: null, email: "c@d.test", passwordHash: "x" },
        },
      ],
    });
    const result = (await new AdminService(prisma).dashboard()) as {
      recentResolvedReports: Array<Record<string, unknown>>;
    };
    expect(result.recentResolvedReports).toHaveLength(1);
    const paths = keyPaths(result.recentResolvedReports);
    // Identity only — no relation beyond the two named parties, and no column
    // of theirs other than the three the console renders.
    for (const party of ["reporter", "reportedUser"]) {
      const fields = paths
        .filter((p) => p.includes(`.${party}.`))
        .map((p) => p.split(`.${party}.`)[1]);
      expect([...new Set(fields)].sort()).toEqual(["email", "id", "nickname"]);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. direction, and the domains that must not bleed
// ---------------------------------------------------------------------------

describe("C5 §9 — directional integrity and cross-domain isolation", () => {
  it("62. Exchanges keeps requester and receiver apart", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).listExchanges({ user: ALICE_ID });
    const where = firstWhere(calls, "exchangeRequest", "count");
    expect(where.OR).toEqual([{ requesterId: ALICE_ID }, { receiverId: ALICE_ID }]);
    // No normalisation: the two sides stay two distinct columns.
    expect(where).not.toHaveProperty("requesterId");
    expect(where).not.toHaveProperty("receiverId");
  });

  it("63. Blocks keeps blocker and blocked apart", async () => {
    const blocker = makePrisma();
    await new AdminService(blocker.prisma).listBlocks({ blocker: ALICE_ID });
    const blocked = makePrisma();
    await new AdminService(blocked.prisma).listBlocks({ blocked: ALICE_ID });

    expect(firstWhere(blocker.calls, "block", "count")).toEqual({ blockerId: ALICE_ID });
    expect(firstWhere(blocked.calls, "block", "count")).toEqual({ blockedId: ALICE_ID });
    // The two filters answer different questions; an implementation that sorted
    // the pair would make them identical.
    expect(firstWhere(blocker.calls, "block", "count")).not.toEqual(
      firstWhere(blocked.calls, "block", "count"),
    );
  });

  it("64. a connection detail never reads a Message or an ExchangeRequest", async () => {
    const { prisma, calls } = makePrisma({
      "connection.findUnique": () => ({
        id: UNKNOWN_ID,
        status: "ACTIVE",
        createdAt: new Date(),
        conversationId: UNKNOWN_ID,
        userA: { id: ALICE_ID, nickname: null },
        userB: { id: BOB_ID, nickname: null },
      }),
    });
    await new AdminService(prisma).connectionDetail(UNKNOWN_ID);
    // A connection is a relationship record, not a window into the chat or the
    // contact exchange that may sit behind it.
    expect(callsOf(calls, "message", "findMany")).toEqual([]);
    expect(callsOf(calls, "exchangeRequest", "findMany")).toEqual([]);
    expect(callsOf(calls, "exchangeRequest", "findUnique")).toEqual([]);
  });

  it("65. an exchange detail reads the connection as data, never as a relation tree", async () => {
    const { prisma, calls } = makePrisma({
      "exchangeRequest.findUnique": () => ({
        id: UNKNOWN_ID,
        connectionId: null,
        conversationId: UNKNOWN_ID,
        platforms: [],
        message: null,
        status: "PENDING",
        createdAt: new Date(),
        updatedAt: new Date(),
        requester: { id: ALICE_ID, nickname: null },
        receiver: { id: BOB_ID, nickname: null },
      }),
    });
    await new AdminService(prisma).exchangeDetail(UNKNOWN_ID);
    // The exchange's own conversation is never opened: no message is read.
    expect(callsOf(calls, "message", "findMany")).toEqual([]);
    expect(callsOf(calls, "message", "findUnique")).toEqual([]);
  });

  it("66. no admin read path touches SafetyService's tables beyond the documented counts", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).riskOverview();
    // Risk is an overview of Reports, User statuses and audit rows. It must not
    // reach into social accounts or blocks to invent a severity signal.
    expect(callsOf(calls, "socialAccount", "findMany")).toEqual([]);
    expect(callsOf(calls, "block", "findMany")).toEqual([]);
    expect(callsOf(calls, "sharedSocialAccount", "findMany")).toEqual([]);
  });

  it("67. Risk exposes no severity vocabulary", async () => {
    const { prisma } = makePrisma();
    const result = (await new AdminService(prisma).riskOverview()) as Record<string, unknown>;
    const paths = keyPaths(result).map((p) => p.toLowerCase());
    for (const banned of ["score", "risklevel", "risktier", "severity", "riskrating"]) {
      expect({ banned, hits: paths.filter((p) => p.includes(banned)) }).toEqual({ banned, hits: [] });
    }
  });

  it("68. Risk's action feed is scoped to the real action vocabulary", async () => {
    const { prisma, calls } = makePrisma();
    await new AdminService(prisma).riskOverview();
    const feed = callsOf(calls, "adminAuditLog", "findMany").find((c) =>
      JSON.stringify(c.args.where ?? {}).includes("action"),
    );
    const actions = ((feed?.args.where as { action?: { in?: string[] } } | undefined)?.action?.in ??
      []) as string[];

    // A closed list, not a prefix: the feed shows user state changes, report
    // outcomes and the suspension sweep. Notes are not risk events, and "every
    // audit row" would make the feed a second audit screen.
    expect([...actions].sort()).toEqual(
      [
        "ADMIN_USER_ACTIVATE",
        "ADMIN_USER_BAN",
        "ADMIN_USER_DISABLE",
        "ADMIN_USER_SUSPEND",
        "ADMIN_USER_UNBAN",
        "REPORT_REJECTED",
        "REPORT_RESOLVED",
        "REPORT_REVIEWING",
        "SYSTEM_USER_SUSPENSION_EXPIRED",
      ].sort(),
    );
    expect(actions).not.toContain("ADMIN_USER_NOTE");
    expect(actions).not.toContain("ADMIN_USER_STATUS");
  });
});

// ---------------------------------------------------------------------------
// 10. the frontend mirror, and the nav/route join
// ---------------------------------------------------------------------------

describe("C5 §10 — the console's mirror of the matrix", () => {
  const FRONTEND_MATRIX = "../../../admin/src/lib/permissions.ts";
  const readFrontend = () => readSource(FRONTEND_MATRIX);

  it("69. the frontend permission vocabulary is exactly the backend's — no more, no less", () => {
    const source = readFrontend();
    const declared = new Set(
      [...source.matchAll(/"([a-z]+:[a-z]+)"/g)].map((match) => match[1] as string),
    );
    // Every backend permission is mirrored…
    for (const permission of PERMISSIONS) {
      expect({ permission, present: declared.has(permission) }).toEqual({
        permission,
        present: true,
      });
    }
    // …and the mirror invents none. An extra string here is a permission the
    // server would refuse, which is how a nav link appears that always 403s.
    const invented = [...declared].filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    expect(invented).toEqual([]);
    expect(declared.size).toBe(PERMISSIONS.length);
  });

  it("70. the frontend role matrix grants each role exactly what the backend does", () => {
    const source = readFrontend();
    for (const role of ALL_ROLES) {
      const mirrored = rolePermissionsInSource(source, role);
      const server = [...ROLE_PERMISSIONS[role]];
      // Whole-set equality in both directions: a missing entry hides a link the
      // admin may use, an extra entry shows one the API will refuse.
      expect({ role, missing: server.filter((p) => !mirrored.has(p)) }).toEqual({
        role,
        missing: [],
      });
      expect({ role, extra: [...mirrored].filter((p) => !server.includes(p as Permission)) }).toEqual({
        role,
        extra: [],
      });
    }
  });

  it("71. the frontend status-action matrix matches the backend's", () => {
    const source = readFrontend();
    const block = source.slice(source.indexOf("export const ROLE_ALLOWED_STATUS_ACTIONS"));
    for (const role of ALL_ROLES) {
      const from = block.indexOf(`${role}:`);
      expect({ role, found: from > -1 }).toEqual({ role, found: true });
      const line = block.slice(from, block.indexOf("]", from) + 1);
      const actions = [...line.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
      expect({ role, actions: [...actions].sort() }).toEqual({
        role,
        actions: [...ROLE_ALLOWED_STATUS_ACTIONS[role]].sort(),
      });
    }
  });
});

/** The permissions one role is granted by the console's mirror. */
function rolePermissionsInSource(source: string, role: AdminRole): Set<string> {
  const block = roleBlock(source, role);
  // The mirror may express a full grant by referencing the shared `ALL`
  // constant instead of listing every permission again.
  if (/\bALL\b/.test(block)) return new Set(PERMISSIONS as readonly string[]);
  return new Set([...block.matchAll(/"([a-z]+:[a-z]+)"/g)].map((match) => match[1] as string));
}

/**
 * The source text of one role's entry in the frontend matrix.
 *
 * Reads from `ROLE_PERMISSIONS` onwards so the `ALL` constant at the top of the
 * file cannot be mistaken for a role's own list.
 */
function roleBlock(source: string, role: AdminRole): string {
  const start = source.indexOf("export const ROLE_PERMISSIONS");
  const from = source.indexOf(`${role}:`, start);
  expect(from).toBeGreaterThan(-1);
  const next = source
    .slice(from + role.length)
    .search(/\n\s{2}[A-Z_]+:/);
  return next === -1 ? source.slice(from) : source.slice(from, from + role.length + next);
}
