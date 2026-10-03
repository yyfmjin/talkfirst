import { makeAuthService } from "./auth-service.fixture";
import * as bcrypt from "bcryptjs";

/**
 * A Google-only account: `passwordHash` is NULL because it has no password.
 *
 * `User.passwordHash` used to be `NOT NULL`, so nothing had to think about this
 * state. It became nullable when Google sign-in was added (there is no password
 * to store, and writing a random one would be a fabricated credential). Three
 * places read that column and all three now branch on it, so each branch is
 * pinned here rather than left to the integration suite:
 *
 *  1. `login` must refuse — AND must still spend the same bcrypt work, because
 *     answering faster for a passwordless account is exactly the enumeration
 *     signal SEC-005's dummy hash exists to remove.
 *  2. `changePassword` must be able to SET a first password (there is no current
 *     one to prove), while every rule that still applies keeps applying.
 *  3. `resetPassword` already worked, because "control of the mailbox" is the
 *     proof it requires — the same proof Google sign-in accepts.
 */

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

/** The throwaway hash `auth.service.ts` compares against. Asserted, not imported. */
const DUMMY_HASH_PREFIX = "$2b$12$vpEdu5xYEq4S1poYXQADKO";

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "alice@example.com",
    passwordHash: null,
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
    ...overrides,
  };
}

function makeService(user: Record<string, unknown> = makeUser()) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "rt-1" }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
  return { service: makeAuthService(prisma as never, jwtService as never), prisma };
}

describe("AuthService.login — 无密码账号（Google 注册）", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("永远不能靠密码登录，且一律回 INVALID_CREDENTIALS", async () => {
    // A passwordless account cannot match anything, so the real comparison is
    // made against the dummy hash and its result is deliberately discarded.
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeService();

    await expect(
      service.login({ email: "alice@example.com", password: "anything-at-all" }),
    ).rejects.toMatchObject({ response: { error: { code: "INVALID_CREDENTIALS" } } });
  });

  it("仍然消耗一次 bcrypt 比对（否则响应耗时会泄漏「这个邮箱没有密码」）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeService();

    await service
      .login({ email: "alice@example.com", password: "anything-at-all" })
      .catch(() => undefined);

    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    const [submitted, hash] = (bcrypt.compare as jest.Mock).mock.calls[0] as [string, string];
    expect(submitted).toBe("anything-at-all");
    // Never `null`/`undefined`: bcrypt throws on a non-string hash, which would
    // turn "this account has no password" into a 500 instead of a refusal.
    expect(typeof hash).toBe("string");
    expect(hash.startsWith(DUMMY_HASH_PREFIX)).toBe(true);
  });

  it("即使 dummy 比对意外返回 true 也必须拒绝（不能只靠比对结果）", async () => {
    // The guard is `!valid || !user.passwordHash`. If a future refactor dropped
    // the second half, a bcrypt result alone would authorise a login into an
    // account that has no password at all.
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service } = makeService();

    await expect(
      service.login({ email: "alice@example.com", password: "anything-at-all" }),
    ).rejects.toMatchObject({ response: { error: { code: "INVALID_CREDENTIALS" } } });
  });

  it("有密码的账号行为完全不变（回归）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service } = makeService(makeUser({ passwordHash: "real-hash" }));

    const session = await service.login({ email: "alice@example.com", password: "correct-horse" });

    expect(bcrypt.compare).toHaveBeenCalledWith("correct-horse", "real-hash");
    expect(session.accessToken).toBe("access-token");
  });

  it("有密码但比对失败仍然计入失败（锁定预算不被绕过）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeService(makeUser({ passwordHash: "real-hash" }));

    await expect(
      service.login({ email: "alice@example.com", password: "wrong" }),
    ).rejects.toMatchObject({ response: { error: { code: "INVALID_CREDENTIALS" } } });
  });
});

describe("AuthService.changePassword — 首次设置密码", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("无密码账号可以直接设置首个密码，不校验 currentPassword", async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue("first-hash");
    const { service, prisma } = makeService();

    const session = await service.changePassword("user-1", {
      // The client has nothing to send here, so the DTO's MinLength(1) is
      // satisfied with a placeholder that the service ignores.
      currentPassword: " ",
      newPassword: "newpassword1",
      confirmPassword: "newpassword1",
    });

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "first-hash" },
    });
    expect(session.accessToken).toBe("access-token");
  });

  it("首次设置时 PASSWORD_UNCHANGED 不会误触发（占位 currentPassword 不等于新密码）", async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue("first-hash");
    const { service } = makeService();

    await expect(
      service.changePassword("user-1", {
        currentPassword: " ",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
      }),
    ).resolves.toMatchObject({ accessToken: "access-token" });
  });

  it("已经有密码的账号，旧密码错误仍然被拒（回归，且不会因为可空而放松）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service, prisma } = makeService(makeUser({ passwordHash: "real-hash" }));

    await expect(
      service.changePassword("user-1", {
        currentPassword: "wrong",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "INVALID_CREDENTIALS" } } });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("已经有密码的账号，新密码不得与旧密码相同（回归）", async () => {
    const { service, prisma } = makeService(makeUser({ passwordHash: "real-hash" }));

    await expect(
      service.changePassword("user-1", {
        currentPassword: "samepass1",
        newPassword: "samepass1",
        confirmPassword: "samepass1",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "PASSWORD_UNCHANGED" } } });

    // Checked before any comparison, so no bcrypt work happens for a request that
    // was never going to be accepted.
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("确认密码不一致时优先报 PASSWORD_MISMATCH（两个账号形态都一样）", async () => {
    const { service } = makeService();

    await expect(
      service.changePassword("user-1", {
        currentPassword: " ",
        newPassword: "newpassword1",
        confirmPassword: "different1",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "PASSWORD_MISMATCH" } } });
  });
});

describe("AuthService.resetPassword — 无密码账号同样可走邮件找回", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("验证码有效时可以为无密码账号写入密码（邮箱控制权即是证明）", async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue("reset-hash");
    const verificationService = { verifyCode: jest.fn().mockResolvedValue({ verified: true }) };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(makeUser()),
        update: jest.fn().mockResolvedValue(makeUser({ passwordHash: "reset-hash" })),
      },
      // A successful reset revokes every live refresh token, so the mock has to
      // provide that write — otherwise the rejection below would come from the
      // mock, not from the behaviour under test.
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const service = makeAuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
      { verificationService },
    );

    await expect(
      service.resetPassword({ email: "alice@example.com", code: "123456", newPassword: "newpassword1" }),
    ).resolves.toEqual({ reset: true });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      // `emailVerified: true` is unchanged behaviour: proving the mailbox is what
      // the reset already established.
      data: { passwordHash: "reset-hash", emailVerified: true },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
