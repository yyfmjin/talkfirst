import { ConflictException } from "@nestjs/common";
import { makeAuthService } from "./auth-service.fixture";
import { AuthController } from "./auth.controller";

/**
 * 2026-11-11 — 重新注册一个早就注册过的邮箱时：
 * 验证码收不到、也看不到原账号。
 *
 * 根因是「给已验证邮箱发注册验证码」这条路径：`sendCode` 在存在未用掉的旧码时
 * 会短路返回「已发送」而一封邮件都不发。现在改成直接回 EMAIL_TAKEN。
 *
 * 这里钉住三件事：
 *  1. 状态判定三种结果各自正确；
 *  2. 已注册且已验证 → 发码接口拒绝，且**真的没有调发信**；
 *  3. 注册过但没验证 → 必须放行（登录页的「重新发送验证码」走这条）。
 */

function makeController(status: "AVAILABLE" | "REGISTERED" | "UNVERIFIED") {
  const auth = {
    checkEmailAvailability: jest.fn().mockResolvedValue({ status }),
  };
  const verification = {
    sendCode: jest.fn().mockResolvedValue({ sent: true, expiresInSeconds: 600 }),
  };
  const controller = new AuthController(auth as never, {} as never, verification as never);
  return { controller, auth, verification };
}

describe("AuthController — 注册前判定邮箱", () => {
  it("已注册且已验证：发码接口拒绝 EMAIL_TAKEN，且不发信", async () => {
    const { controller, verification } = makeController("REGISTERED");

    await expect(
      controller.sendVerificationCode({ email: "taken@example.com" }, "zh-CN"),
    ).rejects.toMatchObject({ response: { error: { code: "EMAIL_TAKEN" } } });

    expect(verification.sendCode).not.toHaveBeenCalled();
  });

  it("注册过但没验证：照常发码（登录页的重新发送走这条路）", async () => {
    const { controller, verification } = makeController("UNVERIFIED");

    await controller.sendVerificationCode({ email: "half@example.com" }, "zh-CN");

    expect(verification.sendCode).toHaveBeenCalledWith("half@example.com", "REGISTER", {
      acceptLanguage: "zh-CN",
    });
  });

  it("未注册：照常发码", async () => {
    const { controller, verification } = makeController("AVAILABLE");

    await controller.sendVerificationCode({ email: "new@example.com" }, undefined);

    expect(verification.sendCode).toHaveBeenCalledWith("new@example.com", "REGISTER", {
      acceptLanguage: undefined,
    });
  });

  it("email-check 把三种状态原样交给客户端", async () => {
    const { controller, auth } = makeController("REGISTERED");

    const result = await controller.checkEmail({ email: "Taken@Example.com" });

    expect(result).toEqual({ success: true, data: { status: "REGISTERED" } });
    // 归一化交给 service，controller 只透传原值。
    expect(auth.checkEmailAvailability).toHaveBeenCalledWith("Taken@Example.com");
  });
});

describe("AuthService.checkEmailAvailability", () => {
  function make() {
    const prisma = { user: { findUnique: jest.fn() } };
    const service = makeAuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
    );
    return { service, prisma };
  }

  it("没有这个邮箱 → AVAILABLE", async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.checkEmailAvailability("New@Example.com")).resolves.toEqual({
      status: "AVAILABLE",
    });
    // 归一化：查库用的是小写去空格后的地址。
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "new@example.com" },
      select: { emailVerified: true },
    });
  });

  it("已验证 → REGISTERED", async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({ emailVerified: true });

    await expect(service.checkEmailAvailability("a@b.co")).resolves.toEqual({ status: "REGISTERED" });
  });

  it("未验证 → UNVERIFIED", async () => {
    const { service, prisma } = make();
    prisma.user.findUnique.mockResolvedValue({ emailVerified: false });

    await expect(service.checkEmailAvailability("a@b.co")).resolves.toEqual({ status: "UNVERIFIED" });
  });
});
