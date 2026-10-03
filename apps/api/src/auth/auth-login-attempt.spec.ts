import * as bcrypt from "bcryptjs";
import { runWithRequestContext } from "../security/request-context";
import { makeAuthService } from "./auth-service.fixture";
import { LoginAttemptService } from "./login-attempt.service";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

/**
 * SEC-001 — the account lock-out as wired into `AuthService.login`.
 *
 * The IP throttler keeps its own budget; these tests cover the layer that the IP
 * throttler cannot express: repeated guessing against one account, from anywhere.
 */

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

const LOGIN_DTO = { email: USER.email, password: "guess" };

async function refusalCode(op: Promise<unknown>): Promise<string | null> {
  try {
    await op;
    return null;
  } catch (error) {
    const response = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.();
    return response?.error?.code ?? null;
  }
}

function makeAuth(overrides: {
  user?: unknown;
  isAdmin?: boolean;
  now?: () => number;
} = {}) {
  const row = overrides.user === undefined
    ? { ...USER, isAdmin: overrides.isAdmin ?? USER.isAdmin }
    : overrides.user;
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: "rt" }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const events: Record<string, unknown>[] = [];
  const securityEvents = {
    record: jest.fn(async (event: Record<string, unknown>) => {
      events.push(event);
    }),
  };
  const loginAttempts = new LoginAttemptService(
    { maxFailures: 5, adminMaxFailures: 3, baseLockMs: 30_000, maxLockMs: 900_000, windowMs: 900_000 },
    overrides.now ?? Date.now,
  );
  const service = makeAuthService(
    prisma as never,
    { signAsync: jest.fn().mockResolvedValue("access-token") } as never,
    { securityEvents, loginAttempts },
  );
  return { service, prisma, events, loginAttempts };
}

describe("SEC-001 — 账号维度的登录暴力破解防护", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
  });

  it("连续 5 次密码错误后，第 6 次被临时锁定（429 / TOO_MANY_ATTEMPTS）", async () => {
    const { service } = makeAuth();

    for (let i = 0; i < 5; i += 1) {
      expect(await refusalCode(service.login(LOGIN_DTO))).toBe("INVALID_CREDENTIALS");
    }
    expect(await refusalCode(service.login(LOGIN_DTO))).toBe("TOO_MANY_ATTEMPTS");
  });

  it("换 IP 不能清除账号维度的失败次数（IP-A/B/C 各自尝试）", async () => {
    const { service } = makeAuth();
    const ips = ["203.0.113.10", "198.51.100.20", "192.0.2.30", "203.0.113.40", "198.51.100.50", "192.0.2.60"];

    const codes: (string | null)[] = [];
    for (const ip of ips) {
      // Each attempt arrives from a different address; the account budget must
      // not care, or a rotating attacker would never be stopped.
      codes.push(
        await runWithRequestContext({ requestId: `req-${ip}`, ip }, () =>
          refusalCode(service.login(LOGIN_DTO)),
        ),
      );
    }

    expect(codes.slice(0, 5)).toEqual([
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
      "INVALID_CREDENTIALS",
    ]);
    expect(codes[5]).toBe("TOO_MANY_ATTEMPTS");
  });

  it("锁定时多次调用结果一致", async () => {
    const { service } = makeAuth();
    for (let i = 0; i < 5; i += 1) await refusalCode(service.login(LOGIN_DTO));
    expect(await refusalCode(service.login(LOGIN_DTO))).toBe("TOO_MANY_ATTEMPTS");
    expect(await refusalCode(service.login(LOGIN_DTO))).toBe("TOO_MANY_ATTEMPTS");
  });

  it("锁定返回 HTTP 429，且不会写入 refresh token 记录", async () => {
    const { service, prisma } = makeAuth();
    for (let i = 0; i < 5; i += 1) await refusalCode(service.login(LOGIN_DTO));
    prisma.refreshToken.create.mockClear();

    try {
      await service.login(LOGIN_DTO);
      throw new Error("expected the locked login to reject");
    } catch (error) {
      expect((error as { getStatus?: () => number }).getStatus?.()).toBe(429);
    }
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("不存在的邮箱同样会被锁定 —— 锁定不泄露账号是否存在", async () => {
    const { service } = makeAuth({ user: null });
    for (let i = 0; i < 5; i += 1) {
      expect(await refusalCode(service.login(LOGIN_DTO))).toBe("INVALID_CREDENTIALS");
    }
    expect(await refusalCode(service.login(LOGIN_DTO))).toBe("TOO_MANY_ATTEMPTS");
  });

  it("触发锁定时写入 BRUTE_FORCE_DETECTED，且只写一次", async () => {
    const { service, events } = makeAuth();
    for (let i = 0; i < 6; i += 1) await refusalCode(service.login(LOGIN_DTO));

    const bruteForce = events.filter((e) => e.type === "BRUTE_FORCE_DETECTED");
    expect(bruteForce).toHaveLength(1);
    expect(bruteForce[0].riskLevel).toBe("HIGH");
    expect(bruteForce[0].source).toBe("AUTH");
    // Never the password, never the plaintext address.
    expect(JSON.stringify(events)).not.toContain("guess");
    expect(JSON.stringify(events)).not.toContain("alice@example.com");
  });

  it("管理员阈值更严格：3 次即锁", async () => {
    const { service } = makeAuth({ isAdmin: true });
    for (let i = 0; i < 3; i += 1) {
      expect(await refusalCode(service.login(LOGIN_DTO))).toBe("INVALID_CREDENTIALS");
    }
    expect(await refusalCode(service.login(LOGIN_DTO))).toBe("TOO_MANY_ATTEMPTS");
  });

  it("登录成功后清空失败预算", async () => {
    const { service } = makeAuth();
    for (let i = 0; i < 4; i += 1) await refusalCode(service.login(LOGIN_DTO));

    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    await expect(service.login(LOGIN_DTO)).resolves.toMatchObject({ accessToken: "access-token" });

    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    for (let i = 0; i < 4; i += 1) {
      expect(await refusalCode(service.login(LOGIN_DTO))).toBe("INVALID_CREDENTIALS");
    }
  });

  it("锁定在退避时间过后自动解除（无需管理员介入）", async () => {
    let clock = 1_000_000;
    const { service, loginAttempts } = makeAuth({ now: () => clock });

    for (let i = 0; i < 5; i += 1) await refusalCode(service.login(LOGIN_DTO));
    expect(await refusalCode(service.login(LOGIN_DTO))).toBe("TOO_MANY_ATTEMPTS");

    clock += 30_001;
    (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
    await expect(service.login(LOGIN_DTO)).resolves.toMatchObject({ accessToken: "access-token" });
    expect(loginAttempts.check(USER.email).locked).toBe(false);
  });
});
