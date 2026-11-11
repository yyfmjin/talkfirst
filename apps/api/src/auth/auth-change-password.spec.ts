// Aliased: this file already has a local `makeAuthService` of its own.
import { makeAuthService as buildAuthService } from "./auth-service.fixture";
import { BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PASSWORD_CHANGE_CODE_PURPOSE } from "./auth.constants";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const user = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: "old-hash",
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

function makeAuthService(
  overrides: Record<string, unknown> = {},
  verification: { verifyCode?: jest.Mock; sendCode?: jest.Mock } | null = {},
) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    refreshToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: "rt-1" }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    ...overrides,
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
  /**
   * 传 `null` 表示「一个验证服务都不给」—— 那就是 503 的那条分支。否则给一个
   * 任何码都放行的桩，这样只关心密码规则的用例不必自己造一个码。
   */
  const verificationService =
    verification === null
      ? undefined
      : {
          verifyCode: jest.fn().mockResolvedValue({ verified: true }),
          sendCode: jest.fn().mockResolvedValue({ sent: true }),
          ...verification,
        };
  const service = buildAuthService(prisma as never, jwtService as never, {
    verificationService: verificationService as never,
  });
  return { service, prisma, verificationService };
}

describe("AuthService.changePassword", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a wrong current password", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service } = makeAuthService();
    await expect(
      service.changePassword("user-1", {
        currentPassword: "wrong",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
        code: "123456",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "INVALID_CREDENTIALS" } } });
  });

  it("rejects mismatched confirmation", async () => {
    const { service } = makeAuthService();
    await expect(
      service.changePassword("user-1", {
        currentPassword: "oldpassword",
        newPassword: "newpassword1",
        confirmPassword: "different",
        code: "123456",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "PASSWORD_MISMATCH" } } });
  });

  it("rejects reusing the current password", async () => {
    const { service } = makeAuthService();
    await expect(
      service.changePassword("user-1", {
        currentPassword: "samepass1",
        newPassword: "samepass1",
        confirmPassword: "samepass1",
        code: "123456",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "PASSWORD_UNCHANGED" } } });
  });

  it("rotates the hash, revokes refresh tokens and issues a new session", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    const { service, prisma } = makeAuthService();
    const session = await service.changePassword("user-1", {
      currentPassword: "oldpassword",
      newPassword: "newpassword1",
      confirmPassword: "newpassword1",
      code: "123456",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: "new-hash" },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(session.accessToken).toBe("access-token");
    expect(session.refreshToken).toEqual(expect.any(String));
  });

  /**
   * 2026-11-11 — 邮箱验证码成为改密码的前置条件。下面三个用例把「凭什么算过」
   * 钉在服务层，而不是只靠前端的输入框：前端可以绕过，这个断言不能。
   */
  it("checks the emailed code against the account address and the change-password purpose", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    const { service, verificationService } = makeAuthService();

    await service.changePassword("user-1", {
      currentPassword: "oldpassword",
      newPassword: "newpassword1",
      confirmPassword: "newpassword1",
      code: "654321",
    });

    expect(verificationService?.verifyCode).toHaveBeenCalledWith(
      "alice@example.com",
      "654321",
      PASSWORD_CHANGE_CODE_PURPOSE,
    );
  });

  it("refuses to touch the password when the code is rejected", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service, prisma } = makeAuthService({}, {
      verifyCode: jest.fn().mockRejectedValue(
        new BadRequestException({
          success: false,
          error: { code: "CODE_MISMATCH", message: "Verification code is incorrect" },
        }),
      ),
    });

    await expect(
      service.changePassword("user-1", {
        currentPassword: "oldpassword",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
        code: "000000",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "CODE_MISMATCH" } } });

    // 关键：码没过就不能改库，也不能轮换 token —— 否则「验证」只是一句提示。
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when the verification service is unavailable", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service, prisma } = makeAuthService({}, null);

    await expect(
      service.changePassword("user-1", {
        currentPassword: "oldpassword",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
        code: "123456",
      }),
    ).rejects.toMatchObject({ response: { error: { code: "SERVICE_UNAVAILABLE" } } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sends the code to the session's own address, never one supplied by the client", async () => {
    const { service, verificationService } = makeAuthService();

    await service.sendPasswordChangeCode("user-1", "zh-CN");

    expect(verificationService?.sendCode).toHaveBeenCalledWith(
      "alice@example.com",
      PASSWORD_CHANGE_CODE_PURPOSE,
      { acceptLanguage: "zh-CN" },
    );
  });
});
