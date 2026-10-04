import { OAuthAccountService, isUniqueViolation } from "./oauth-account.service";
import { OAuthError, type ProviderIdentity } from "./oauth.types";

/**
 * 账号解析的规则与拒绝路径。
 *
 * This is the only place in the feature where identity A can be mistaken for
 * account B, so every branch of the policy table is pinned here. The cases are
 * grouped by the four rows of that table, and the refusals assert the CODE (which
 * the client turns into copy) rather than a message.
 */

const GOOGLE = "GOOGLE" as const;

function identity(overrides: Partial<ProviderIdentity> = {}): ProviderIdentity {
  return {
    provider: GOOGLE,
    providerUserId: "google-sub-1",
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice",
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "alice@example.com",
    passwordHash: "hash",
    emailVerified: true,
    status: "ACTIVE",
    isAdmin: false,
    nickname: null,
    avatarUrl: null,
    birthDate: null,
    countryCode: null,
    city: null,
    gender: "UNKNOWN",
    bio: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    ...overrides,
  };
}

/**
 * A `$transaction` stub that hands the callback a client with the same tables.
 *
 * Declared as a separate function rather than inline because the inline form
 * references the object being constructed, which TypeScript rejects as a circular
 * initializer (`TS7022`) — and the repo treats `tsc` as a gate.
 */
function transactionStub(prisma: {
  oAuthIdentity: unknown;
  user: unknown;
}): (arg: unknown) => Promise<unknown> {
  const tx = { oAuthIdentity: prisma.oAuthIdentity, user: prisma.user };
  return async (arg: unknown) =>
    typeof arg === "function" ? (arg as (client: unknown) => Promise<unknown>)(tx) : Promise.all(arg as unknown[]);
}

function makeService(options: {
  identity?: unknown;
  byEmail?: unknown;
  created?: unknown;
  createError?: unknown;
  methods?: unknown[];
} = {}) {
  const oAuthIdentity = {
    findUnique: jest.fn().mockResolvedValue(options.identity ?? null),
    create: jest.fn().mockResolvedValue({ id: "oi-1" }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findMany: jest.fn().mockResolvedValue(options.methods ?? []),
  };
  const user = {
    findUnique: jest.fn().mockResolvedValue(options.byEmail ?? null),
    create: jest.fn(async () =>
      options.createError ? Promise.reject(options.createError) : (options.created ?? makeUser()),
    ),
  };
  const prisma = { oAuthIdentity, user, $transaction: jest.fn(transactionStub({ oAuthIdentity, user })) };
  return { service: new OAuthAccountService(prisma as never), prisma, oAuthIdentity, user };
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OAuthError) return error.code;
    throw error;
  }
  throw new Error("expected a refusal, but the call resolved");
}

describe("OAuthAccountService — 已绑定的身份直接登录", () => {
  it("(provider, providerUserId) 命中 -> 签发会话，不查邮箱、不建号", async () => {
    const user = makeUser();
    const { service, user: userTable, oAuthIdentity } = makeService({
      identity: { id: "oi-1", user },
    });

    const result = await service.resolve(identity());

    expect(result).toMatchObject({ kind: "session", isNewAccount: false });
    // The stable key is the ONLY lookup: matching on the e-mail would log someone
    // into the wrong account after a provider-side address change.
    expect(oAuthIdentity.findUnique).toHaveBeenCalledWith({
      where: { provider_providerUserId: { provider: GOOGLE, providerUserId: "google-sub-1" } },
      include: { user: true },
    });
    expect(userTable.findUnique).not.toHaveBeenCalled();
    expect(userTable.create).not.toHaveBeenCalled();
  });

  it("登录时刷新身份快照与 lastLoginAt", async () => {
    const { service, oAuthIdentity } = makeService({ identity: { id: "oi-1", user: makeUser() } });

    await service.resolve(identity({ email: "new@example.com" }));

    expect(oAuthIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: "oi-1" },
      data: { lastLoginAt: expect.any(Date), email: "new@example.com", emailVerified: true },
    });
  });

  it("已绑定但账号被封禁 -> 拒绝（不能因为来自 Google 就绕过状态检查）", async () => {
    const { service } = makeService({ identity: { id: "oi-1", user: makeUser({ status: "BANNED" }) } });
    expect(await refusalOf(service.resolve(identity()))).toBe("OAUTH_ACCOUNT_EXISTS");
  });

  it("已绑定但账号被停用 -> 拒绝", async () => {
    const { service } = makeService({ identity: { id: "oi-1", user: makeUser({ status: "SUSPENDED" }) } });
    expect(await refusalOf(service.resolve(identity()))).toBe("OAUTH_ACCOUNT_EXISTS");
  });
});

