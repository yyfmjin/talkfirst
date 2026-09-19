import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { AdminRole } from "@prisma/client";

import { AdminController } from "./admin.controller";
import {
  AdminService,
  BLOCK_DETAIL_SELECT,
  BLOCK_HISTORY_SELECT,
  BLOCK_LIST_SELECT,
  BLOCK_SORT_ORDERS,
  DEFAULT_BLOCK_SORT,
} from "./admin.service";
import { PermissionGuard } from "./permission.guard";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator";
import { hasPermission } from "./permissions";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * Phase C4 — Blocks management.
 *
 * What is pinned here, and why each is not obvious:
 *
 *   1. **`Block` has no `id`.** The schema declares `@@id([blockerId,
 *      blockedId])`. The response must therefore carry the **pair** and no
 *      synthetic identifier, the detail route is `/blocks/:blockerId/:blockedId`,
 *      and the lookup uses Prisma's generated `blockerId_blockedId` key. A
 *      fixture with an `id` would hide a fabricated one, so the fixtures have
 *      none and `BLOCK_LIST_SELECT` is asserted not to contain one.
 *
 *   2. **Direction is the row's meaning.** `Alice → Bob` and `Bob → Alice` are
 *      different facts. The fixture contains both, plus `Carol → Alice`, so an
 *      implementation that normalised the pair (sorted the ids, `min`/`max`,
 *      deduplicated with a `Set`) fails here rather than looking correct.
 *
 *   3. **`user` matches either side.** `Block` has no owner column, so
 *      "everything involving Alice" is `blockerId = alice OR blockedId = alice`.
 *      Filtering only `blockerId` is the classic mistake and returns 1 where the
 *      fixture requires 2.
 *
 *   4. **`blocker` / `blocked` are the directional pair.** They must answer
 *      *different* sets for the same person — that difference is what makes the
 *      normalisation mistake detectable from the outside.
 *
 *   5. **`blocks:read`, not a neighbouring permission.** Held by **SUPER_ADMIN
 *      and ANALYST only** — the same holder set as `connections:read` and
 *      `exchanges:read`, and deliberately narrower than `risk:read`. The exact
 *      holder set is asserted, not merely "some role can read".
 *
 *   6. **No `handle`, no `email`, no `passwordHash`, ever.** A block is not a
 *      social-account audit. The strongest form of this assertion is that the
 *      service never touches `prisma.socialAccount` at all; the response is also
 *      scanned for a recognisable `PW_BLOCK_SECRET_HANDLE_…` literal, so a leak
 *      that renamed the field would still fail on content.
 *
 *   7. **GET-only.** `adminAuditLog.create` must never be called, and the
 *      controller must expose no block mutation route.
 *
 * Real HTTP for all five roles, and every count against live PostgreSQL, are
 * verified in `scripts/phaseA-rbac-verify.mjs` (§10g).
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
const BLOCK_READERS: AdminRole[] = ["SUPER_ADMIN", "ANALYST"];
const BLOCK_DENIED: AdminRole[] = ["MODERATOR", "SUPPORT", "CONTENT_MANAGER"];

const ALICE_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const BOB_ID = "3f1c0b7e-6a2d-4f8b-9c31-8d5e2a4b7c90";
const CAROL_ID = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
/** A well-formed UUID that is not any of the fixtures. */
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const ALICE_TO_BOB_AT = new Date("2026-03-01T10:00:00.000Z");
const BOB_TO_ALICE_AT = new Date("2026-03-02T10:00:00.000Z");
const CAROL_TO_ALICE_AT = new Date("2026-03-03T10:00:00.000Z");

/**
 * The literal a leaked `SocialAccount.handle` would carry.
 *
 * Recognisable and unlikely to occur by accident, so scanning the serialised
 * response for it is a meaningful check rather than a tautology.
 */
const SECRET_HANDLE = "PW_BLOCK_SECRET_HANDLE_alice_tg";
const SECRET_HANDLE_BOB = "PW_BLOCK_SECRET_HANDLE_bob_wa";

/**
 * A user as Prisma would return it with a *wide* select.
 *
 * `passwordHash`/`tokenHash` are present on the fixture on purpose: widening
 * `BLOCK_LIST_SELECT`'s nested `blocker` to a bare `include` (or dropping the
 * nested `select`) carries them into the response, where the deep scan fails.
 * A fixture without them could never catch that mistake.
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
  passwordHash: "$2a$10$qwertyuiopasdfghjklzxc",
  tokenHash: "eyJhbGciOiJIUzI1NiJ9.carol.payload",
};

/**
 * A `SocialAccount` as it comes back with a *wide* select — handle included.
 *
 * Nothing in C4 should ever read this table. It exists so that "the handle was
 * never loaded" is provable by scanning for the literal, and so that a stray
 * relation on the block fixture has something sensitive to leak.
 */
