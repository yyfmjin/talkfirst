import * as bcrypt from "bcryptjs";
import { makeAuthService } from "./auth-service.fixture";
import { sha256Hex } from "../common/crypto";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

/**
 * SEC-003-B — refresh-token reuse detection and race-safe rotation.
 *
 * These tests run against a small in-memory model of `RefreshToken` rather than
 * a bag of `jest.fn()`s, because the behaviour under test *is* the interaction
 * between rows: a conditional claim, a transaction that rolls its own successor
 * back, and a replay that tears the whole family down. A mock that just asserts
 * "create was called" cannot express any of that.
 */

type Row = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  createdAt: Date;
};

type RecordedEvent = {
  type: string;
  userId?: string;
  success?: boolean;
  riskLevel?: string;
  detail?: Record<string, unknown>;
};

const USER = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: "hash",
  emailVerified: true,
  status: "ACTIVE",
  isAdmin: false,
  nickname: "Alice",
  avatarUrl: null,
  birthDate: null,
  countryCode: null,
  city: null,
  gender: "UNKNOWN",
  bio: null,
  createdAt: new Date(),
  lastActiveAt: new Date(),
};

type Refusal = { code: string | null; status: number | null };

async function refusal(op: Promise<unknown>): Promise<Refusal> {
  try {
    await op;
    return { code: null, status: null };
  } catch (error) {
    const typed = error as {
      getResponse?: () => { error?: { code?: string } };
      getStatus?: () => number;
    };
    return {
      code: typed.getResponse?.()?.error?.code ?? null,
      status: typed.getStatus?.() ?? null,
    };
  }
}

