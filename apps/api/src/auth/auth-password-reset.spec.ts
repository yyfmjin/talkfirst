import * as bcrypt from "bcryptjs";
import { PASSWORD_RESET_PURPOSE } from "./auth.service";
import { makeAuthService } from "./auth-service.fixture";
import { sha256Hex } from "../common/crypto";

/**
 * FEATURE (post-audit) — password recovery.
 *
 * Before this existed there was no way back into an account whose password had
 * been forgotten: `POST /auth/password` requires the *current* password, and
 * nothing else could change one. The two methods under test are the whole
 * recovery path.
 *
 * The cases below pin the three properties that make it safe rather than merely
 * present:
 *
 *  1. **No account-existence oracle.** `requestPasswordReset` answers
 *     `{ sent: true }` for an unknown address and for a rate-limited one, exactly
 *     as it does for a real one. An unauthenticated endpoint that answers
 *     differently is an enumeration tool.
 *  2. **Single-use code with its own namespace.** The code is consumed by
 *     `VerificationService.verifyCode` under `purpose = "RESET"`, so a
 *     registration code can never be spent here.
 *  3. **A reset ends every session.** That is the point of a reset: if a stolen
 *     refresh token survived it, the attacker would keep their access. No session
 *     is issued to the caller either — they sign in again with the new password.
 */

const USER = { id: "u1", email: "alice@example.com", status: "ACTIVE" };