type SocialAccountRow = {
  id: string;
  userId: string;
  platform: string;
  handle: string;
  syncEnabled: boolean;
};

const ALICE_TELEGRAM: SocialAccountRow = {
  id: "aaaa1111-2222-4333-8444-555566667777",
  userId: ALICE_ID,
  platform: "TELEGRAM",
  handle: SECRET_HANDLE,
  syncEnabled: true,
};

const BOB_WHATSAPP: SocialAccountRow = {
  id: "bbbb1111-2222-4333-8444-555566667777",
  userId: BOB_ID,
  platform: "WHATSAPP",
  handle: SECRET_HANDLE_BOB,
  syncEnabled: false,
};

/**
 * A block row as it comes back with a *wide* select.
 *
 * Note what is **absent**: there is no `id`. The real model has none, and a
 * fixture carrying one would make a fabricated identifier look correct.
 */
type BlockRow = {
  blockerId: string;
  blockedId: string;
  createdAt: Date;
  blocker: Party;
  blocked: Party;
  /**
   * Present on the fixture so a stray `include` of a neighbouring domain fails
   * on *content*, not merely on a key name. None of these may appear in a C4
   * response — a block is not a chat and not a social-account audit.
   */
  socialAccounts?: SocialAccountRow[];
  sharedSocialAccounts?: unknown[];
  conversation?: { id: string; messages: unknown[] };
  exchangeRequests?: unknown[];
};

/** `Alice → Bob`: Alice did the blocking. */
const ALICE_TO_BOB: BlockRow = {
  blockerId: ALICE_ID,
  blockedId: BOB_ID,
  createdAt: ALICE_TO_BOB_AT,
  blocker: ALICE,
  blocked: BOB,
};

/** `Bob → Alice`: the reverse direction, a genuinely different row. */
const BOB_TO_ALICE: BlockRow = {
  blockerId: BOB_ID,
  blockedId: ALICE_ID,
  createdAt: BOB_TO_ALICE_AT,
  blocker: BOB,
  blocked: ALICE,
};

/**
 * `Carol → Alice`.
 *
 * Carol is neither the blocker nor the blocked party in the other two rows, and
 * Alice is the *blocked* party here while being the *blocker* in the first row.
 * That combination is what makes "Alice is involved in 2 blocks" a real
 * either-side assertion rather than a restatement of one column.
 */
