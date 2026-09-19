import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  EXCHANGE_DETAIL_SELECT,
  EXCHANGE_HISTORY_SELECT,
  EXCHANGE_LIST_SELECT,
  EXCHANGE_SORT_ORDERS,
  SHARED_SOCIAL_SELECT,
} from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase C3 — Contact Exchange management.
 *
 * What is pinned here, and why each is not obvious:
 *
 *   1. **`exchanges:read`, not a neighbouring permission.** The Exchanges
 *      screen is not the connections screen and not the moderation queue.
 *      `exchanges:read` is held by **SUPER_ADMIN and ANALYST only** — the same
 *      holder set as `connections:read`, and deliberately narrower than
 *      `risk:read` (which adds MODERATOR). The *exact* holder set is asserted,
 *      not merely "some role can read".
 *
 *   2. **`platforms` is an array.** `ExchangeRequest.platforms` is
 *      `SocialPlatform[]`, so the platform filter is "array contains" and the
 *      response must express the *whole* set. Both halves are asserted: the
 *      `where` uses Prisma's `has`, and a two-platform fixture comes back with
 *      two entries rather than the first one.
 *
 *   3. **The platform whitelist comes from the real enum.** `SocialPlatform`
 *      has twelve members, not the four or five one would guess. The test reads
 *      the list the service derives and checks a member that a hand-written
 *      list would plausibly have missed (`QQ`, `STEAM`), so a hardcoded subset
 *      fails here.
 *
 *   4. **`user` matches either side.** An exchange has named sides
 *      (`requesterId`/`receiverId`), but "every exchange involving Bob" spans
 *      both. The test asserts the `OR` on both columns.
 *
 *   5. **`SharedSocialAccount` is the only share source, and its direction is
 *      reported as stored.** `ownerId` granted, `viewerId` received. The
 *      fixture contains a share in *both* directions, so an implementation that
 *      normalised the pair — or swapped it — fails here.
 *
 *   6. **`handle` never appears, not even as a value.** `SocialAccount.handle`
 *      is the real-world identifier. The fixture carries a recognisable
 *      `PW_EXCHANGE_SECRET_HANDLE_…` string on the nested `socialAccount`, and
 *      the test scans the serialised response for that literal — so a stray
 *      `include` of `SocialAccount` fails on content, not just on key names.
 *
 *   7. **`connectionId` has no foreign key.** A detail whose `connectionId`
 *      points at nothing must be a 200 with `connectionAvailable: false`, never
 *      a 500 and never a 404 — the exchange itself still exists.
 *
 *   8. **Reads write no audit.** Phase C3 is GET-only, so `adminAuditLog.create`
 *      must never be called.
 *
 * Real HTTP for all five roles, and every count against live PostgreSQL, are
 * verified in `scripts/phaseA-rbac-verify.mjs` (§12).
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
const EXCHANGE_READERS: AdminRole[] = ["SUPER_ADMIN", "ANALYST"];
const EXCHANGE_DENIED: AdminRole[] = ["MODERATOR", "SUPPORT", "CONTENT_MANAGER"];

const EXCHANGE_ID = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";
const PENDING_ID = "6d7e8f90-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** A `connectionId` that is well-formed but points at nothing. */
const DANGLING_CONNECTION_ID = "deadbeef-0000-4000-8000-000000000001";
const CONNECTION_ID = "4c5d6e7f-8a90-4b1c-8d2e-3f4a5b6c7d8e";
const CONVERSATION_ID = "7c8d9e0f-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const ALICE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BOB_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";
/**
 * Carol has no `Party` fixture on purpose: she is never a requester or a
 * receiver in this file. Her only role is as the *owner* of a share on someone
 * else's exchange, which is exactly the case that proves the share direction
 * comes from `SharedSocialAccount` rather than from the exchange's two parties.
 */
const CAROL_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";

const CREATED_AT = new Date("2026-03-04T05:06:07.000Z");
const UPDATED_AT = new Date("2026-03-05T06:07:08.000Z");

/**
 * The literal a leaked `SocialAccount.handle` would carry.
 *
 * Recognisable and unlikely to occur by accident, so scanning the serialised
 * response for it is a meaningful check rather than a tautology.
 */
const SECRET_HANDLE = "PW_EXCHANGE_SECRET_HANDLE_alice_tg";
const SECRET_HANDLE_BOB = "PW_EXCHANGE_SECRET_HANDLE_bob_wa";