function makeHarness() {
  const rows = new Map<string, Row>();
  const events: RecordedEvent[] = [];
  let seq = 0;
  const nextId = () => `rt-${++seq}`;

  /** Inserts a live token and returns its row. */
  const seed = (raw: string, patch: Partial<Row> = {}): Row => {
    const row: Row = {
      id: nextId(),
      userId: USER.id,
      tokenHash: sha256Hex(raw),
      expiresAt: new Date(Date.now() + 3_600_000),
      revokedAt: null,
      replacedById: null,
      createdAt: new Date(),
      ...patch,
    };
    rows.set(row.id, row);
    return row;
  };

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined && where.id !== row.id) return false;
    if (where.userId !== undefined && where.userId !== row.userId) return false;
    if (where.tokenHash !== undefined && where.tokenHash !== row.tokenHash) return false;
    if (where.revokedAt === null && row.revokedAt !== null) return false;
    return true;
  };

  /**
   * A transaction client. `pendingCreates` records rows this transaction made so
   * a rollback can remove exactly them — the analogue of an aborted transaction
   * discarding its own inserts, without unwinding anyone else's committed work.
   */
  const client = (pendingCreates: string[]) => ({
    refreshToken: {
      create: jest.fn(
        async (args: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
          const row: Row = {
            id: nextId(),
            userId: args.data.userId,
            tokenHash: args.data.tokenHash,
            expiresAt: args.data.expiresAt,
            revokedAt: null,
            replacedById: null,
            createdAt: new Date(),
          };
          rows.set(row.id, row);
          pendingCreates.push(row.id);
          return { ...row };
        },
      ),
      findUnique: jest.fn(async (args: { where: { tokenHash: string } }) => {
        for (const row of rows.values()) {
          if (row.tokenHash === args.where.tokenHash) return { ...row, user: { ...USER } };
        }
        return null;
      }),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async (args: { where: Record<string, unknown>; data: Partial<Row> }) => {
        let count = 0;
        for (const row of rows.values()) {
          if (matches(row, args.where)) {
            Object.assign(row, args.data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    user: {
      findUnique: jest.fn(async () => ({ ...USER })),
      update: jest.fn(async () => ({ ...USER })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  });

  const prisma = {
    // Top-level client (outside any transaction), used by reuse revocation and
    // by `changePassword`'s array-form transaction.
    ...client([]),
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        const pendingCreates: string[] = [];
        const tx = client(pendingCreates);
        try {
          return await (arg as (t: unknown) => Promise<unknown>)(tx);
        } catch (error) {
          for (const id of pendingCreates) rows.delete(id);
          throw error;
        }
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };

  const service = makeAuthService(
    prisma as never,
    { signAsync: jest.fn(async () => "access-token") } as never,
    {
      securityEvents: {
        record: jest.fn(async (event: RecordedEvent) => {
          events.push(event);
        }),
      },
    },
  );

  return { service, prisma, rows, seed, events };
}

/** The single live row, if any. */
function liveRows(rows: Map<string, Row>): Row[] {
  return [...rows.values()].filter((row) => row.revokedAt === null);
}

function eventOfType(events: RecordedEvent[], type: string): RecordedEvent | undefined {
  return events.find((event) => event.type === type);
}

describe("SEC-003-B — refresh token rotation and reuse detection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("1. normal rotation: A -> B, A.revokedAt set, A.replacedById = B.id, B is usable", async () => {
    const { service, rows, seed } = makeHarness();
    const a = seed("raw-a");

    const session = await service.rotateRefresh("raw-a");

    const aRow = rows.get(a.id) as Row;
    expect(aRow.revokedAt).toBeInstanceOf(Date);
    const successor = liveRows(rows).find(
      (row) => row.tokenHash === sha256Hex(session.refreshToken),
    );
    expect(successor).toBeDefined();
    expect(aRow.replacedById).toBe((successor as Row).id);

    // The successor is fully usable.
    const next = await service.rotateRefresh(session.refreshToken);
    expect(next).toMatchObject({ accessToken: "access-token" });
  });

  it("2. replaying a rotated token -> TOKEN_REUSE_DETECTED (401) and every live session is revoked", async () => {
    const { service, rows, seed, events } = makeHarness();
    seed("raw-a");
    const other = seed("raw-other-device");

    await service.rotateRefresh("raw-a"); // A -> B
    const result = await refusal(service.rotateRefresh("raw-a")); // replay A

    expect(result.code).toBe("TOKEN_REUSE_DETECTED");
    expect(result.status).toBe(401);
    // Every live token, including the one minted by the legitimate rotation and
    // the other device's, is now revoked.
    expect(liveRows(rows)).toHaveLength(0);
    expect((rows.get(other.id) as Row).revokedAt).toBeInstanceOf(Date);

    // No token material reaches the audit trail.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("raw-a");
    expect(serialized).not.toContain(sha256Hex("raw-a"));
  });

  it("3. a logged-out token is INVALID_REFRESH_TOKEN, never TOKEN_REUSE_DETECTED", async () => {
    const { service, rows, seed } = makeHarness();
    const a = seed("raw-a");

    await service.logout("raw-a");
    const aRow = rows.get(a.id) as Row;
    expect(aRow.revokedAt).toBeInstanceOf(Date);
    expect(aRow.replacedById).toBeNull();

    const result = await refusal(service.rotateRefresh("raw-a"));
    expect(result.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("4. a password-change-revoked token is INVALID_REFRESH_TOKEN, never TOKEN_REUSE_DETECTED", async () => {
    const { service, rows, seed } = makeHarness();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    const a = seed("raw-a");

    await service.changePassword(USER.id, {
      currentPassword: "oldpassword",
      newPassword: "newpassword1",
      confirmPassword: "newpassword1",
    });

    const aRow = rows.get(a.id) as Row;
    expect(aRow.revokedAt).toBeInstanceOf(Date);
    expect(aRow.replacedById).toBeNull();

    const result = await refusal(service.rotateRefresh("raw-a"));
    expect(result.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("5. concurrent rotation of the same token: exactly one successor wins", async () => {
    const { service, rows, seed } = makeHarness();
    const a = seed("raw-a");

    const settled = await Promise.allSettled([
      service.rotateRefresh("raw-a"),
      service.rotateRefresh("raw-a"),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Exactly one live successor exists — never A -> B and A -> C.
    const live = liveRows(rows);
    expect(live).toHaveLength(1);
    const aRow = rows.get(a.id) as Row;
    expect(aRow.revokedAt).toBeInstanceOf(Date);
    expect(aRow.replacedById).toBe(live[0].id);

    const rejection = rejected[0] as PromiseRejectedResult;
    const typed = rejection.reason as { getResponse?: () => { error?: { code?: string } } };
    expect(typed.getResponse?.()?.error?.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("6. the losing rotation leaves no usable successor behind", async () => {
    const { service, rows, seed } = makeHarness();
    const a = seed("raw-a");

    await Promise.allSettled([
      service.rotateRefresh("raw-a"),
      service.rotateRefresh("raw-a"),
    ]);

    // One live token total: the winner's. The loser's insert was rolled back, so
    // it is neither live nor present at all.
    expect(liveRows(rows)).toHaveLength(1);
    // A itself is revoked and points at that winner.
    expect((rows.get(a.id) as Row).revokedAt).toBeInstanceOf(Date);
  });

  it("7/8/9. reuse emits SESSION_REVOKED and TOKEN_REFRESH_FAILED", async () => {
    const { service, events, seed } = makeHarness();
    seed("raw-a");

    await service.rotateRefresh("raw-a");
    await refusal(service.rotateRefresh("raw-a"));

    const revoked = eventOfType(events, "SESSION_REVOKED");
    expect(revoked).toBeDefined();
    expect(revoked?.detail).toMatchObject({ reason: "refresh_token_reuse" });
    expect(revoked?.detail?.revokedCount).toBeGreaterThanOrEqual(1);

    const refreshFailed = eventOfType(events, "TOKEN_REFRESH_FAILED");
    expect(refreshFailed).toBeDefined();
    expect(refreshFailed?.detail?.reasonCode).toBe("TOKEN_REUSE_DETECTED");

    // The audit detail never carries a token, a hash or the successor reference.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("raw-a");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("replacedById");
  });

  it("reuse detection revokes a token minted by an earlier, unrelated rotation (multi-device)", async () => {
    const { service, rows, seed } = makeHarness();
    const deviceA = seed("raw-a");
    const deviceB = seed("raw-b");

    await service.rotateRefresh("raw-b"); // device B legitimately rotates
    const liveBeforeReuse = liveRows(rows);
    // Device A's untouched token plus device B's freshly minted successor.
    expect(liveBeforeReuse).toHaveLength(2);

    await refusal(service.rotateRefresh("raw-b")); // replay B
    // Reuse tears down every live session, including the untouched device.
    expect(liveRows(rows)).toHaveLength(0);
    expect((rows.get(deviceB.id) as Row).revokedAt).toBeInstanceOf(Date);
    expect((rows.get(deviceA.id) as Row).revokedAt).toBeInstanceOf(Date);
  });
});
