import { AuthService } from "./auth.service";
import { VerificationService } from "./verification.service";
import { sha256Hex } from "../common/crypto";

/**
 * SEC-005 — the verification-code lifecycle.
 *
 * The code is a security token, so every property below is load-bearing: it is
 * stored hashed, expires, is attempt-limited, is single-use, and is bounded per
 * address as well as per IP. Failure paths must also be honest — a failed
 * delivery must not burn the cooldown, and an unknown address must not surface
 * as a P2025 / HTTP 500.
 */
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

async function withNodeEnv<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
}

function makeVerification() {
  const record: jest.Mock = jest.fn(async () => undefined);
  const mail = { sendEmailVerificationCode: jest.fn(async () => undefined) };

  const prisma: {
    verificationCode: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  } = {
    verificationCode: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "vc-1",
        createdAt: new Date(),
        ...args.data,
      })),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 0),
      delete: jest.fn(async () => ({})),
    },
    user: { updateMany: jest.fn(async () => ({ count: 1 })) },
    // Interactive form, wired after construction to avoid a self-reference in
    // the initializer.
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(prisma),
  );

  const service = new VerificationService(prisma as never, { record } as never, mail as never);
  return { service, prisma, mail, record };
}

describe("SEC-005 — sendCode 生命周期", () => {
  beforeEach(() => jest.clearAllMocks());

  it("哈希保存验证码、10 分钟 TTL、经 MailService 发送", async () => {
    const { service, prisma, mail } = makeVerification();

    const result = await service.sendCode("  Alice@Example.com ");

    expect(result.sent).toBe(true);
    expect(result.expiresInSeconds).toBe(600);
    expect(result.devCode).toMatch(/^\d{6}$/);

    const args = prisma.verificationCode.create.mock.calls[0][0] as {
      data: { email: string; codeHash: string; purpose: string; expiresAt: Date };
    };
    expect(args.data.email).toBe("alice@example.com");
    expect(args.data.purpose).toBe("REGISTER");
    expect(args.data.codeHash).toBe(sha256Hex(result.devCode as string));
    expect(args.data.codeHash).not.toBe(result.devCode);

    const ttlMs = args.data.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);

    expect(mail.sendEmailVerificationCode).toHaveBeenCalledWith({
      to: "alice@example.com",
      code: result.devCode,
      expiresInSeconds: 600,
    });
  });

  it("审计事件 EMAIL_VERIFICATION_SENT 不含验证码明文", async () => {
    const { service, record } = makeVerification();
    const result = await service.sendCode("alice@example.com");
    const payload = JSON.stringify(record.mock.calls);
    expect(payload).toContain("EMAIL_VERIFICATION_SENT");
    expect(payload).not.toContain(result.devCode as string);
    expect(payload).not.toContain("alice@example.com");
  });

  it("60 秒冷却内重复发送 -> 429 EMAIL_VERIFICATION_RATE_LIMITED，且不创建新验证码", async () => {
    const { service, prisma, mail, record } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({ createdAt: new Date() });

    const result = await refusal(service.sendCode("alice@example.com"));

    expect(result.code).toBe("EMAIL_VERIFICATION_RATE_LIMITED");
    expect(result.status).toBe(429);
    expect(prisma.verificationCode.create).not.toHaveBeenCalled();
    expect(mail.sendEmailVerificationCode).not.toHaveBeenCalled();
    expect(JSON.stringify(record.mock.calls)).toContain("EMAIL_VERIFICATION_RATE_LIMITED");
  });

  it("每小时上限 -> 429，且不创建新验证码", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue(null);
    prisma.verificationCode.count.mockResolvedValue(5);

    const result = await refusal(service.sendCode("alice@example.com"));

    expect(result.code).toBe("EMAIL_VERIFICATION_RATE_LIMITED");
    expect(prisma.verificationCode.create).not.toHaveBeenCalled();
  });

  it("限流事件的 detail 只含脱敏信息，不含明文邮箱", async () => {
    const { service, prisma, record } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({ createdAt: new Date() });

    await refusal(service.sendCode("alice@example.com"));

    const event = record.mock.calls[0][0] as { type: string; detail?: Record<string, unknown> };
    expect(event.type).toBe("EMAIL_VERIFICATION_RATE_LIMITED");
    expect(event.detail?.emailMasked).toBe("a***@example.com");
    expect(JSON.stringify(event)).not.toContain("alice@example.com");
  });

  it("邮件发送失败 -> 删除已创建的验证码并向上抛出", async () => {
    const { service, prisma, mail, record } = makeVerification();
    mail.sendEmailVerificationCode.mockRejectedValueOnce(new Error("smtp down"));

    await expect(service.sendCode("alice@example.com")).rejects.toThrow("smtp down");

    expect(prisma.verificationCode.delete).toHaveBeenCalledWith({ where: { id: "vc-1" } });
    expect(record).not.toHaveBeenCalled();
  });

  it("production 下永不返回 devCode", async () => {
    const { service } = makeVerification();
    const result = await withNodeEnv("production", () => service.sendCode("alice@example.com"));
    expect(result.devCode).toBeUndefined();
  });
});