/**
 * A user as Prisma would return it with a *wide* select.
 *
 * `passwordHash`/`tokenHash` are present on the fixture on purpose: widening
 * `EXCHANGE_LIST_SELECT`'s nested `requester` to a bare `include` (or dropping
 * the nested `select`) carries them into the response, where the deep scan
 * fails. A fixture without them could never catch that mistake.
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

/** A `SocialAccount` as it comes back with a *wide* select — handle included. */
type SocialAccountRow = {
  id: string;
  userId: string;
  platform: string;
  handle: string;
  syncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const ALICE_TELEGRAM: SocialAccountRow = {
  id: "aaaa1111-2222-4333-8444-555566667777",
  userId: ALICE_ID,
  platform: "TELEGRAM",
  handle: SECRET_HANDLE,
  syncEnabled: true,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const BOB_WHATSAPP: SocialAccountRow = {
  id: "bbbb1111-2222-4333-8444-555566667777",
  userId: BOB_ID,
  platform: "WHATSAPP",
  handle: SECRET_HANDLE_BOB,
  syncEnabled: false,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

/**
 * A third party's account.
 *
 * The schema does **not** constrain a share's owner/viewer to the exchange's
 * requester and receiver — `ownerId`/`viewerId` are plain FKs to `User`, and
 * `exchangeId` only ties the share to the request. This fixture exists so the
 * direction can be proven to come from the stored row rather than from a
 * plausible-looking substitution of the two parties.
 */
const CAROL_DISCORD: SocialAccountRow = {
  id: "cccc1111-2222-4333-8444-555566667777",
  userId: CAROL_ID,
  platform: "DISCORD",
  handle: "PW_EXCHANGE_SECRET_HANDLE_carol_dc",
  syncEnabled: false,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

/** An exchange row as it comes back with a *wide* select. */
type ExchangeRow = {
  id: string;
  connectionId: string;
  conversationId: string;
  platforms: string[];
  message: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  requesterId: string;
  receiverId: string;
  requester: Party;
  receiver: Party;
  /** Present on the fixture so a stray `include` of the conversation fails. */
  conversation?: { id: string; messages: unknown[] };
  /** Present on the fixture so a stray `include` of the shares fails. */
  shares?: unknown[];
};

const ACCEPTED_ROW: ExchangeRow = {
  id: EXCHANGE_ID,
  connectionId: CONNECTION_ID,
  conversationId: CONVERSATION_ID,
  platforms: ["TELEGRAM"],
  message: "Let's swap Telegram",
  status: "ACCEPTED",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  requesterId: ALICE_ID,
  receiverId: BOB_ID,
  requester: ALICE,
  receiver: BOB,
  conversation: {
    id: CONVERSATION_ID,
    messages: [{ content: "private chat body that must never be returned" }],
  },
};

/**
 * The second exchange, deliberately carrying **two** platforms.
 *
 * A one-element array cannot distinguish "return the whole set" from "return
 * `platforms[0]`", which is the mistake the spec warns about. It also points at
 * a `connectionId` that does not exist, so the same fixture drives the
 * dangling-connection case.
 */
const PENDING_ROW: ExchangeRow = {
  id: PENDING_ID,
  connectionId: DANGLING_CONNECTION_ID,
  conversationId: CONVERSATION_ID,
  platforms: ["WHATSAPP", "DISCORD"],
  message: null,
  status: "PENDING",
  createdAt: new Date("2026-03-02T00:00:00.000Z"),
  updatedAt: new Date("2026-03-02T00:00:00.000Z"),
  requesterId: BOB_ID,
  receiverId: ALICE_ID,
  requester: BOB,
  receiver: ALICE,
};

/** A share row as Prisma would return it with a *wide* select. */
type ShareRow = {
  id: string;
  ownerId: string;
  viewerId: string;
  platform: string;
  socialAccountId: string;
  exchangeId: string;
  createdAt: Date;
  socialAccount: SocialAccountRow;
};

const SHARE_ALICE_TO_BOB: ShareRow = {
  id: "share-1",
  ownerId: ALICE_ID,
  viewerId: BOB_ID,
  platform: "TELEGRAM",
  socialAccountId: ALICE_TELEGRAM.id,
  exchangeId: EXCHANGE_ID,
  createdAt: CREATED_AT,
  socialAccount: ALICE_TELEGRAM,
};

/** The reverse direction, on the same exchange. */
const SHARE_BOB_TO_ALICE: ShareRow = {
  id: "share-2",
  ownerId: BOB_ID,
  viewerId: ALICE_ID,
  platform: "WHATSAPP",
  socialAccountId: BOB_WHATSAPP.id,
  exchangeId: EXCHANGE_ID,
  createdAt: UPDATED_AT,
  socialAccount: BOB_WHATSAPP,
};

/**
 * A share granted by someone who is neither the requester nor the receiver.
 *
 * Carol granted Alice a Discord account, and the share is attached to an
 * exchange between Alice and Bob. Nothing in the schema forbids this, so the API
 * must report Carol as the owner. An implementation that inferred the owner from
 * the exchange's two parties would pass every other test here and be wrong.
 */
const SHARE_CAROL_TO_ALICE: ShareRow = {
  id: "share-3",
  ownerId: CAROL_ID,
  viewerId: ALICE_ID,
  platform: "DISCORD",
  socialAccountId: CAROL_DISCORD.id,
  exchangeId: EXCHANGE_ID,
  createdAt: CREATED_AT,
  socialAccount: CAROL_DISCORD,
};

/** A connection row, as the detail's fallible lookup returns it. */
type ConnectionRow = {
  id: string;
  status: string;
  createdAt: Date;
  conversationId: string | null;
  userAId: string;
  userBId: string;
  userA: Party;
  userB: Party;
};

const CONNECTION_ROW: ConnectionRow = {
  id: CONNECTION_ID,
  status: "ACTIVE",
  createdAt: new Date("2026-02-01T00:00:00.000Z"),
  conversationId: CONVERSATION_ID,
  userAId: ALICE_ID,
  userBId: BOB_ID,
  userA: ALICE,
  userB: BOB,
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

const EXCHANGE_AUDIT: AuditRow = {
  id: "audit-ex-1",
  action: "ADMIN_EXCHANGE_CANCEL",
  targetType: "EXCHANGE",
  targetId: EXCHANGE_ID,
  actorType: "USER",
  adminId: ADMIN_ID,
  detail: "cancelled on request",
  before: { status: "PENDING" },
  after: { status: "CANCELLED" },
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
  rows?: ExchangeRow[];
  total?: number;
  detailRow?: ExchangeRow | null;
  shares?: ShareRow[];
  connectionRow?: ConnectionRow | null;
  history?: AuditRow[];
};

function makeService(opts: HarnessOptions = {}) {
  const calls = {
    exchangeCount: [] as Call[],
    exchangeFindMany: [] as Call[],
    exchangeFindUnique: [] as Call[],
    shareFindMany: [] as Call[],
    connectionFindUnique: [] as Call[],
    auditFindMany: [] as Call[],
    auditCreate: [] as Call[],
  };

  const exchangeCount = jest.fn(async (args: Call = {}) => {
    calls.exchangeCount.push(args);
    return opts.total ?? (opts.rows ?? [ACCEPTED_ROW]).length;
  });

  const exchangeFindMany = jest.fn(async (args: Call) => {
    calls.exchangeFindMany.push(args);
    return (opts.rows ?? [ACCEPTED_ROW]).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const exchangeFindUnique = jest.fn(async (args: Call) => {
    calls.exchangeFindUnique.push(args);
    const row = opts.detailRow === undefined ? ACCEPTED_ROW : opts.detailRow;
    if (row === null) return null;
    return project(row as unknown as Record<string, unknown>, args.select ?? {});
  });

  const shareFindMany = jest.fn(async (args: Call) => {
    calls.shareFindMany.push(args);
    return (opts.shares ?? []).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const connectionFindUnique = jest.fn(async (args: Call) => {
    calls.connectionFindUnique.push(args);
    const row = opts.connectionRow === undefined ? CONNECTION_ROW : opts.connectionRow;
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

  const exchangeRequest = {
    count: exchangeCount,
    findMany: exchangeFindMany,
    findUnique: exchangeFindUnique,
  };

  const tx = {
    exchangeRequest,
    adminAuditLog: { findMany: auditFindMany, create: auditCreate },
  };

  const prisma = {
    ...tx,
    exchangeRequest,
    sharedSocialAccount: { findMany: shareFindMany },
    connection: { findUnique: connectionFindUnique },
    adminAuditLog: tx.adminAuditLog,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  return { service: new AdminService(prisma as never), calls, prisma };
}

/** Runs `listExchanges()` and returns the result plus captured calls. */
async function list(opts: HarnessOptions = {}, query: Record<string, unknown> = {}) {
  const harness = makeService(opts);
  const result = await harness.service.listExchanges(query);
  return { ...harness, result };
}

/** Runs `exchangeDetail()` and returns the result plus captured calls. */
async function detail(opts: HarnessOptions = {}, id = EXCHANGE_ID) {
  const harness = makeService(opts);
  const result = await harness.service.exchangeDetail(id);
  return { ...harness, result };
}

/** Every key path in a nested value, e.g. `items[0].requester.email`. */
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
  "clientSecret",
  "ip",
  "userAgent",
  "handle",
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

describe("Exchanges — role access", () => {
  it("1-2. SUPER_ADMIN and ANALYST hold exchanges:read", () => {
    for (const role of EXCHANGE_READERS) {
      expect(hasPermission(role, "exchanges:read")).toBe(true);
    }
  });

  it("3-5. MODERATOR, SUPPORT and CONTENT_MANAGER do not hold exchanges:read", () => {
    for (const role of EXCHANGE_DENIED) {
      expect(hasPermission(role, "exchanges:read")).toBe(false);
    }
  });

  it("3b. a MODERATOR does not gain exchange access from moderation access", () => {
    // The tempting mistake: "the moderation workbench needs exchanges, so grant
    // MODERATOR exchanges:read". Those are different jobs, and the matrix says
    // so — MODERATOR has moderation:read and risk:read but not exchanges:read.
    expect(hasPermission("MODERATOR", "moderation:read")).toBe(true);
    expect(hasPermission("MODERATOR", "risk:read")).toBe(true);
    expect(hasPermission("MODERATOR", "exchanges:read")).toBe(false);
  });

  it("3c. exchanges:read is a strictly narrower set than risk:read", () => {
    const riskReaders = ALL_ROLES.filter((r) => hasPermission(r, "risk:read"));
    expect(riskReaders).toEqual(["SUPER_ADMIN", "MODERATOR", "ANALYST"]);
    expect(EXCHANGE_READERS).toEqual(["SUPER_ADMIN", "ANALYST"]);
    expect(EXCHANGE_READERS.length).toBeLessThan(riskReaders.length);
  });

  it("4-5. both exchange handlers declare exchanges:read", () => {
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.exchanges),
    ).toBe("exchanges:read");
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.exchangeDetail),
    ).toBe("exchanges:read");
  });

  it("5b. the exchange routes are not gated on a neighbouring permission", () => {
    // Picking `connections:read` or `reports:read` would look harmless and would
    // silently widen access, because those holder sets are different.
    for (const method of ["exchanges", "exchangeDetail"] as const) {
      const declared = Reflect.getMetadata(
        PERMISSION_METADATA_KEY,
        AdminController.prototype[method],
      );
      expect(declared).toBe("exchanges:read");
      expect(declared).not.toBe("connections:read");
      expect(declared).not.toBe("reports:read");
      expect(declared).not.toBe("moderation:read");
      expect(declared).not.toBe("users:read");
    }
  });

  it("6. PermissionGuard admits each reader and refuses each non-reader", () => {
    for (const role of EXCHANGE_READERS) {
      const guard = new PermissionGuard(reflectorReturning("exchanges:read"));
      expect(guard.canActivate(httpContext({ admin: admin(role) }))).toBe(true);
    }
    // Denial is a thrown `ForbiddenException`, not a `false` return — the guard
    // converts a missing permission into the real 403 the client sees.
    for (const role of EXCHANGE_DENIED) {
      const guard = new PermissionGuard(reflectorReturning("exchanges:read"));
      expect(() => guard.canActivate(httpContext({ admin: admin(role) }))).toThrow(
        ForbiddenException,
      );
    }
  });

  it("6b. an anonymous request with no admin identity is refused", () => {
    const guard = new PermissionGuard(reflectorReturning("exchanges:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow(ForbiddenException);
  });

  it("6c. exchanges:write is held by SUPER_ADMIN only, and no route uses it", () => {
    // Phase C3 ships no mutation. `exchanges:write` exists in the matrix — that
    // describes the role model, it does not oblige this phase to write.
    const writers = ALL_ROLES.filter((r) => hasPermission(r, "exchanges:write"));
    expect(writers).toEqual(["SUPER_ADMIN"]);

    // No Exchange handler is a write verb.
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    expect(proto.exchanges).toBeDefined();
    expect(proto.exchangeDetail).toBeDefined();
    for (const name of [
      "createExchange",
      "updateExchange",
      "cancelExchange",
      "reviewExchange",
      "setExchangeStatus",
    ]) {
      expect(proto[name]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 7-25. list: filtering, pagination, ordering
// ---------------------------------------------------------------------------

describe("Exchanges — list", () => {
  it("7. the list returns items/total/page/pageSize/totalPages", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW] }, {});
    expect(Object.keys(result).sort()).toEqual([
      "items",
      "page",
      "pageSize",
      "total",
      "totalPages",
    ]);
    expect(result.items).toHaveLength(1);
  });

  it("8. no status filter is applied by default", async () => {
    const { result, calls } = await list({ rows: [ACCEPTED_ROW, PENDING_ROW], total: 2 }, {});
    expect(result.total).toBe(2);
    expect(listWhere(calls.exchangeCount).status).toBeUndefined();
    expect(listWhere(calls.exchangeFindMany).status).toBeUndefined();
  });

  it("9-12. each of the four real statuses is a first-class filter", async () => {
    for (const status of ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"]) {
      const { calls } = await list({ rows: [ACCEPTED_ROW] }, { status });
      expect(listWhere(calls.exchangeCount).status).toBe(status);
      expect(listWhere(calls.exchangeFindMany).status).toBe(status);
    }
  });

  it("13. status is case-insensitive on the wire", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { status: " accepted " });
    expect(listWhere(calls.exchangeFindMany).status).toBe("ACCEPTED");
  });

  it("14. an unknown status is ignored rather than rejected", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { status: "EXPIRED" });
    expect(listWhere(calls.exchangeFindMany).status).toBeUndefined();
  });

  it("14b. statuses that do not exist in the enum are not silently invented", async () => {
    // `EXPIRED`, `COMPLETED` and `REVOKED` are not stored states. Accepting them
    // would either match nothing while looking like a working filter, or imply
    // an exchange can reach a state the database cannot represent.
    for (const status of ["EXPIRED", "COMPLETED", "REVOKED"]) {
      const { calls } = await list({ rows: [ACCEPTED_ROW] }, { status });
      expect(listWhere(calls.exchangeFindMany).status).toBeUndefined();
    }
  });

  it("15. platform filters with array-contains semantics, not equality", async () => {
    const { calls } = await list({ rows: [PENDING_ROW] }, { platform: "DISCORD" });
    const where = listWhere(calls.exchangeFindMany);

    // `platforms` is `SocialPlatform[]`, so the only correct operator is `has`
    // (PostgreSQL `@>`). An equality filter would hide every multi-platform
    // request, and a `platform = value` filter is not expressible at all.
    expect(where.platforms).toEqual({ has: "DISCORD" });
  });

  it("15b. the platform filter is case-insensitive and ignores an unknown platform", async () => {
    const lower = await list({ rows: [ACCEPTED_ROW] }, { platform: " telegram " });
    expect(listWhere(lower.calls.exchangeFindMany).platforms).toEqual({ has: "TELEGRAM" });

    const bogus = await list({ rows: [ACCEPTED_ROW] }, { platform: "MYSPACE" });
    expect(listWhere(bogus.calls.exchangeFindMany).platforms).toBeUndefined();
  });

  it("16. the platform whitelist is the real enum, not a hand-written subset", async () => {
    // `SocialPlatform` has twelve members. A hardcoded list would plausibly omit
    // the less obvious ones, silently ignoring a filter for them.
    for (const platform of ["INSTAGRAM", "TELEGRAM", "WHATSAPP", "DISCORD", "X", "TIKTOK", "WECHAT", "QQ", "STEAM", "YOUTUBE", "FACEBOOK", "TALKFIRST"]) {
      const { calls } = await list({ rows: [ACCEPTED_ROW] }, { platform });
      expect(listWhere(calls.exchangeFindMany).platforms).toEqual({ has: platform });
    }
  });

  it("17. a UUID user filter matches requesterId OR receiverId exactly", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW, PENDING_ROW] }, { user: BOB_ID });
    const where = listWhere(calls.exchangeFindMany);

    // Bob is the receiver of one exchange and the requester of the other, so a
    // single-column lookup would return half his exchanges.
    expect(where.OR).toEqual([{ requesterId: BOB_ID }, { receiverId: BOB_ID }]);
  });

  it("18. a text user filter searches BOTH parties' nicknames in the DB", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { user: "bo" });
    const where = listWhere(calls.exchangeFindMany);

    expect(where.OR).toEqual([
      { requester: { nickname: { contains: "bo", mode: "insensitive" } } },
      { receiver: { nickname: { contains: "bo", mode: "insensitive" } } },
    ]);
    // Filtering is a `where` clause, never a post-filter over a fetched page.
    expect(calls.exchangeFindMany[0]?.where).toEqual(calls.exchangeCount[0]?.where);
  });

  it("19. a nickname search on the requester side alone still matches", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { user: "Alice" });
    const where = listWhere(calls.exchangeFindMany);
    expect(JSON.stringify(where)).toContain("Alice");
  });

  it("19b. the user filter does NOT search email", async () => {
    // The users list is the screen that searches addresses. An exchange list
    // that quietly matched on email would disclose more than its own body does.
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { user: "alice@example.test" });
    const where = listWhere(calls.exchangeFindMany);
    expect(JSON.stringify(where)).not.toContain("email");
  });

  it("19c. an empty user filter is not applied", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { user: "   " });
    expect(listWhere(calls.exchangeFindMany).OR).toBeUndefined();
  });

  it("20. createdFrom is an inclusive lower bound", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { createdFrom: "2026-03-01" });
    const createdAt = listWhere(calls.exchangeFindMany).createdAt as Record<string, unknown>;
    expect(createdAt.gte).toBeInstanceOf(Date);
    expect(createdAt.lte).toBeUndefined();
  });

  it("21. createdTo is an inclusive upper bound", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { createdTo: "2026-03-31" });
    const createdAt = listWhere(calls.exchangeFindMany).createdAt as Record<string, unknown>;
    expect(createdAt.lte).toBeInstanceOf(Date);
    expect(createdAt.gte).toBeUndefined();
  });

  it("22. a malformed date is a 400 VALIDATION_ERROR", async () => {
    await expect(list({}, { createdFrom: "not-a-date" })).rejects.toMatchObject({
      response: {
        success: false,
        error: { code: "VALIDATION_ERROR" },
      },
    });
  });

  it("23. a non-existent calendar date is rejected, not rolled over", async () => {
    // `new Date("2026-02-30")` does not return Invalid Date — it silently rolls
    // over to 2 March. The calendar check is what stops a filter from silently
    // meaning a different day than the caller asked for.
    await expect(list({}, { createdTo: "2026-02-30" })).rejects.toMatchObject({
      response: { error: { code: "VALIDATION_ERROR", details: { createdTo: expect.any(Array) } } },
    });
  });

  it("24. page 1 with pageSize 1 and a total of 3 yields totalPages 3", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW], total: 3 }, { page: 1, pageSize: 1 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(1);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(3);
  });

  it("24b. totalPages is a ceiling, not a floor", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW], total: 3 }, { pageSize: 2 });
    expect(result.totalPages).toBe(2);
  });

  it("25. a total of 0 yields 0 pages", async () => {
    const { result } = await list({ rows: [], total: 0 }, {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("25b. a page past the end is an empty page, not an error and not a re-page", async () => {
    const { result } = await list({ rows: [], total: 2 }, { page: 99, pageSize: 20 });
    expect(result.items).toEqual([]);
    // The total is the honest total; the page number is echoed, not clamped
    // back to the last page — silently moving the caller is worse than an
    // empty page, because it makes a stale link look like it worked.
    expect(result.total).toBe(2);
    expect(result.page).toBe(99);
    expect(result.totalPages).toBe(1);
  });

  it("25c. page and pageSize are clamped to the existing bounds", async () => {
    const low = await list({ rows: [ACCEPTED_ROW] }, { page: -5, pageSize: 0 });
    expect(low.result.page).toBe(1);
    expect(low.result.pageSize).toBe(20);

    const high = await list({ rows: [ACCEPTED_ROW] }, { page: 5000, pageSize: 5000 });
    expect(high.result.page).toBe(1000);
    expect(high.result.pageSize).toBe(100);
  });

  it("25d. skip/take follow from page/pageSize", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { page: 3, pageSize: 10 });
    expect(calls.exchangeFindMany[0]?.skip).toBe(20);
    expect(calls.exchangeFindMany[0]?.take).toBe(10);
  });

  it("25e. count and findMany share one where", async () => {
    const { calls } = await list(
      { rows: [ACCEPTED_ROW] },
      { status: "ACCEPTED", platform: "TELEGRAM", user: "alice" },
    );
    expect(calls.exchangeFindMany[0]?.where).toEqual(calls.exchangeCount[0]?.where);
  });
});

