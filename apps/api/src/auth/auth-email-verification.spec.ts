import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { runWithRequestContext } from "../security/request-context";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

/**
 * SEC-005 — production e-mail verification enforcement.
 *
 * Design (approved): "restricted session". An unverified account may keep and
 * rotate a refresh token so the web `/verify` screen works, but it is refused at
 * the JwtStrategy gate for every route outside the verification allow-list. The
 * check reads the database each request, so a token minted before verification
 * starts working the instant the stored flag flips.
 */
const BASE_USER = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: "hash",
  emailVerified: false,
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

const LOGIN_DTO = { email: BASE_USER.email, password: "sup3rsecret!" };

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

/** Runs `fn` with the enforcement switch set, restoring the prior value after. */
async function withEnforcement<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  const original = process.env.ENFORCE_EMAIL_VERIFICATION;
  if (on) process.env.ENFORCE_EMAIL_VERIFICATION = "true";
  else delete process.env.ENFORCE_EMAIL_VERIFICATION;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.ENFORCE_EMAIL_VERIFICATION;
    else process.env.ENFORCE_EMAIL_VERIFICATION = original;
  }
}

function makeAuth(
  user: Record<string, unknown> | null = BASE_USER,
  prismaOverride: Record<string, unknown> = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockResolvedValue(user),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: "rt-new" }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (ops: unknown) => ops),
    ...prismaOverride,
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
  const service = new AuthService(prisma as never, jwtService as never, {
    record: jest.fn(async () => undefined),
  } as never);
  return { service, prisma };
}

function refreshRow(userPatch: Record<string, unknown> = {}) {
  return {
    id: "rt-1",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    user: { ...BASE_USER, ...userPatch },
  };
}

function strategyFor(user: Record<string, unknown>) {
  const findUnique = jest.fn(async () => user);
  return new JwtStrategy({ user: { findUnique } } as never);
}

function validateAt(strategy: JwtStrategy, path: string) {
  return runWithRequestContext({ requestId: "test", path }, () =>
    strategy.validate({ sub: "user-1", email: BASE_USER.email, type: "access" }),
  );
}

describe("SEC-005 — login 强制邮箱验证", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  it("enforcement 关闭 + 未验证 -> 正常登录（保持兼容）", async () => {
    const { service } = makeAuth({ ...BASE_USER, emailVerified: false });
    const session = await withEnforcement(false, () => service.login(LOGIN_DTO));
    expect(session).toMatchObject({ accessToken: "access-token", refreshToken: expect.any(String) });
  });

  it("enforcement 开启 + 未验证 -> 403 EMAIL_NOT_VERIFIED，且不创建 refresh token", async () => {
    const { service, prisma } = makeAuth({ ...BASE_USER, emailVerified: false });
    const result = await withEnforcement(true, () => refusal(service.login(LOGIN_DTO)));
    expect(result.code).toBe("EMAIL_NOT_VERIFIED");
    expect(result.status).toBe(403);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("enforcement 开启 + 已验证 -> 正常登录", async () => {
    const { service } = makeAuth({ ...BASE_USER, emailVerified: true });
    const session = await withEnforcement(true, () => service.login(LOGIN_DTO));
    expect(session).toMatchObject({ accessToken: "access-token" });
  });

  it("BANNED 且密码错误 -> INVALID_CREDENTIALS（不泄露账号状态）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeAuth({ ...BASE_USER, status: "BANNED" });
    const result = await refusal(service.login(LOGIN_DTO));
    expect(result.code).toBe("INVALID_CREDENTIALS");
  });

  it("DISABLED 且密码错误 -> INVALID_CREDENTIALS（不泄露账号状态）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeAuth({ ...BASE_USER, status: "DISABLED" });
    const result = await refusal(service.login(LOGIN_DTO));
    expect(result.code).toBe("INVALID_CREDENTIALS");
  });

  it("未知邮箱 -> 仍执行一次 bcrypt 比较（抗时间侧信道），返回 INVALID_CREDENTIALS", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeAuth(null);
    const result = await refusal(service.login(LOGIN_DTO));
    expect(result.code).toBe("INVALID_CREDENTIALS");
    expect(bcrypt.compare).toHaveBeenCalledWith(LOGIN_DTO.password, expect.stringMatching(/^\$2/));
  });

  it("暴力破解仍然生效：第 6 次尝试返回 TOO_MANY_ATTEMPTS / 429", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeAuth();
    for (let i = 0; i < 5; i += 1) {
      await refusal(service.login(LOGIN_DTO));
    }
    const result = await refusal(service.login(LOGIN_DTO));
    expect(result.code).toBe("TOO_MANY_ATTEMPTS");
    expect(result.status).toBe(429);
  });
});