describe("OAuthAccountService — 邮箱不存在则建号", () => {
  it("建号并同时写入身份行，emailVerified 为 true（Google 已代为验证）", async () => {
    const created = makeUser({ id: "new-user", emailVerified: true });
    const { service, prisma, oAuthIdentity } = makeService({ byEmail: null, created });

    const result = await service.resolve(identity({ name: "Alice" }));

    expect(result).toMatchObject({ kind: "session", isNewAccount: true });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "alice@example.com",
        // P0-02: a Google-only account still needs an account name, and it is
        // generated because this member was never asked for one. Asserted by RULE
        // rather than by value — the value is random by design.
        username: expect.stringMatching(/^[a-z0-9]{8,30}$/),
        // No password exists — NOT a random hash (that would be a fabricated credential).
        passwordHash: null,
        emailVerified: true,
        nickname: "Alice",
        lastActiveAt: expect.any(Date),
      },
    });
    expect(oAuthIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: "new-user",
        provider: GOOGLE,
        providerUserId: "google-sub-1",
        email: "alice@example.com",
        emailVerified: true,
        lastLoginAt: expect.any(Date),
      },
    });
  });

  it("并发建号触发唯一约束（P2002）-> 重新解析而不是 500", async () => {
    const raceError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const user = makeUser();
    const create = jest.fn().mockRejectedValue(raceError);
    /**
     * First resolve: no identity and no e-mail match, so it tries to create and
     * hits the race. Second (the re-resolve): the identity now exists.
     *
     * `user.create` is passed INTO the transaction stub as well, so the rejection
     * genuinely comes from inside the transaction — which is where the real
     * `P2002` would surface, and the reason the service has to catch it there.
     */
    const oAuthIdentity = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "oi-1", user }),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const userTable = { findUnique: jest.fn().mockResolvedValue(null), create };
    const prisma = {
      oAuthIdentity,
      user: userTable,
      $transaction: jest.fn(transactionStub({ oAuthIdentity, user: userTable })),
    };

    const result = await new OAuthAccountService(prisma as never).resolve(identity());

    expect(result).toMatchObject({ kind: "session", isNewAccount: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(oAuthIdentity.findUnique).toHaveBeenCalledTimes(2);
  });

  it("非唯一约束的错误照常抛出（不能被当成并发竞争吞掉）", async () => {
    const dbDown = Object.assign(new Error("connection refused"), { code: "P1001" });
    const { service } = makeService({ byEmail: null, createError: dbDown });

    await expect(service.resolve(identity())).rejects.toBe(dbDown);
  });
});

describe("OAuthAccountService — 邮箱已存在则不自动关联", () => {
  it("返回 account_exists 而不是建号，也不写任何身份行", async () => {
    const { service, oAuthIdentity, user } = makeService({ byEmail: makeUser() });

    const result = await service.resolve(identity());

    expect(result).toEqual({
      kind: "account_exists",
      methods: { hasPassword: true, providers: [] },
    });
    expect(user.create).not.toHaveBeenCalled();
    expect(oAuthIdentity.create).not.toHaveBeenCalled();
  });

  it("回报该账号可用的登录方式，让提示永远可执行", async () => {
    // Account has a password AND an existing Google binding.
    const { service } = makeService({
      byEmail: makeUser({ passwordHash: "hash" }),
      methods: [{ provider: GOOGLE }],
    });

    const result = await service.resolve(identity());
    expect(result).toMatchObject({
      kind: "account_exists",
      methods: { hasPassword: true, providers: [GOOGLE] },
    });
  });

  it("无密码账号（Google 建号）必须报 hasPassword:false —— 否则提示会指向不存在的密码", async () => {
    const { service } = makeService({ byEmail: makeUser({ passwordHash: null }) });

    const result = await service.resolve(identity());
    expect(result).toMatchObject({ kind: "account_exists", methods: { hasPassword: false } });
  });
});

describe("OAuthAccountService — 未验证的邮箱既不能建号也不能关联", () => {
  it("provider 报告邮箱未验证 -> OAUTH_EMAIL_UNVERIFIED，且不查账号", async () => {
    const { service, user } = makeService({ byEmail: null });

    expect(await refusalOf(service.resolve(identity({ emailVerified: false })))).toBe(
      "OAUTH_EMAIL_UNVERIFIED",
    );
    expect(user.findUnique).not.toHaveBeenCalled();
    expect(user.create).not.toHaveBeenCalled();
  });

  it("provider 没有给邮箱 -> OAUTH_EMAIL_REQUIRED", async () => {
    const { service, user } = makeService({ byEmail: null });

    expect(await refusalOf(service.resolve(identity({ email: null })))).toBe("OAUTH_EMAIL_REQUIRED");
    expect(user.create).not.toHaveBeenCalled();
  });

  it("已有账号 + provider 邮箱未验证 -> 也拒绝（不能借未验证地址碰到别人的账号）", async () => {
    const { service } = makeService({ byEmail: makeUser() });

    expect(await refusalOf(service.resolve(identity({ emailVerified: false })))).toBe(
      "OAUTH_EMAIL_UNVERIFIED",
    );
  });
});

describe("isUniqueViolation — 用 code 而不是 message 判断", () => {
  it("识别 P2002", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
  });

  it("其他 code / 非对象 / null 都不算", () => {
    expect(isUniqueViolation({ code: "P1001" })).toBe(false);
    expect(isUniqueViolation(new Error("Unique constraint failed"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("P2002")).toBe(false);
  });
});