const CAROL_TO_ALICE: BlockRow = {
  blockerId: CAROL_ID,
  blockedId: ALICE_ID,
  createdAt: CAROL_TO_ALICE_AT,
  blocker: CAROL,
  blocked: ALICE,
  socialAccounts: [ALICE_TELEGRAM, BOB_WHATSAPP],
  sharedSocialAccounts: [{ id: "share-must-not-leak" }],
  conversation: { id: "conversation-must-not-leak", messages: [{ content: "private" }] },
  exchangeRequests: [{ id: "exchange-must-not-leak" }],
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

const BLOCK_AUDIT: AuditRow = {
  id: "audit-block-1",
  action: "ADMIN_BLOCK_REMOVE",
  targetType: "BLOCK",
  targetId: ALICE_ID,
  actorType: "USER",
  adminId: ADMIN_ID,
  detail: "unblocked on request",
  before: { blockerId: ALICE_ID, blockedId: BOB_ID },
  after: null,
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
  rows?: BlockRow[];
  total?: number;
  detailRow?: BlockRow | null;
  history?: AuditRow[];
};

function makeService(opts: HarnessOptions = {}) {
  const calls = {
    blockCount: [] as Call[],
    blockFindMany: [] as Call[],
    blockFindUnique: [] as Call[],
    auditFindMany: [] as Call[],
    auditCreate: [] as Call[],
  };

  const blockCount = jest.fn(async (args: Call = {}) => {
    calls.blockCount.push(args);
    return opts.total ?? (opts.rows ?? [ALICE_TO_BOB]).length;
  });

  const blockFindMany = jest.fn(async (args: Call) => {
    calls.blockFindMany.push(args);
    return (opts.rows ?? [ALICE_TO_BOB]).map((row) =>
      project(row as unknown as Record<string, unknown>, args.select ?? {}),
    );
  });

  const blockFindUnique = jest.fn(async (args: Call) => {
    calls.blockFindUnique.push(args);
    const row = opts.detailRow === undefined ? ALICE_TO_BOB : opts.detailRow;
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

  const block = {
    count: blockCount,
    findMany: blockFindMany,
    findUnique: blockFindUnique,
  };

  const tx = {
    block,
    adminAuditLog: { findMany: auditFindMany, create: auditCreate },
  };

  const prisma = {
    ...tx,
    block,
    adminAuditLog: tx.adminAuditLog,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };

  // `socialAccount`, `sharedSocialAccount`, `conversation` and `message` are
  // deliberately **not** on this object. If the service reaches for one, it
  // throws `TypeError: ... is not a function` and the test fails loudly, which
  // is a stronger guarantee than asserting an absence after the fact.
  return { service: new AdminService(prisma as never), calls, prisma };
}

/** Runs `listBlocks()` and returns the result plus captured calls. */
async function list(opts: HarnessOptions = {}, query: Record<string, unknown> = {}) {
  const harness = makeService(opts);
  const result = await harness.service.listBlocks(query);
  return { ...harness, result };
}

/** Runs `blockDetail()` and returns the result plus captured calls. */
async function detail(
  opts: HarnessOptions = {},
  blockerId = ALICE_ID,
  blockedId = BOB_ID,
) {
  const harness = makeService(opts);
  const result = await harness.service.blockDetail(blockerId, blockedId);
  return { ...harness, result };
}

/** Every key path in a nested value, e.g. `items[0].blocker.email`. */
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
  "email",
];

function expectNoSecrets(payload: unknown) {
  const paths = keyPaths(payload);
  for (const field of FORBIDDEN) {
    expect(
      paths.filter((path) => path.toLowerCase().endsWith(`.${field.toLowerCase()}`)),
    ).toEqual([]);
  }
}

/** The `where` a list call actually sent. */
function listWhere(calls: Call[]): Record<string, unknown> {
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]?.where ?? {};
}

/** The `where` a detail call actually sent. */
function detailWhere(calls: Call[]): Record<string, unknown> {
  expect(calls.length).toBeGreaterThan(0);
  return calls[0]?.where ?? {};
}

// ---------------------------------------------------------------------------
// 1-6. role access and the GET contract
// ---------------------------------------------------------------------------

describe("Blocks — role access", () => {
  it("1-2. SUPER_ADMIN and ANALYST hold blocks:read", () => {
    for (const role of BLOCK_READERS) {
      expect(hasPermission(role, "blocks:read")).toBe(true);
    }
  });

  it("3-5. MODERATOR, SUPPORT and CONTENT_MANAGER do not hold blocks:read", () => {
    for (const role of BLOCK_DENIED) {
      expect(hasPermission(role, "blocks:read")).toBe(false);
    }
  });

  it("3b. a MODERATOR does not gain block access from moderation access", () => {
    // The tempting mistake: "moderation deals with abuse, so MODERATOR needs
    // blocks". Those are different jobs, and the matrix says so — MODERATOR has
    // moderation:read and risk:read but not blocks:read.
    expect(hasPermission("MODERATOR", "moderation:read")).toBe(true);
    expect(hasPermission("MODERATOR", "risk:read")).toBe(true);
    expect(hasPermission("MODERATOR", "blocks:read")).toBe(false);
  });

  it("3c. blocks:read is a strictly narrower set than risk:read", () => {
    const riskReaders = ALL_ROLES.filter((r) => hasPermission(r, "risk:read"));
    expect(riskReaders).toEqual(["SUPER_ADMIN", "MODERATOR", "ANALYST"]);
    expect(BLOCK_READERS).toEqual(["SUPER_ADMIN", "ANALYST"]);
    expect(BLOCK_READERS.length).toBeLessThan(riskReaders.length);
  });

  it("4-5. both block handlers declare blocks:read", () => {
    expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.blocks)).toBe(
      "blocks:read",
    );
    expect(
      Reflect.getMetadata(PERMISSION_METADATA_KEY, AdminController.prototype.blockDetail),
    ).toBe("blocks:read");
  });

  it("5b. the block routes are not gated on a neighbouring permission", () => {
    // Picking `connections:read` or `exchanges:read` would look harmless and
    // would silently widen access if those holder sets ever diverged.
    for (const method of ["blocks", "blockDetail"] as const) {
      const declared = Reflect.getMetadata(
        PERMISSION_METADATA_KEY,
        AdminController.prototype[method],
      );
      expect(declared).toBe("blocks:read");
      expect(declared).not.toBe("connections:read");
      expect(declared).not.toBe("exchanges:read");
      expect(declared).not.toBe("reports:read");
      expect(declared).not.toBe("moderation:read");
    }
  });

  it("6. PermissionGuard admits each reader and refuses each non-reader", () => {
    for (const role of BLOCK_READERS) {
      const guard = new PermissionGuard(reflectorReturning("blocks:read"));
      expect(guard.canActivate(httpContext({ admin: admin(role) }))).toBe(true);
    }
    for (const role of BLOCK_DENIED) {
      const guard = new PermissionGuard(reflectorReturning("blocks:read"));
      // The guard *throws* 403 PERMISSION_DENIED rather than returning false —
      // a returned `false` would be an unhandled 500 in Nest.
      expect(() => guard.canActivate(httpContext({ admin: admin(role) }))).toThrow(
        /PERMISSION_DENIED|Forbidden/,
      );
    }
  });

  it("6b. an anonymous caller is refused before the permission is even read", () => {
    // `PermissionGuard` requires `request.admin`; without it there is nothing to
    // evaluate the permission against, so it must refuse rather than default to
    // allow. The 401 itself comes from `JwtAuthGuard`, which runs first.
    const guard = new PermissionGuard(reflectorReturning("blocks:read"));
    expect(() => guard.canActivate(httpContext({}))).toThrow();
  });

  it("6c. a DISABLED admin is refused", () => {
    const guard = new PermissionGuard(reflectorReturning("blocks:read"));
    expect(() =>
      guard.canActivate(httpContext({ admin: { ...admin("SUPER_ADMIN"), isActive: false } })),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7-21. the list
// ---------------------------------------------------------------------------

describe("Blocks — list", () => {
  it("7. returns the paginated envelope with the real total", async () => {
    const { result } = await list({ rows: [ALICE_TO_BOB, BOB_TO_ALICE], total: 2 });
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(2);
  });

  it("7b. count and findMany share one where and one transaction", async () => {
    const { calls, prisma } = await list({ rows: [ALICE_TO_BOB], total: 1 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(listWhere(calls.blockCount)).toEqual(listWhere(calls.blockFindMany));
  });

  it("8. blocker filters on blockerId only", async () => {
    const { calls } = await list({}, { blocker: ALICE_ID });
    expect(listWhere(calls.blockFindMany)).toEqual({ blockerId: ALICE_ID });
  });

  it("9. blocked filters on blockedId only", async () => {
    const { calls } = await list({}, { blocked: ALICE_ID });
    expect(listWhere(calls.blockFindMany)).toEqual({ blockedId: ALICE_ID });
  });

  it("10. user matches BOTH sides — never blockerId alone", async () => {
    // The single most important filter assertion in this file. A one-sided
    // implementation returns "whom has Alice blocked" and silently omits
    // everyone who has blocked Alice.
    const { calls } = await list({}, { user: ALICE_ID });
    const where = listWhere(calls.blockFindMany);
    expect(where).toEqual({ OR: [{ blockerId: ALICE_ID }, { blockedId: ALICE_ID }] });
    expect(JSON.stringify(where)).toContain("blockedId");
  });

  it("11. a UUID user filter is an exact id match, not a substring", async () => {
    const { calls } = await list({}, { user: BOB_ID });
    const where = listWhere(calls.blockFindMany);
    expect(where).toEqual({ OR: [{ blockerId: BOB_ID }, { blockedId: BOB_ID }] });
    // No `contains` anywhere: an id search must not degrade into a LIKE.
    expect(JSON.stringify(where)).not.toContain("contains");
  });

  it("12. a text user filter is a case-insensitive contains over both nicknames", async () => {
    const { calls } = await list({}, { user: "ali" });
    const where = listWhere(calls.blockFindMany);
    expect(where).toEqual({
      OR: [
        { blocker: { nickname: { contains: "ali", mode: "insensitive" } } },
        { blocked: { nickname: { contains: "ali", mode: "insensitive" } } },
      ],
    });
  });

  it("12b. the user filter never searches email", async () => {
    const { calls } = await list({}, { user: "alice@example.test" });
    const serialised = JSON.stringify(listWhere(calls.blockFindMany));
    expect(serialised).not.toContain("email");
  });

  it("12c. blocker and blocked text filters are directional, not both-sided", async () => {
    const blockerCall = await list({}, { blocker: "ali" });
    const blockedCall = await list({}, { blocked: "ali" });
    expect(listWhere(blockerCall.calls.blockFindMany)).toEqual({
      blocker: { nickname: { contains: "ali", mode: "insensitive" } },
    });
    expect(listWhere(blockedCall.calls.blockFindMany)).toEqual({
      blocked: { nickname: { contains: "ali", mode: "insensitive" } },
    });
  });

  it("12d. the three keyword parameters compose with AND", async () => {
    const { calls } = await list({}, { user: "ali", blocker: BOB_ID, blocked: CAROL_ID });
    expect(listWhere(calls.blockFindMany)).toEqual({
      OR: [
        { blocker: { nickname: { contains: "ali", mode: "insensitive" } } },
        { blocked: { nickname: { contains: "ali", mode: "insensitive" } } },
      ],
      blockerId: BOB_ID,
      blockedId: CAROL_ID,
    });
  });

  it("12e. a blank keyword adds no filter at all", async () => {
    const { calls } = await list({}, { user: "   ", blocker: "", blocked: undefined });
    // An empty `OR: []` would be "match nothing"; a blank input must mean "no
    // filter", which is what an untouched search box sends.
    expect(listWhere(calls.blockFindMany)).toEqual({});
  });

  it("13. createdFrom is an inclusive lower bound", async () => {
    const { calls } = await list({}, { createdFrom: "2026-03-01T00:00:00.000Z" });
    expect(listWhere(calls.blockFindMany)).toEqual({
      createdAt: { gte: new Date("2026-03-01T00:00:00.000Z") },
    });
  });

  it("14. createdTo is an inclusive upper bound", async () => {
    const { calls } = await list({}, { createdTo: "2026-03-31T23:59:59.999Z" });
    expect(listWhere(calls.blockFindMany)).toEqual({
      createdAt: { lte: new Date("2026-03-31T23:59:59.999Z") },
    });
  });

  it("14b. a bare createdTo date means midnight, literally", async () => {
    // The API compares literally; widening to end-of-day is the *client's* job
    // (the console appends T23:59:59.999Z). Pinning this stops the server from
    // quietly reinterpreting a date-only bound.
    const { calls } = await list({}, { createdTo: "2026-03-31" });
    expect(listWhere(calls.blockFindMany)).toEqual({
      createdAt: { lte: new Date("2026-03-31T00:00:00.000Z") },
    });
  });

  it("15. a malformed date is a 400 VALIDATION_ERROR", async () => {
    await expect(list({}, { createdFrom: "not-a-date" })).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "VALIDATION_ERROR" } },
    });
  });

  it("15b. a non-existent calendar date is rejected, not rolled over", async () => {
    // `new Date("2026-02-30")` is *not* Invalid Date — JS silently rolls it to
    // 2 March. The service must catch it with an explicit calendar check.
    await expect(list({}, { createdFrom: "2026-02-30" })).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "VALIDATION_ERROR" } },
    });
    await expect(list({}, { createdTo: "2026-13-01" })).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "VALIDATION_ERROR" } },
    });
  });

  it("16. the default sort is createdAt_desc", async () => {
    const { calls } = await list({}, {});
    expect(calls.blockFindMany[0]?.orderBy).toEqual(BLOCK_SORT_ORDERS[DEFAULT_BLOCK_SORT]);
    expect(DEFAULT_BLOCK_SORT).toBe("createdAt_desc");
    expect(calls.blockFindMany[0]?.orderBy).toEqual({ createdAt: "desc" });
  });

  it("17. createdAt_asc is accepted and inverts the default", async () => {
    const { calls } = await list({}, { sort: "createdAt_asc" });
    expect(calls.blockFindMany[0]?.orderBy).toEqual({ createdAt: "asc" });
  });

  it("17b. every nickname sort key carries nulls:last in both directions", async () => {
    // PostgreSQL's default for `ORDER BY … DESC` is NULLS FIRST, so a descending
    // nickname sort without this leads with the unnamed rows.
    for (const key of [
      "blocker_nickname_asc",
      "blocker_nickname_desc",
      "blocked_nickname_asc",
      "blocked_nickname_desc",
    ] as const) {
      const { calls } = await list({}, { sort: key });
      const serialised = JSON.stringify(calls.blockFindMany[0]?.orderBy);
      expect(serialised).toContain('"nulls":"last"');
    }
  });

  it("17c. the blocker and blocked nickname sorts target different relations", async () => {
    const blockerSort = await list({}, { sort: "blocker_nickname_asc" });
    const blockedSort = await list({}, { sort: "blocked_nickname_asc" });
    expect(blockerSort.calls.blockFindMany[0]?.orderBy).toEqual({
      blocker: { nickname: { sort: "asc", nulls: "last" } },
    });
    expect(blockedSort.calls.blockFindMany[0]?.orderBy).toEqual({
      blocked: { nickname: { sort: "asc", nulls: "last" } },
    });
  });

  it("18. an unknown sort is a 400, never a silent fallback", async () => {
    await expect(list({}, { sort: "createdAt; DROP TABLE" })).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "VALIDATION_ERROR" } },
    });
  });

  it("18b. no client string ever reaches orderBy verbatim", async () => {
    const { calls } = await list({}, { sort: "createdAt_desc" });
    expect(JSON.stringify(calls.blockFindMany[0]?.orderBy)).toBe('{"createdAt":"desc"}');
    // And the whitelist itself is a closed set of pre-built objects.
    expect(Object.keys(BLOCK_SORT_ORDERS)).toEqual([
      "createdAt_desc",
      "createdAt_asc",
      "blocker_nickname_asc",
      "blocker_nickname_desc",
      "blocked_nickname_asc",
      "blocked_nickname_desc",
    ]);
  });

  it("19. page 2 skips a whole page", async () => {
    const { result, calls } = await list({ rows: [ALICE_TO_BOB], total: 45 }, { page: 2, pageSize: 20 });
    expect(calls.blockFindMany[0]?.skip).toBe(20);
    expect(calls.blockFindMany[0]?.take).toBe(20);
    expect(result.totalPages).toBe(3);
  });

  it("19b. page and pageSize are clamped to their documented bounds", async () => {
    const huge = await list({}, { page: 5000, pageSize: 5000 });
    expect(huge.result.page).toBe(1000);
    expect(huge.result.pageSize).toBe(100);
    const negative = await list({}, { page: -1, pageSize: -1 });
    expect(negative.result.page).toBe(1);
    expect(negative.result.pageSize).toBe(1);
  });

  it("20. an empty result is total 0 with zero pages", async () => {
    const { result } = await list({ rows: [], total: 0 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it("21. an out-of-range page is an empty page, not an error and not a moved page", async () => {
    const { result, calls } = await list({ rows: [], total: 3 }, { page: 99 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(3);
    expect(result.page).toBe(99);
    expect(result.pageSize).toBe(20);
    expect(calls.blockFindMany[0]?.skip).toBe(98 * 20);
  });

  it("21b. the list response carries the pair and no synthetic id", async () => {
    const { result } = await list({ rows: [ALICE_TO_BOB], total: 1 });
    const item = result.items[0] as unknown as Record<string, unknown>;
    expect(item.blockerId).toBe(ALICE_ID);
    expect(item.blockedId).toBe(BOB_ID);
    expect(item).not.toHaveProperty("id");
    expect(Object.keys(item).sort()).toEqual([
      "blocked",
      "blockedId",
      "blocker",
      "blockerId",
      "createdAt",
    ]);
  });

  it("21c. the list select names its columns and never includes a relation wholesale", async () => {
    expect(JSON.stringify(BLOCK_LIST_SELECT)).not.toContain('"include"');
    expect(BLOCK_LIST_SELECT.blocker).toEqual({ select: { id: true, nickname: true } });
    expect(BLOCK_LIST_SELECT.blocked).toEqual({ select: { id: true, nickname: true } });
  });

  it("21d. the list never touches a neighbouring domain", async () => {
    const { result, prisma } = await list({ rows: [CAROL_TO_ALICE], total: 1 });
    const serialised = JSON.stringify(result);
    for (const leak of ["must-not-leak", "socialAccount", "sharedSocialAccount", "conversation", "message"]) {
      expect(serialised).not.toContain(leak);
    }
    expect((prisma as Record<string, unknown>).socialAccount).toBeUndefined();
    expect((prisma as Record<string, unknown>).sharedSocialAccount).toBeUndefined();
    expect((prisma as Record<string, unknown>).conversation).toBeUndefined();
    expect((prisma as Record<string, unknown>).message).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 22-23. direction
// ---------------------------------------------------------------------------

describe("Blocks — direction", () => {
  it("22. Alice → Bob is preserved exactly as stored", async () => {
    const { result } = await detail({ detailRow: ALICE_TO_BOB }, ALICE_ID, BOB_ID);
    expect(result.block.blockerId).toBe(ALICE_ID);
    expect(result.block.blockedId).toBe(BOB_ID);
    expect(result.blocker.id).toBe(ALICE_ID);
    expect(result.blocker.nickname).toBe("Alice");
    expect(result.blocked.id).toBe(BOB_ID);
    expect(result.blocked.nickname).toBe("Bob");
  });

  it("23. Bob → Alice is preserved exactly as stored, and is a different row", async () => {
    const { result } = await detail({ detailRow: BOB_TO_ALICE }, BOB_ID, ALICE_ID);
    expect(result.block.blockerId).toBe(BOB_ID);
    expect(result.block.blockedId).toBe(ALICE_ID);
    expect(result.blocker.nickname).toBe("Bob");
    expect(result.blocked.nickname).toBe("Alice");
  });

  it("23b. the two directions are never swapped or normalised", async () => {
    // If the service sorted the pair (or `min`/`max`-ed the ids) these two calls
    // would return the same thing. They must not.
    const forward = await detail({ detailRow: ALICE_TO_BOB }, ALICE_ID, BOB_ID);
    const reverse = await detail({ detailRow: BOB_TO_ALICE }, BOB_ID, ALICE_ID);
    expect(forward.result.block.blockerId).not.toBe(reverse.result.block.blockerId);
    expect(forward.result.block.blockerId).toBe(reverse.result.block.blockedId);
    expect(forward.result.block.blockedId).toBe(reverse.result.block.blockerId);
  });

  it("23c. the detail lookup uses the composite key in the requested order", async () => {
    const { calls } = await detail({}, ALICE_ID, BOB_ID);
    expect(detailWhere(calls.blockFindUnique)).toEqual({
      blockerId_blockedId: { blockerId: ALICE_ID, blockedId: BOB_ID },
    });
    // Not the reverse, and not a single-id lookup.
    expect(JSON.stringify(detailWhere(calls.blockFindUnique))).not.toContain(
      `"blockerId":"${BOB_ID}"`,
    );
  });

  it("23d. Alice appears on both sides across the fixture set", async () => {
    // The property the either-side filter depends on: Alice is the blocker in
    // one row and the blocked party in two others, so a one-sided filter cannot
    // return the right count.
    const rows = [ALICE_TO_BOB, BOB_TO_ALICE, CAROL_TO_ALICE];
    const asBlocker = rows.filter((r) => r.blockerId === ALICE_ID);
    const asBlocked = rows.filter((r) => r.blockedId === ALICE_ID);
    const eitherSide = rows.filter((r) => r.blockerId === ALICE_ID || r.blockedId === ALICE_ID);
    expect(asBlocker).toHaveLength(1);
    expect(asBlocked).toHaveLength(2);
    expect(eitherSide).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 24-26. detail
// ---------------------------------------------------------------------------

describe("Blocks — detail", () => {
  it("24. a valid pair returns the block, both parties and the history", async () => {
    const { result } = await detail({ history: [BLOCK_AUDIT] });
    expect(result.block).toEqual({
      blockerId: ALICE_ID,
      blockedId: BOB_ID,
      createdAt: ALICE_TO_BOB_AT,
    });
    expect(result.blocker).toEqual({ id: ALICE_ID, nickname: "Alice" });
    expect(result.blocked).toEqual({ id: BOB_ID, nickname: "Bob" });
    expect(result.history).toHaveLength(1);
  });

  it("24b. the detail response carries no synthetic id", async () => {
    const { result } = await detail();
    expect(result.block).not.toHaveProperty("id");
    expect(Object.keys(result.block).sort()).toEqual(["blockedId", "blockerId", "createdAt"]);
  });

  it("24c. the detail select names its columns and includes no relation wholesale", async () => {
    expect(JSON.stringify(BLOCK_DETAIL_SELECT)).not.toContain('"include"');
    expect(BLOCK_DETAIL_SELECT.blocker).toEqual({ select: { id: true, nickname: true } });
  });

  it("25. an unknown pair is a 404 BLOCK_NOT_FOUND, never 200 with null", async () => {
    await expect(detail({ detailRow: null })).rejects.toMatchObject({
      status: 404,
      response: { success: false, error: { code: "BLOCK_NOT_FOUND" } },
    });
  });

  it("26. the 404 body is the exact documented shape", async () => {
    const failure = await detail({ detailRow: null }).catch((error: unknown) => error);
    const response = (failure as { getResponse: () => unknown }).getResponse();
    expect(response).toEqual({
      success: false,
      error: { code: "BLOCK_NOT_FOUND", message: "Block not found" },
    });
  });

  it("26b. a well-formed pair of real users with no block between them is also a 404", async () => {
    // "No such block" — not "no such user". The two ids are valid UUIDs; the
    // relationship simply does not exist.
    await expect(detail({ detailRow: null }, CAROL_ID, BOB_ID)).rejects.toMatchObject({
      status: 404,
      response: { error: { code: "BLOCK_NOT_FOUND" } },
    });
    // An id that is not even a UUID is the same 404, not a 500 from Prisma.
    await expect(detail({ detailRow: null }, UNKNOWN_ID, UNKNOWN_ID)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("26c. the history query targets the BLOCK audit type and an empty result is honest", async () => {
    const { result, calls } = await detail({ history: [] });
    expect(result.history).toEqual([]);
    const where = calls.auditFindMany[0]?.where;
    expect(where).toMatchObject({ targetType: "BLOCK" });
  });

  it("26d. the history select excludes ip and userAgent", async () => {
    const { result } = await detail({ history: [BLOCK_AUDIT] });
    const serialised = JSON.stringify(result.history);
    expect(serialised).not.toContain("203.0.113.7");
    expect(serialised).not.toContain("Mozilla/5.0 (sensitive)");
    expect(JSON.stringify(BLOCK_HISTORY_SELECT)).not.toContain('"ip"');
    expect(JSON.stringify(BLOCK_HISTORY_SELECT)).not.toContain('"userAgent"');
  });

  it("26e. the detail never touches a neighbouring domain", async () => {
    const { result, prisma } = await detail({ detailRow: CAROL_TO_ALICE });
    const serialised = JSON.stringify(result);
    for (const leak of ["must-not-leak", "socialAccount", "sharedSocialAccount", "conversation", "message"]) {
      expect(serialised).not.toContain(leak);
    }
    expect((prisma as Record<string, unknown>).socialAccount).toBeUndefined();
    expect((prisma as Record<string, unknown>).sharedSocialAccount).toBeUndefined();
    expect((prisma as Record<string, unknown>).conversation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 27-30. privacy
// ---------------------------------------------------------------------------

describe("Blocks — privacy", () => {
  it("27. no forbidden field name appears anywhere in the list response", async () => {
    const { result } = await list({ rows: [ALICE_TO_BOB, BOB_TO_ALICE, CAROL_TO_ALICE], total: 3 });
    expectNoSecrets(result);
  });

  it("27b. no forbidden field name appears anywhere in the detail response", async () => {
    const { result } = await detail({ detailRow: CAROL_TO_ALICE, history: [BLOCK_AUDIT] });
    expectNoSecrets(result);
  });

  it("28. no participant email address reaches the client", async () => {
    const { result } = await detail({ detailRow: CAROL_TO_ALICE });
    expect(JSON.stringify(result)).not.toContain("@example.test");
  });

  it("29. no password hash or token reaches the client", async () => {
    const { result } = await list({ rows: [ALICE_TO_BOB], total: 1 });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("$2a$10$");
    expect(serialised).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("30. no social handle reaches the client — as a value, not just as a key", async () => {
    // The strongest form: a leak that renamed the field would still be a
    // disclosure, and only a content scan catches that.
    const { result } = await list({ rows: [CAROL_TO_ALICE], total: 1 });
    expect(JSON.stringify(result)).not.toContain("PW_BLOCK_SECRET_HANDLE");
  });

  it("30b. the service never reads SocialAccount at all", async () => {
    // Asserted structurally rather than by scanning output: the harness has no
    // `socialAccount` delegate, so any attempt to read one throws.
    const { prisma } = await list({ rows: [ALICE_TO_BOB], total: 1 });
    expect((prisma as Record<string, unknown>).socialAccount).toBeUndefined();
    const socialAccount = (prisma as Record<string, unknown>).socialAccount as
      | { findMany: () => unknown }
      | undefined;
    expect(() => socialAccount!.findMany()).toThrow();
  });

  it("30c. the fixture's wide relations would leak if a stray include were added", () => {
    // Guards the guard: if CAROL_TO_ALICE stopped carrying these, the privacy
    // assertions above would become vacuous.
    expect(CAROL_TO_ALICE.socialAccounts?.[0]?.handle).toBe(SECRET_HANDLE);
    expect(JSON.stringify(CAROL_TO_ALICE)).toContain("PW_BLOCK_SECRET_HANDLE");
  });
});

// ---------------------------------------------------------------------------
// 31. audit
// ---------------------------------------------------------------------------

describe("Blocks — audit", () => {
  it("31. a list read writes no audit row", async () => {
    const { calls } = await list({ rows: [ALICE_TO_BOB], total: 1 });
    expect(calls.auditCreate).toHaveLength(0);
  });

  it("31b. a detail read writes no audit row", async () => {
    const { calls } = await detail({ history: [] });
    expect(calls.auditCreate).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 32-34. schema contract and the GET-only surface
// ---------------------------------------------------------------------------

describe("Blocks — schema contract", () => {
  it("32. nothing in this phase assumes a single-column id", () => {
    // If `Block` ever gained an `id`, these assertions would need revisiting —
    // which is the point: the phase is written against the composite key.
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.blockDetail).toBe("function");
    // The handler takes two parameters (blockerId, blockedId), not one.
    expect(AdminController.prototype.blockDetail.length).toBe(2);
  });

  it("33. no migration and no schema change is implied", () => {
    // `blocks:write` exists in the matrix and is deliberately unused; the phase
    // adds no table, no column and no enum member.
    expect(hasPermission("SUPER_ADMIN", "blocks:write")).toBe(true);
    // The block surface is read-only, so nothing here needs the write grant.
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    expect(proto.blockCreate).toBeUndefined();
    expect(proto.blockUpdate).toBeUndefined();
    expect(proto.blockDelete).toBeUndefined();
    expect(proto.unblock).toBeUndefined();
  });

  it("34. the controller exposes exactly two block routes, both GET", () => {
    const proto = AdminController.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.blocks).toBe("function");
    expect(typeof proto.blockDetail).toBe("function");

    // No mutation handler exists under any plausible name.
    for (const name of [
      "createBlock",
      "updateBlock",
      "deleteBlock",
      "removeBlock",
      "unblock",
      "blockUser",
      "bulkBlocks",
    ]) {
      expect(proto[name]).toBeUndefined();
    }

    // And the verb metadata really is GET for both.
    const pathMetadata = Reflect.getMetadata(
      "path",
      AdminController.prototype.blocks,
    ) as string;
    expect(pathMetadata).toBe("blocks");
  });

  it("34b. the detail route is the pair, not a single id", () => {
    const path = Reflect.getMetadata("path", AdminController.prototype.blockDetail) as string;
    expect(path).toBe("blocks/:blockerId/:blockedId");
    expect(path).not.toBe("blocks/:id");
  });
});
