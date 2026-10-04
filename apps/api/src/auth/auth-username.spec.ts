import * as bcrypt from "bcryptjs";
import { makeAuthService } from "./auth-service.fixture";
import { LoginAttemptService } from "./login-attempt.service";
import { generateUsername, USERNAME_PATTERN } from "../common/username";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

/**
 * P0-02 — 用账户名注册与登录。
 *
 * `username` 是**登录标识**，不是昵称（`nickname` 才是）。这里覆盖三件容易在后
 * 续改动中悄悄坏掉的事：
 *
 *   1. 注册时选名 / 不选名（自动生成）两条路都对；
 *   2. 一个账号可以用邮箱**或**账户名登录，且旧客户端的 `{ email }` 载荷没被破坏；
 *   3. **限流预算按账号而不是按输入串计**。否则同一个账号可以在「邮箱桶」与
 *      「用户名桶」之间交替，把 5 次尝试变成 10 次 —— 这是一条安全性质，不是
 *      实现细节。
 */

const USER = {
  id: "user-1",
  email: "alice@example.com",
  username: "alice1234",
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

async function refusal(error: unknown): Promise<{ code?: string; status?: number }> {
  const e = error as { getResponse?: () => { error?: { code?: string } }; getStatus?: () => number };
  return { code: e.getResponse?.()?.error?.code, status: e.getStatus?.() };
}

async function capture(op: Promise<unknown>): Promise<{ code?: string; status?: number }> {
  try {
    await op;
    return {};
  } catch (error) {
    return refusal(error);
  }
}

/**
 * `rows` 让每个 `findUnique` 的 `where` 自己决定结果 —— 这正是「同一个账号可以
 * 被邮箱或账户名命中的地方，所以 mock 必须按 where 分发，而不是无脑返回一个用户。
 */
function makeAuth(options: {
  rows?: (where: Record<string, unknown>) => unknown;
  createImpl?: (args: { data: Record<string, unknown> }) => unknown;
} = {}) {
  const byWhere =
    options.rows ??
    ((where: Record<string, unknown>) => {
      if (where.username === USER.username) return USER;
      if (where.email === USER.email) return USER;
      return null;
    });

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => byWhere(where)),
      update: jest.fn().mockResolvedValue(USER),
      create: jest.fn(
        options.createImpl ??
          (async ({ data }: { data: Record<string, unknown> }) => ({ ...USER, ...data })),
      ),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: "rt" }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };

  const securityEvents = { record: jest.fn(async () => undefined) };
  const loginAttempts = new LoginAttemptService({
    maxFailures: 5,
    adminMaxFailures: 3,
    baseLockMs: 30_000,
    maxLockMs: 900_000,
    windowMs: 900_000,
  });
  const service = makeAuthService(
    prisma as never,
    { signAsync: jest.fn().mockResolvedValue("access-token") } as never,
    { securityEvents, loginAttempts },
  );
  return { service, prisma, securityEvents, loginAttempts };
}

