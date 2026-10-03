import * as bcrypt from "bcryptjs";
import { makeAuthService } from "./auth-service.fixture";
import { JwtStrategy } from "./jwt.strategy";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

/**
 * SEC-002 — the account-status rule is one rule, not two.
 *
 * Before this fix `login`/`rotateRefresh` refused only `BANNED`, while
 * `JwtStrategy` refused every non-`ACTIVE` state. A `DISABLED` or `SUSPENDED`
 * account could therefore log in, receive a session, and then 401 on every
 * subsequent authenticated call. These tests pin the shared behaviour across
 * all four statuses for both token-minting paths, and cross-check that the same
 * status produces the same verdict at the guard.
 */

const ACTIVE_USER = {
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

const STATUSES = ["ACTIVE", "DISABLED", "SUSPENDED", "BANNED"] as const;
type Status = (typeof STATUSES)[number];

/** The expected refusal code per status, matching `JwtStrategy` (SEC-002). */
const REFUSAL_CODE: Record<Status, string | null> = {
  ACTIVE: null,
  DISABLED: "USER_DISABLED",
  SUSPENDED: "USER_DISABLED",
  BANNED: "USER_BANNED",
};

const LOGIN_DTO = { email: ACTIVE_USER.email, password: "sup3rsecret!" };

/** Reads the error code out of the shared `{ success:false, error:{ code } }` envelope. */
async function refusalCode(op: Promise<unknown>): Promise<string | null> {
  try {
    await op;
    return null;
  } catch (error) {
    const response = (
      error as { getResponse?: () => { error?: { code?: string } } }
    ).getResponse?.();
    return response?.error?.code ?? null;
  }
}

function makeAuth(prismaOverride: Record<string, unknown> = {}) {
  const prisma: {
    user: Record<string, jest.Mock>;
    refreshToken: Record<string, jest.Mock>;
    $transaction: jest.Mock;
    [key: string]: unknown;
  } = {
    user: {
      findUnique: jest.fn().mockResolvedValue(ACTIVE_USER),
      update: jest.fn().mockResolvedValue(ACTIVE_USER),
      create: jest.fn().mockResolvedValue(ACTIVE_USER),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: "rt-new" }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // Supports both Prisma forms: the array form (changePassword) and the
    // interactive callback form (rotateRefresh). Wired after construction so the
    // callback can close over `prisma` without a circular type.
    $transaction: jest.fn(),
    ...prismaOverride,
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
  const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
  const service = makeAuthService(prisma as never, jwtService as never, {
    securityEvents: { record: jest.fn(async () => undefined) },
  });
  return { service, prisma };
}

/** A live refresh-token row whose owning account carries the given status. */
function refreshRow(status: Status) {
  return {
    id: "rt-1",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    user: { ...ACTIVE_USER, status },
  };
}

describe("SEC-002 — 只有 ACTIVE 账号可以拿到会话", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hash");
  });

  describe("login", () => {
    it.each(STATUSES)("status=%s 的登录结果与 JwtStrategy 一致", async (status) => {
      const { service } = makeAuth({
        user: {
          findUnique: jest.fn().mockResolvedValue({ ...ACTIVE_USER, status }),
          update: jest.fn(),
          create: jest.fn(),
        },
      });

      const code = await refusalCode(service.login(LOGIN_DTO));
      expect(code).toBe(REFUSAL_CODE[status]);
    });
  });

  describe("rotateRefresh", () => {
    it.each(STATUSES)("status=%s 的刷新结果与 JwtStrategy 一致", async (status) => {
      const { service } = makeAuth({
        refreshToken: {
          create: jest.fn().mockResolvedValue({ id: "rt-new" }),
          findUnique: jest.fn().mockResolvedValue(refreshRow(status)),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });

      const code = await refusalCode(service.rotateRefresh("raw-refresh-token"));
      expect(code).toBe(REFUSAL_CODE[status]);
    });
  });

  describe("JwtStrategy 与登录/刷新共用同一状态语义", () => {
    it.each(STATUSES)("status=%s", async (status) => {
      const strategy = new JwtStrategy({
        user: { findUnique: jest.fn().mockResolvedValue({ ...ACTIVE_USER, status }) },
      } as never);

      const code = await refusalCode(strategy.validate({ sub: "user-1", email: ACTIVE_USER.email, type: "access" }));
      expect(code).toBe(REFUSAL_CODE[status]);
    });
  });

  it("ACTIVE 登录确实签发会话（对照组，防止上面的用例空通过）", async () => {
    const { service } = makeAuth();
    await expect(service.login(LOGIN_DTO)).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: expect.any(String),
    });
  });

  it("被停用/停权的账号不会写入 refresh token 记录", async () => {
    for (const status of ["DISABLED", "SUSPENDED", "BANNED"] as const) {
      jest.clearAllMocks();
      const { service, prisma } = makeAuth({
        user: {
          findUnique: jest.fn().mockResolvedValue({ ...ACTIVE_USER, status }),
          update: jest.fn(),
          create: jest.fn(),
        },
      });
      await expect(service.login(LOGIN_DTO)).rejects.toBeDefined();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    }
  });
});