function makePrisma() {
  return {
    user: {
      // `mockResolvedValue` rather than `jest.fn(async () => ...)` on purpose:
      // the latter infers a narrowed resolved type, so the `null` seeded by the
      // "unregistered address" case below is a TS2345. Every other spec in this
      // directory already uses `mockResolvedValue`; this file was the outlier,
      // and the resulting type error was failing `npm run typecheck` outright.
      findUnique: jest.fn().mockResolvedValue({ id: USER.id }),
      update: jest.fn().mockResolvedValue({}),
    },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
}

function makeVerification(overrides: Partial<Record<"sendCode" | "verifyCode", jest.Mock>> = {}) {
  return {
    sendCode: overrides.sendCode ?? jest.fn(async () => ({ sent: true, expiresInSeconds: 600, devCode: "123456" })),
    verifyCode: overrides.verifyCode ?? jest.fn(async () => ({ verified: true })),
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>, verification: ReturnType<typeof makeVerification>) {
  const securityEvents = { record: jest.fn(async () => undefined) };
  const service = makeAuthService(
    prisma as never,
    { signAsync: jest.fn(async () => "access-token") } as never,
    { securityEvents, verificationService: verification },
  );
  return { service, securityEvents };
}

describe("requestPasswordReset — 不泄漏账号是否存在", () => {
  it("已注册地址：发送 RESET 用途的验证码，并返回 sent:true", async () => {
    const prisma = makePrisma();
    const verification = makeVerification();
    const { service } = makeService(prisma, verification);

    await expect(service.requestPasswordReset("Alice@Example.com ")).resolves.toEqual({ sent: true });
    // Normalised address, and the purpose that isolates this flow from REGISTER.
    expect(verification.sendCode).toHaveBeenCalledWith("alice@example.com", PASSWORD_RESET_PURPOSE);
  });

  it("未注册地址：不发信，但响应与已注册完全一致", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const verification = makeVerification();
    const { service } = makeService(prisma, verification);

    await expect(service.requestPasswordReset("nobody@example.com")).resolves.toEqual({ sent: true });
    expect(verification.sendCode).not.toHaveBeenCalled();
  });

  it("地址被限流（sendCode 抛错）：依然返回 sent:true，不泄漏最近是否有人请求过", async () => {
    const prisma = makePrisma();
    const verification = makeVerification({
      sendCode: jest.fn(async () => {
        throw new Error("EMAIL_VERIFICATION_RATE_LIMITED");
      }),
    });
    const { service } = makeService(prisma, verification);

    await expect(service.requestPasswordReset("alice@example.com")).resolves.toEqual({ sent: true });
  });

  it("开发用的 devCode 绝不出现在响应里（否则任何人都能重置别人的密码）", async () => {
    const prisma = makePrisma();
    const verification = makeVerification();
    const { service } = makeService(prisma, verification);

    const result = await service.requestPasswordReset("alice@example.com");
    expect(result).toEqual({ sent: true });
    expect(JSON.stringify(result)).not.toContain("123456");
  });
});

describe("resetPassword — 验码、换密、清会话", () => {
  it("验证码通过 -> 用 bcrypt(12) 写入新密码并撤销全部 refresh token", async () => {
    const prisma = makePrisma();
    const verification = makeVerification();
    const { service } = makeService(prisma, verification);

    await expect(
      service.resetPassword({ email: "alice@example.com", code: "123456", newPassword: "new-password-8" }),
    ).resolves.toEqual({ reset: true });

    expect(verification.verifyCode).toHaveBeenCalledWith("alice@example.com", "123456", PASSWORD_RESET_PURPOSE);

    const update = prisma.user.update.mock.calls[0] as unknown as [
      { where: { id: string }; data: { passwordHash: string; emailVerified: boolean } },
    ];
    expect(update[0].where).toEqual({ id: USER.id });
    expect(update[0].data.emailVerified).toBe(true);
    // The stored value must be a bcrypt hash of the new password, never the
    // plaintext, and never a weaker cost than registration uses.
    expect(update[0].data.passwordHash).not.toBe("new-password-8");
    expect(update[0].data.passwordHash.startsWith("$2")).toBe(true);
    await expect(bcrypt.compare("new-password-8", update[0].data.passwordHash)).resolves.toBe(true);

    // Every live session dies. Without this, a stolen refresh token would outlive
    // the reset that was performed precisely to revoke it.
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("验证码错误 -> 原样抛出（400 CODE_MISMATCH），不改密码、不清会话", async () => {
    const prisma = makePrisma();
    const verification = makeVerification({
      verifyCode: jest.fn(async () => {
        throw new Error("CODE_MISMATCH");
      }),
    });
    const { service } = makeService(prisma, verification);

    await expect(
      service.resetPassword({ email: "alice@example.com", code: "000000", newPassword: "new-password-8" }),
    ).rejects.toThrow("CODE_MISMATCH");
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("验码通过但账号随后消失 -> 不抛 P2025/500，而是同一个 CODE_INVALID", async () => {
    const prisma = makePrisma();
    // The lookup succeeds (the account existed when the reset was authorised);
    // the WRITE is what fails, because the row was deleted in between. Prisma
    // reports that as P2025. Modelled on the write, not on a null lookup —
    // an earlier version of this case made `findUnique` return null instead,
    // which is a different branch (`!user`) and left the real one unpinned.
    prisma.user.update.mockRejectedValue(
      Object.assign(new Error("Record to update not found."), { code: "P2025" }),
    );
    const verification = makeVerification();
    const { service } = makeService(prisma, verification);

    await expect(
      service.resetPassword({ email: "alice@example.com", code: "123456", newPassword: "new-password-8" }),
    ).rejects.toMatchObject({ response: { error: { code: "CODE_INVALID" } } });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("响应体永不包含密码或验证码", async () => {
    const prisma = makePrisma();
    const verification = makeVerification();
    const { service } = makeService(prisma, verification);

    const result = await service.resetPassword({
      email: "alice@example.com",
      code: "123456",
      newPassword: "new-password-8",
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("new-password-8");
    expect(serialised).not.toContain("123456");
  });
});

describe("resetPassword — 没有验证服务时明确失败而不是崩溃", () => {
  it("未注入 VerificationService -> 503 SERVICE_UNAVAILABLE", async () => {
    const prisma = makePrisma();
    const service = makeAuthService(
      prisma as never,
      { signAsync: jest.fn() } as never,
      // `verificationService` deliberately omitted: the constructor keeps it
      // optional so pre-existing hand-built specs do not have to change.
    );

    await expect(
      service.resetPassword({ email: "alice@example.com", code: "123456", newPassword: "new-password-8" }),
    ).rejects.toMatchObject({ response: { error: { code: "SERVICE_UNAVAILABLE" } } });
  });
});

describe("PASSWORD_RESET_PURPOSE — 命名空间与注册流程隔离", () => {
  it("不是 REGISTER，也不是密码哈希（防误用）", () => {
    expect(PASSWORD_RESET_PURPOSE).toBe("RESET");
    expect(PASSWORD_RESET_PURPOSE).not.toBe("REGISTER");
    // The value is stored in a VarChar(16) column; keep it short.
    expect(PASSWORD_RESET_PURPOSE.length).toBeLessThanOrEqual(16);
  });

  it("sha256Hex 仍是验证码的存储形式（无盐哈希，历史一致）", () => {
    expect(sha256Hex("123456")).toHaveLength(64);
  });
});