describe("P0-02 — 注册时的账户名", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
  });

  it("不带 username 时自动生成一个合规的账户名", async () => {
    const { service, prisma } = makeAuth({
      rows: (where) => (where.email === "new@example.com" ? null : null),
    });

    await service.register({ email: "new@example.com", password: "password123" });

    const created = prisma.user.create.mock.calls[0][0] as { data: { username: string } };
    expect(created.data.username).toMatch(USERNAME_PATTERN);
  });

  it("带 username 时按归一化后的值存（大写变小写）", async () => {
    const { service, prisma } = makeAuth({ rows: () => null });

    await service.register({
      email: "new@example.com",
      password: "password123",
      username: "NewUser123",
    });

    const created = prisma.user.create.mock.calls[0][0] as { data: { username: string } };
    expect(created.data.username).toBe("newuser123");
  });

  it("格式不合规 -> 400 USERNAME_INVALID，且不建号", async () => {
    const { service, prisma } = makeAuth({ rows: () => null });

    expect(
      await capture(service.register({ email: "new@example.com", password: "password123", username: "short" })),
    ).toMatchObject({ code: "USERNAME_INVALID", status: 400 });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("保留字 -> 400 USERNAME_RESERVED，且不建号", async () => {
    const { service, prisma } = makeAuth({ rows: () => null });

    expect(
      await capture(
        service.register({ email: "new@example.com", password: "password123", username: "admin1234" }),
      ),
    ).toMatchObject({ code: "USERNAME_RESERVED", status: 400 });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("账户名已被占用 -> 409 USERNAME_TAKEN", async () => {
    const { service } = makeAuth({
      rows: (where) => (where.username === "takenuser1" ? { ...USER, id: "other" } : null),
    });

    expect(
      await capture(
        service.register({ email: "new@example.com", password: "password123", username: "takenuser1" }),
      ),
    ).toMatchObject({ code: "USERNAME_TAKEN", status: 409 });
  });

  it("并发下生成的账户名撞唯一约束 -> 换名重试，而不是报错", async () => {
    const attempts: string[] = [];
    const { service, prisma } = makeAuth({
      rows: () => null,
      createImpl: async ({ data }: { data: Record<string, unknown> }) => {
        attempts.push(String(data.username));
        // 第一次撞 P2002(username)，第二次成功。
        if (attempts.length === 1) {
          throw { code: "P2002", meta: { target: ["username"] } };
        }
        return { ...USER, ...data };
      },
    });

    await service.register({ email: "new@example.com", password: "password123" });

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe(attempts[1]);
    expect(prisma.user.create).toHaveBeenCalledTimes(2);
  });

  it("并发下用户手选的名字撞唯一约束 -> 409，而不是悄悄换一个名字给他", async () => {
    const { service } = makeAuth({
      rows: () => null, // 预检查说「没人用」，但写入时被抢
      createImpl: async () => {
        throw { code: "P2002", meta: { target: "User_username_key" } };
      },
    });

    expect(
      await capture(
        service.register({ email: "new@example.com", password: "password123", username: "myownname1" }),
      ),
    ).toMatchObject({ code: "USERNAME_TAKEN", status: 409 });
  });

  it("邮箱本身的唯一约束不会被误当成账户名冲突", async () => {
    const { service } = makeAuth({
      rows: () => null,
      createImpl: async () => {
        throw { code: "P2002", meta: { target: ["email"] } };
      },
    });

    // 原样抛出：这是调用方（外层 catch）记账的一部分，不是账户名的问题。
    await expect(
      service.register({ email: "new@example.com", password: "password123" }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("P0-02 — 登录：邮箱或账户名", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
  });

  it("用账户名可以登录", async () => {
    const { service } = makeAuth();

    await expect(
      service.login({ identifier: USER.username, password: "correct" }),
    ).resolves.toMatchObject({ user: { username: USER.username } });
  });

  it("用 @账户名 也可以登录（去掉开头的 @）", async () => {
    const { service } = makeAuth();

    await expect(
      service.login({ identifier: `@${USER.username}`, password: "correct" }),
    ).resolves.toMatchObject({ user: { username: USER.username } });
  });

  it("旧客户端的 { email } 载荷仍然可用（管理端与移动端还在用）", async () => {
    const { service } = makeAuth();

    await expect(
      service.login({ email: USER.email, password: "correct" }),
    ).resolves.toMatchObject({ user: { email: USER.email } });
  });

  it("大小写不同的邮箱等价（沿用原有归一化）", async () => {
    const { service } = makeAuth();

    await expect(
      service.login({ identifier: "Alice@Example.com", password: "correct" }),
    ).resolves.toMatchObject({ user: { email: USER.email } });
  });

  it("既没给 identifier 也没给 email -> 400 VALIDATION_ERROR", async () => {
    const { service } = makeAuth();

    expect(await capture(service.login({ password: "correct" }))).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("只给空白 -> 400 VALIDATION_ERROR（不接受空标识符）", async () => {
    const { service } = makeAuth();

    expect(await capture(service.login({ identifier: "   ", password: "correct" }))).toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("账户名不存在与密码错误返回同一个码（不泄露账号是否存在）", async () => {
    const wrongPassword = makeAuth();
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const byName = makeAuth({ rows: () => null });
    const missing = await capture(byName.service.login({ identifier: "nobodyhere", password: "x" }));
    const wrong = await capture(wrongPassword.service.login({ identifier: USER.username, password: "x" }));

    expect(missing.code).toBe("INVALID_CREDENTIALS");
    expect(wrong.code).toBe("INVALID_CREDENTIALS");
  });

  it("限流预算按账号计：用账户名失败 5 次后，用邮箱登录也被锁（关键安全性质）", async () => {
    const { service } = makeAuth();
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    for (let i = 0; i < 5; i += 1) {
      expect(await capture(service.login({ identifier: USER.username, password: "guess" }))).toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    }

    /**
     * 换一种写法**不能**换到另一个预算上。若这里返回 INVALID_CREDENTIALS 而不是
     * TOO_MANY_ATTEMPTS，就说明一个账号可以被攻击两倍的次数。
     */
    expect(await capture(service.login({ email: USER.email, password: "guess" }))).toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
      status: 429,
    });
  });

  it("反向同理：用邮箱失败 5 次后，用账户名登录也被锁", async () => {
    const { service } = makeAuth();
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    for (let i = 0; i < 5; i += 1) {
      await capture(service.login({ email: USER.email, password: "guess" }));
    }

    expect(await capture(service.login({ identifier: USER.username, password: "guess" }))).toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
    });
  });

  it("登录成功会清掉两种写法各自的计数（否则下次会被上次的手误锁住）", async () => {
    const { service } = makeAuth();
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    for (let i = 0; i < 3; i += 1) {
      await capture(service.login({ identifier: USER.username, password: "typo" }));
    }

    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    await service.login({ identifier: USER.username, password: "correct" });

    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    // 预算已清零，所以又能拿到真实的凭据失败，而不是立刻 429。
    expect(await capture(service.login({ identifier: USER.username, password: "typo" }))).toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("登录失败事件里不会把账户名塞进 email 字段（脱敏按标识符类型分流）", async () => {
    const { service, securityEvents } = makeAuth();
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await capture(service.login({ identifier: USER.username, password: "guess" }));

    const failed = (securityEvents.record.mock.calls as unknown as [
      { type: string; detail?: Record<string, unknown> },
    ][])
      .map((call) => call[0])
      .find((event) => event.type === "LOGIN_FAILED");
    expect(failed?.detail).toHaveProperty("usernameMasked");
    expect(failed?.detail).not.toHaveProperty("emailMasked");
  });

  it("生成的名字一定不是保留字，所以自动注册出来的账号都能登录", async () => {
    // 这条是「生成规则」与「登录规则」之间的一致性检查：若生成器产出一个保留字，
    // 注册会成功而登录用的 checkUsername 会拒绝它 —— 那是一个死账号。
    for (let i = 0; i < 100; i += 1) {
      const value = generateUsername();
      const { service } = makeAuth({
        rows: (where) => (where.username === value ? { ...USER, username: value } : null),
      });
      await expect(service.login({ identifier: value, password: "correct" })).resolves.toBeDefined();
    }
  });
});