describe("SEC-005 — refresh 受限会话（方案 A）", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  it("enforcement 开启 + 未验证 -> 刷新成功（供 /verify 页面使用）", async () => {
    const { service } = makeAuth(BASE_USER, {
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: "rt-new" }),
        findUnique: jest.fn().mockResolvedValue(refreshRow({ emailVerified: false })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const session = await withEnforcement(true, () => service.rotateRefresh("raw-refresh-token"));
    expect(session).toMatchObject({ accessToken: "access-token" });
  });

  it("enforcement 开启 + 已验证 -> 刷新成功", async () => {
    const { service } = makeAuth(BASE_USER, {
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: "rt-new" }),
        findUnique: jest.fn().mockResolvedValue(refreshRow({ emailVerified: true })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const session = await withEnforcement(true, () => service.rotateRefresh("raw-refresh-token"));
    expect(session).toMatchObject({ accessToken: "access-token" });
  });

  it("已撤销的 refresh token -> INVALID_REFRESH_TOKEN", async () => {
    const { service } = makeAuth(BASE_USER, {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ ...refreshRow(), revokedAt: new Date() }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });
    const result = await refusal(service.rotateRefresh("raw-refresh-token"));
    expect(result.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("已过期的 refresh token -> INVALID_REFRESH_TOKEN", async () => {
    const { service } = makeAuth(BASE_USER, {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          ...refreshRow(),
          expiresAt: new Date(Date.now() - 1000),
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });
    const result = await refusal(service.rotateRefresh("raw-refresh-token"));
    expect(result.code).toBe("INVALID_REFRESH_TOKEN");
  });
});

describe("SEC-005 — JwtStrategy 业务访问限制", () => {
  beforeEach(() => jest.clearAllMocks());

  it("enforcement 关闭 + 未验证 -> 业务 API 不变（放行）", async () => {
    const strategy = strategyFor({ ...BASE_USER, emailVerified: false });
    await withEnforcement(false, async () => {
      await expect(validateAt(strategy, "/api/v1/discover")).resolves.toMatchObject({ id: "user-1" });
    });
  });

  it("enforcement 开启 + 未验证 + 业务 API -> 403 EMAIL_VERIFIED_REQUIRED", async () => {
    const strategy = strategyFor({ ...BASE_USER, emailVerified: false });
    await withEnforcement(true, async () => {
      const result = await refusal(validateAt(strategy, "/api/v1/discover"));
      expect(result.code).toBe("EMAIL_VERIFIED_REQUIRED");
      expect(result.status).toBe(403);
    });
  });

  it("enforcement 开启 + 未验证 + 白名单路由 -> 放行", async () => {
    const strategy = strategyFor({ ...BASE_USER, emailVerified: false });
    await withEnforcement(true, async () => {
      for (const path of [
        "/api/v1/auth/me",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
        "/api/v1/auth/send-verification-code",
        "/api/v1/auth/verify-email",
        "/api/v1/users/me",
      ]) {
        await expect(validateAt(strategy, path)).resolves.toMatchObject({ id: "user-1" });
      }
    });
  });

  it("enforcement 开启 + 未验证 + /users/me 子路径 -> 拦截", async () => {
    const strategy = strategyFor({ ...BASE_USER, emailVerified: false });
    await withEnforcement(true, async () => {
      for (const path of ["/api/v1/users/me/attributes", "/api/v1/users/me/avatar"]) {
        const result = await refusal(validateAt(strategy, path));
        expect(result.code).toBe("EMAIL_VERIFIED_REQUIRED");
      }
    });
  });

  it("enforcement 开启 + 已验证 -> 业务 API 放行", async () => {
    const strategy = strategyFor({ ...BASE_USER, emailVerified: true });
    await withEnforcement(true, async () => {
      await expect(validateAt(strategy, "/api/v1/discover")).resolves.toMatchObject({ id: "user-1" });
    });
  });

  it("注册后签发的旧 token 无法绕过验证", async () => {
    // The token is syntactically valid and unexpired; the gate reads the stored
    // flag, so possession of a pre-verification token is not enough.
    const strategy = strategyFor({ ...BASE_USER, emailVerified: false });
    await withEnforcement(true, async () => {
      expect((await refusal(validateAt(strategy, "/api/v1/moments"))).code).toBe(
        "EMAIL_VERIFIED_REQUIRED",
      );
    });
  });

  it("验证成功后，同一个未过期 token 立即可用（无需重新登录）", async () => {
    const user = { ...BASE_USER, emailVerified: false };
    const strategy = strategyFor(user);
    await withEnforcement(true, async () => {
      expect((await refusal(validateAt(strategy, "/api/v1/discover"))).code).toBe(
        "EMAIL_VERIFIED_REQUIRED",
      );
      user.emailVerified = true;
      await expect(validateAt(strategy, "/api/v1/discover")).resolves.toMatchObject({ id: "user-1" });
    });
  });
});