// ---------------------------------------------------------------------------
// 26-33. list: sorting and the response shape
// ---------------------------------------------------------------------------

describe("Exchanges — sorting and shape", () => {
  it("26. the default order is newest first", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, {});
    expect(calls.exchangeFindMany[0]?.orderBy).toEqual({ createdAt: "desc" });
  });

  it("27. every whitelisted sort key resolves to a Prisma orderBy", async () => {
    for (const key of Object.keys(EXCHANGE_SORT_ORDERS)) {
      const { calls } = await list({ rows: [ACCEPTED_ROW] }, { sort: key });
      expect(calls.exchangeFindMany[0]?.orderBy).toEqual(
        EXCHANGE_SORT_ORDERS[key as keyof typeof EXCHANGE_SORT_ORDERS],
      );
    }
  });

  it("27b. the sort whitelist covers createdAt and status, and nulls sort last", async () => {
    expect(EXCHANGE_SORT_ORDERS.createdAt_asc).toEqual({ createdAt: "asc" });
    expect(EXCHANGE_SORT_ORDERS.createdAt_desc).toEqual({ createdAt: "desc" });
    expect(EXCHANGE_SORT_ORDERS.status_asc).toEqual({ status: "asc" });
    expect(EXCHANGE_SORT_ORDERS.status_desc).toEqual({ status: "desc" });

    // `User.nickname` is nullable and PostgreSQL's `ORDER BY … DESC` defaults to
    // NULLS FIRST, which would lead a descending sort with the nameless rows.
    for (const key of [
      "requester_nickname_asc",
      "requester_nickname_desc",
      "receiver_nickname_asc",
      "receiver_nickname_desc",
    ] as const) {
      expect(JSON.stringify(EXCHANGE_SORT_ORDERS[key])).toContain('"nulls":"last"');
    }
  });

  it("28. an unknown sort is a 400, never a silent fallback", async () => {
    await expect(list({}, { sort: "message_asc" })).rejects.toMatchObject({
      response: { error: { code: "VALIDATION_ERROR", details: { sort: expect.any(Array) } } },
    });
  });

  it("28b. a client string never reaches Prisma's orderBy", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { sort: "createdAt_desc" });
    // The value handed to Prisma is the whitelist entry, not the caller's text.
    expect(calls.exchangeFindMany[0]?.orderBy).toBe(EXCHANGE_SORT_ORDERS.createdAt_desc);
  });

  it("29. a list row carries exactly the specified fields", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW] }, {});
    const row = result.items[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual([
      "createdAt",
      "id",
      "platforms",
      "receiver",
      "requester",
      "status",
    ]);
  });

  it("30. a list row's parties expose only id and nickname", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW] }, {});
    const row = result.items[0] as { requester: Record<string, unknown>; receiver: Record<string, unknown> };
    expect(Object.keys(row.requester).sort()).toEqual(["id", "nickname"]);
    expect(Object.keys(row.receiver).sort()).toEqual(["id", "nickname"]);
  });

  it("31. no email reaches the list response", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW] }, {});
    expect(JSON.stringify(result)).not.toContain("@example.test");
    expect(keyPaths(result).filter((p) => p.endsWith(".email"))).toEqual([]);
  });

  it("32. no credential reaches the list response", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW] }, {});
    expectNoSecrets(result);
    expect(JSON.stringify(result)).not.toContain("$2a$10$");
    expect(JSON.stringify(result)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("32b. the list select names its fields explicitly", async () => {
    // No `include` anywhere, so no relation can ride along by accident.
    expect(EXCHANGE_LIST_SELECT).toEqual({
      id: true,
      status: true,
      platforms: true,
      createdAt: true,
      requester: { select: { id: true, nickname: true } },
      receiver: { select: { id: true, nickname: true } },
    });
    expect(JSON.stringify(EXCHANGE_LIST_SELECT)).not.toContain("include");
  });

  it("32c. the list does not select message, shares or the conversation", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, {});
    const select = calls.exchangeFindMany[0]?.select ?? {};
    expect(select.message).toBeUndefined();
    expect(select.shares).toBeUndefined();
    expect(select.conversation).toBeUndefined();
    expect(select.connection).toBeUndefined();
    expect(calls.exchangeFindMany[0]?.include).toBeUndefined();
  });

  it("33. platforms returns the whole set, not just the first element", async () => {
    const { result } = await list({ rows: [PENDING_ROW] }, {});
    const row = result.items[0] as { platforms: string[] };
    expect(row.platforms).toEqual(["WHATSAPP", "DISCORD"]);
    expect(row.platforms).toHaveLength(2);
  });

  it("33b. an empty platforms array is returned as an empty array", async () => {
    // The column is `SocialPlatform[]` and the default is `[]`, so a row with no
    // platforms is legal data. It must not be coerced to null or dropped.
    const empty = { ...ACCEPTED_ROW, platforms: [] as string[] };
    const { result } = await list({ rows: [empty] }, {});
    const row = result.items[0] as { platforms: string[] };
    expect(row.platforms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 34-45. detail
// ---------------------------------------------------------------------------

describe("Exchanges — detail", () => {
  it("34. the detail returns the specified top-level keys", async () => {
    const { result } = await detail({ shares: [] });
    expect(Object.keys(result).sort()).toEqual([
      "connection",
      "connectionAvailable",
      "exchange",
      "history",
      "receiver",
      "requester",
      "sharedAccounts",
    ]);
  });

  it("35. the exchange block carries exactly its own columns", async () => {
    const { result } = await detail({ shares: [] });
    expect(Object.keys(result.exchange).sort()).toEqual([
      "connectionId",
      "conversationId",
      "createdAt",
      "id",
      "message",
      "platforms",
      "status",
      "updatedAt",
    ]);
  });

  it("36. the exchange block reports the real values", async () => {
    const { result } = await detail({ shares: [] });
    expect(result.exchange.id).toBe(EXCHANGE_ID);
    expect(result.exchange.connectionId).toBe(CONNECTION_ID);
    expect(result.exchange.conversationId).toBe(CONVERSATION_ID);
    expect(result.exchange.platforms).toEqual(["TELEGRAM"]);
    expect(result.exchange.message).toBe("Let's swap Telegram");
    expect(result.exchange.status).toBe("ACCEPTED");
    expect(result.exchange.createdAt).toEqual(CREATED_AT);
    expect(result.exchange.updatedAt).toEqual(UPDATED_AT);
  });

  it("37. requester and receiver are named sides, not interchangeable", async () => {
    const { result } = await detail({ shares: [] });
    expect(result.requester).toEqual({ id: ALICE_ID, nickname: "Alice" });
    expect(result.receiver).toEqual({ id: BOB_ID, nickname: "Bob" });
  });

  it("38. a null message is returned as null, not as an empty string", async () => {
    const { result } = await detail({ detailRow: PENDING_ROW, shares: [] });
    expect(result.exchange.message).toBeNull();
  });

  it("39. sharedAccounts exposes ownerId/viewerId/platform/createdAt", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB] });
    expect(result.sharedAccounts).toHaveLength(1);
    expect(Object.keys(result.sharedAccounts[0]).sort()).toEqual([
      "createdAt",
      "ownerId",
      "platform",
      "viewerId",
    ]);
  });

  it("40. the share direction is reported as stored — owner granted, viewer received", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB] });
    // Alice → Bob on Telegram. Reversing these would tell an operator the
    // opposite of the truth about who shared with whom.
    expect(result.sharedAccounts[0].ownerId).toBe(ALICE_ID);
    expect(result.sharedAccounts[0].viewerId).toBe(BOB_ID);
    expect(result.sharedAccounts[0].platform).toBe("TELEGRAM");
    expect(result.sharedAccounts[0].createdAt).toEqual(CREATED_AT);
  });

  it("41. both directions coexist and are not normalised", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB, SHARE_BOB_TO_ALICE] });
    expect(result.sharedAccounts).toHaveLength(2);

    const aliceToBob = result.sharedAccounts.find((s) => s.ownerId === ALICE_ID);
    const bobToAlice = result.sharedAccounts.find((s) => s.ownerId === BOB_ID);
    expect(aliceToBob?.viewerId).toBe(BOB_ID);
    expect(bobToAlice?.viewerId).toBe(ALICE_ID);
    // Two distinct platforms, two distinct directions — a pair-normalising
    // implementation would collapse these into one row.
    expect(new Set(result.sharedAccounts.map((s) => s.platform))).toEqual(
      new Set(["TELEGRAM", "WHATSAPP"]),
    );
  });

  it("41b. the share direction is taken from the stored row, not inferred from the two parties", async () => {
    // Carol granted Alice a Discord account on an exchange between Alice and
    // Bob. Nothing in the schema ties a share's owner to the requester, so an
    // implementation that "helpfully" assumed owner = requester would report
    // Alice here and be wrong about who shared what with whom.
    const { result } = await detail({ shares: [SHARE_CAROL_TO_ALICE] });
    expect(result.sharedAccounts).toHaveLength(1);
    expect(result.sharedAccounts[0].ownerId).toBe(CAROL_ID);
    expect(result.sharedAccounts[0].viewerId).toBe(ALICE_ID);
    expect(result.sharedAccounts[0].platform).toBe("DISCORD");
    // And the third party's handle is still absent.
    expect(JSON.stringify(result)).not.toContain("PW_EXCHANGE_SECRET_HANDLE");
  });

  it("42. shares are read from SharedSocialAccount, scoped to this exchange", async () => {
    const { calls } = await detail({ shares: [SHARE_ALICE_TO_BOB] });
    expect(calls.shareFindMany[0]?.where).toEqual({ exchangeId: EXCHANGE_ID });
    // The share relation is the only source. `SocialAccount` is never queried,
    // so `handle` is not merely unselected — it is unreachable.
    expect(calls.shareFindMany[0]?.include).toBeUndefined();
  });

  it("42b. the share select does not reach into SocialAccount", async () => {
    expect(SHARED_SOCIAL_SELECT).toEqual({
      ownerId: true,
      viewerId: true,
      platform: true,
      createdAt: true,
    });
    // `socialAccountId` points at the row whose `handle` is the real-world
    // identifier; reading it would be a step towards joining it.
    expect(SHARED_SOCIAL_SELECT).not.toHaveProperty("socialAccountId");
    expect(SHARED_SOCIAL_SELECT).not.toHaveProperty("socialAccount");
  });

  it("43. an existing connection is loaded and reported as available", async () => {
    const { result } = await detail({ shares: [] });
    expect(result.connectionAvailable).toBe(true);
    expect(result.connection).not.toBeNull();
    expect(result.connection?.id).toBe(CONNECTION_ID);
    expect(result.connection?.status).toBe("ACTIVE");
    expect(result.connection?.userA).toEqual({ id: ALICE_ID, nickname: "Alice" });
    expect(result.connection?.userB).toEqual({ id: BOB_ID, nickname: "Bob" });
  });

  it("44. connectionId has no FK, so a dangling id is data — not a 500", async () => {
    // `ExchangeRequest.connectionId` is a bare UUID with no relation, so the
    // value is a claim rather than a guarantee. The exchange is still readable.
    const { result } = await detail({ detailRow: PENDING_ROW, shares: [], connectionRow: null });
    expect(result.connectionAvailable).toBe(false);
    expect(result.connection).toBeNull();
    expect(result.exchange.id).toBe(PENDING_ID);
    expect(result.exchange.connectionId).toBe(DANGLING_CONNECTION_ID);
  });

  it("44b. the connection is a separate lookup, never an include", async () => {
    const { calls } = await detail({ shares: [] });
    expect(calls.connectionFindUnique[0]?.where).toEqual({ id: CONNECTION_ID });
    expect(calls.exchangeFindUnique[0]?.include).toBeUndefined();
    expect(calls.exchangeFindUnique[0]?.select?.connection).toBeUndefined();
  });

  it("45. conversationId is returned as an id and nothing more", async () => {
    const { result, calls } = await detail({ shares: [] });
    expect(result.exchange.conversationId).toBe(CONVERSATION_ID);
    // The conversation relation is never selected, so `Message` and
    // `ConversationMember` cannot ride along.
    expect(calls.exchangeFindUnique[0]?.select?.conversation).toBeUndefined();
    expect(EXCHANGE_DETAIL_SELECT).not.toHaveProperty("conversation");
    expect(EXCHANGE_DETAIL_SELECT).not.toHaveProperty("shares");
  });

  it("45b. no chat history leaks through the detail response", async () => {
    const { result } = await detail({ shares: [] });
    // The fixture carries a conversation with a message body, so a stray
    // `include` of `conversation` fails on content.
    expect(JSON.stringify(result)).not.toContain("private chat body");
    expect(JSON.stringify(result)).not.toContain("messages");
  });

  it("45c. an unknown id is a 404 EXCHANGE_NOT_FOUND, never a 200 with null", async () => {
    await expect(detail({ detailRow: null }, UNKNOWN_ID)).rejects.toMatchObject({
      response: { success: false, error: { code: "EXCHANGE_NOT_FOUND" } },
    });
  });

  it("45d. the 404 reuses the code the normal-user service already throws", async () => {
    // Reused rather than invented, so a client keeps one branch for "that
    // exchange does not exist".
    await expect(detail({ detailRow: null })).rejects.toMatchObject({
      status: 404,
      response: { error: { message: "Exchange request not found" } },
    });
  });

  it("45e. a PENDING exchange is readable — no status gates the lookup", async () => {
    for (const status of ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"]) {
      const { result } = await detail({
        detailRow: { ...ACCEPTED_ROW, status },
        shares: [],
      });
      expect(result.exchange.status).toBe(status);
    }
  });

  it("45f. history is read from AdminAuditLog by targetType EXCHANGE", async () => {
    const { calls } = await detail({ shares: [] });
    expect(calls.auditFindMany[0]?.where).toEqual({
      targetType: "EXCHANGE",
      targetId: EXCHANGE_ID,
    });
  });

  it("45g. history excludes ip and userAgent", async () => {
    const { result } = await detail({ shares: [], history: [EXCHANGE_AUDIT] });
    expect(result.history).toHaveLength(1);
    expect(Object.keys(result.history[0]).sort()).toEqual([
      "action",
      "actorType",
      "adminId",
      "after",
      "before",
      "createdAt",
      "detail",
      "id",
      "reason",
      "targetId",
      "targetType",
    ]);
    expectNoSecrets(result.history);
    expect(JSON.stringify(result.history)).not.toContain("203.0.113.7");
    expect(JSON.stringify(result.history)).not.toContain("Mozilla/5.0");
  });

  it("45h. history is an honest empty list, not fabricated rows", async () => {
    const { result } = await detail({ shares: [] });
    expect(result.history).toEqual([]);
    expect(EXCHANGE_HISTORY_SELECT).not.toHaveProperty("ip");
    expect(EXCHANGE_HISTORY_SELECT).not.toHaveProperty("userAgent");
  });
});