describe("SEC-005 — verifyCode 生命周期", () => {
  beforeEach(() => jest.clearAllMocks());

  it("正确验证码 -> 同一事务内消费验证码并置 emailVerified=true", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: "vc-1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
    });

    await expect(service.verifyCode("alice@example.com", "123456")).resolves.toEqual({
      verified: true,
    });

    expect(prisma.verificationCode.updateMany).toHaveBeenCalledWith({
      where: { id: "vc-1", consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
      data: { emailVerified: true },
    });
  });

  it("查询只取未消费且未过期的验证码", async () => {
    const { service, prisma } = makeVerification();
    await refusal(service.verifyCode("alice@example.com", "123456"));
    const query = prisma.verificationCode.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(query.where.consumedAt).toBeNull();
    expect(query.where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("未知邮箱 -> 不抛 P2025 / 不 500", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: "vc-1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
    });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.verifyCode("ghost@example.com", "123456")).resolves.toEqual({
      verified: true,
    });
  });

  it("错误验证码 -> CODE_MISMATCH、attempts 自增、且不消费验证码", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: "vc-1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
    });

    const result = await refusal(service.verifyCode("alice@example.com", "999999"));

    expect(result.code).toBe("CODE_MISMATCH");
    expect(prisma.verificationCode.update).toHaveBeenCalledWith({
      where: { id: "vc-1" },
      data: { attempts: { increment: 1 } },
    });
    expect(prisma.verificationCode.updateMany).not.toHaveBeenCalled();
  });

  it("达到 5 次错误上限 -> CODE_LOCKED", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: "vc-1",
      codeHash: sha256Hex("123456"),
      attempts: 5,
    });

    const result = await refusal(service.verifyCode("alice@example.com", "123456"));
    expect(result.code).toBe("CODE_LOCKED");
  });

  it("已消费 / 已过期的验证码 -> CODE_INVALID（查询不到记录）", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue(null);
    const result = await refusal(service.verifyCode("alice@example.com", "123456"));
    expect(result.code).toBe("CODE_INVALID");
  });

  it("并发抢占失败（count=0）-> CODE_INVALID，不置位用户", async () => {
    const { service, prisma } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: "vc-1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
    });
    prisma.verificationCode.updateMany.mockResolvedValue({ count: 0 });

    const result = await refusal(service.verifyCode("alice@example.com", "123456"));
    expect(result.code).toBe("CODE_INVALID");
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("事务内用户更新失败 -> 抛出（不静默成功），并记录失败事件", async () => {
    const { service, prisma, record } = makeVerification();
    prisma.verificationCode.findFirst.mockResolvedValue({
      id: "vc-1",
      codeHash: sha256Hex("123456"),
      attempts: 0,
    });
    prisma.user.updateMany.mockRejectedValueOnce(new Error("db down"));

    await expect(service.verifyCode("alice@example.com", "123456")).rejects.toThrow("db down");
    expect(JSON.stringify(record.mock.calls)).toContain("EMAIL_VERIFICATION_FAILED");
  });
});

describe("SEC-005 — markEmailVerified 幂等且不抛 P2025", () => {
  it("邮箱不存在时返回 null，不抛异常", async () => {
    const prisma = {
      user: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findUnique: jest.fn(async () => null),
      },
    };
    const service = new AuthService(prisma as never, {} as never, undefined);
    await expect(service.markEmailVerified("ghost@example.com")).resolves.toBeNull();
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { email: "ghost@example.com" },
      data: { emailVerified: true },
    });
  });
});