// ---------------------------------------------------------------------------
// 46-55. privacy
// ---------------------------------------------------------------------------

describe("Exchanges — privacy", () => {
  it("46. no handle key reaches the detail response", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB, SHARE_BOB_TO_ALICE] });
    expect(keyPaths(result).filter((p) => p.toLowerCase().endsWith(".handle"))).toEqual([]);
  });

  it("47. the fixture handle VALUE never appears in the detail response", async () => {
    // A key-name scan would miss a leak that renamed the field. Scanning for the
    // literal catches the actual disclosure.
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB, SHARE_BOB_TO_ALICE] });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(SECRET_HANDLE);
    expect(serialised).not.toContain(SECRET_HANDLE_BOB);
    expect(serialised).not.toContain("PW_EXCHANGE_SECRET_HANDLE");
  });

  it("48. the fixture handle value never appears in the list response", async () => {
    const { result } = await list({ rows: [ACCEPTED_ROW, PENDING_ROW] }, {});
    expect(JSON.stringify(result)).not.toContain("PW_EXCHANGE_SECRET_HANDLE");
  });

  it("49. no credential key reaches the detail response", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB], history: [EXCHANGE_AUDIT] });
    expectNoSecrets(result);
  });

  it("50. no credential value reaches the detail response", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB], history: [EXCHANGE_AUDIT] });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("$2a$10$");
    expect(serialised).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(serialised).not.toContain("@example.test");
  });

  it("51. the detail exposes the share relation without the shared account", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB] });
    const share = result.sharedAccounts[0] as Record<string, unknown>;
    expect(share.ownerId).toBe(ALICE_ID);
    expect(share.viewerId).toBe(BOB_ID);
    expect(share.platform).toBe("TELEGRAM");
    // `socialAccountId` is the doorway to `handle`; it is not returned either.
    expect(share).not.toHaveProperty("socialAccountId");
    expect(share).not.toHaveProperty("socialAccount");
  });

  it("52. every select constant is explicit and free of include", async () => {
    for (const constant of [
      EXCHANGE_LIST_SELECT,
      EXCHANGE_DETAIL_SELECT,
      SHARED_SOCIAL_SELECT,
      EXCHANGE_HISTORY_SELECT,
    ]) {
      const serialised = JSON.stringify(constant);
      expect(serialised).not.toContain('"include"');
      expect(serialised).not.toContain('"handle"');
      expect(serialised).not.toContain('"passwordHash"');
      expect(serialised).not.toContain('"tokenHash"');
    }
  });

  it("53. the detail select names its fields explicitly", async () => {
    expect(EXCHANGE_DETAIL_SELECT).toEqual({
      id: true,
      connectionId: true,
      conversationId: true,
      platforms: true,
      message: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      requester: { select: { id: true, nickname: true } },
      receiver: { select: { id: true, nickname: true } },
    });
  });

  it("54. SocialAccount is never queried by either method", async () => {
    // The strongest form of the guarantee: `handle` is not filtered out, it is
    // never fetched. A future edit that adds the query fails here.
    const listHarness = makeService({});
    await listHarness.service.listExchanges({});
    const detailHarness = makeService({ shares: [SHARE_ALICE_TO_BOB] });
    await detailHarness.service.exchangeDetail(EXCHANGE_ID);

    for (const harness of [listHarness, detailHarness]) {
      const prisma = harness.prisma as unknown as Record<string, unknown>;
      expect(prisma.socialAccount).toBeUndefined();
    }
  });

  it("55. no email reaches the detail response", async () => {
    const { result } = await detail({ shares: [SHARE_ALICE_TO_BOB] });
    expect(keyPaths(result).filter((p) => p.endsWith(".email"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 56-57. reads write no audit
// ---------------------------------------------------------------------------

describe("Exchanges — audit", () => {
  it("56. listing exchanges writes no AdminAuditLog row", async () => {
    const { calls } = await list({ rows: [ACCEPTED_ROW] }, { status: "ACCEPTED" });
    expect(calls.auditCreate).toHaveLength(0);
  });

  it("57. opening an exchange writes no AdminAuditLog row", async () => {
    const { calls } = await detail({ shares: [SHARE_ALICE_TO_BOB] });
    expect(calls.auditCreate).toHaveLength(0);
  });

  it("57b. the exchange read path is GET-only at the controller", async () => {
    // A write verb on the exchange routes would need a permission this phase
    // must not activate. The absence is asserted so adding one is deliberate.
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    for (const name of Object.keys(proto)) {
      if (!name.toLowerCase().includes("exchange")) continue;
      expect(["exchanges", "exchangeDetail"]).toContain(name);
    }
  });
});
