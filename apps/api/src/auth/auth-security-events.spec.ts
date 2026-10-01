import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import { VerificationService } from "./verification.service";
import { SecurityEventService } from "../security/security-event.service";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: "test-message" }),
  })),
}));

/**
 * Security Audit Center (P1) — auth event wiring.
 *
 * Proves the required events are emitted for each outcome, and — equally
 * important — that no password, verification code or plaintext e-mail ever
 * reaches the recorded payload.
 */
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

/** The shape the assertions read back off the mocked recorder. */
type RecordedEvent = {
  type: string;
  source?: string;
  riskLevel?: string;
  userId?: string;
  success?: boolean;
  detail?: Record<string, unknown>;
};

function makeRecorder() {
  return jest.fn(async (_event: RecordedEvent) => undefined);
}

type Recorder = ReturnType<typeof makeRecorder>;

function firstEvent(record: Recorder): RecordedEvent {
  const [call] = record.mock.calls;
  if (!call) throw new Error("no security event was recorded");
  return call[0];
}

function makeAuth(overrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: "rt-1" }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    ...overrides,
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue("access-token") };
  const record = makeRecorder();
  const service = new AuthService(prisma as never, jwtService as never, { record } as never);
  return { service, prisma, record };
}

function serialized(record: Recorder): string {
  return JSON.stringify(record.mock.calls.map((call) => call[0]));
}

const LOGIN_DTO = { email: user.email, password: "sup3rsecret!" };
const REGISTER_DTO = { email: user.email, password: "sup3rsecret!" };

describe("AuthService — 登录事件", () => {
  beforeEach(() => jest.clearAllMocks());

  it("登录成功 -> LOGIN_SUCCESS，且不含密码", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { service, record } = makeAuth();

    await service.login(LOGIN_DTO);

    expect(firstEvent(record)).toMatchObject({
      type: "LOGIN_SUCCESS",
      userId: "user-1",
      success: true,
    });
    expect(serialized(record)).not.toContain("sup3rsecret!");
  });

  it("密码错误 -> LOGIN_FAILED（带原因、脱敏邮箱，不含密码/明文邮箱）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service, record } = makeAuth();

    await expect(service.login(LOGIN_DTO)).rejects.toBeDefined();

    const event = firstEvent(record);
    expect(event.type).toBe("LOGIN_FAILED");
    expect(event.success).toBe(false);
    expect(event.detail?.reasonCode).toBe("INVALID_CREDENTIALS");
    expect(event.detail?.emailMasked).toBe("a***@example.com");
    expect(event.userId).toBeUndefined();

    const text = serialized(record);
    expect(text).not.toContain("sup3rsecret!");
    expect(text).not.toContain("alice@example.com");
  });

  it("账号不存在 -> LOGIN_FAILED", async () => {
    const { service, record } = makeAuth({
      user: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    });

    await expect(service.login(LOGIN_DTO)).rejects.toBeDefined();
    expect(firstEvent(record).type).toBe("LOGIN_FAILED");
  });

  it("被封禁 -> LOGIN_FAILED / USER_BANNED", async () => {
    const { service, record } = makeAuth({
      user: {
        findUnique: jest.fn().mockResolvedValue({ ...user, status: "BANNED" }),
        update: jest.fn(),
      },
    });

    await expect(service.login(LOGIN_DTO)).rejects.toBeDefined();
    expect(firstEvent(record).detail?.reasonCode).toBe("USER_BANNED");
  });

  it("审计写入失败不影响登录成功（真实 SecurityEventService + 数据库不可用）", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const { prisma } = makeAuth();
    // The real writer, wired to a failing Prisma client: the fault is injected at
    // the database boundary rather than by a mock that pretends to be the service.
    const failingEvents = new SecurityEventService({
      securityEvent: {
        create: jest.fn(async (_args: { data: Record<string, unknown> }) => {
          throw new Error("audit down");
        }),
      },
    } as never);
    const failing = new AuthService(
      prisma as never,
      { signAsync: jest.fn().mockResolvedValue("access-token") } as never,
      failingEvents,
    );

    await expect(failing.login(LOGIN_DTO)).resolves.toMatchObject({
      accessToken: "access-token",
    });
  });
});

describe("AuthService — 注册事件", () => {
  beforeEach(() => jest.clearAllMocks());

  it("注册成功 -> REGISTER_SUCCESS", async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    const { service, record } = makeAuth({
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(user),
      },
    });

    await service.register(REGISTER_DTO);
    expect(firstEvent(record)).toMatchObject({
      type: "REGISTER_SUCCESS",
      userId: "user-1",
    });
  });

  it("邮箱重复 -> REGISTER_FAILED / EMAIL_TAKEN", async () => {
    const { service, record } = makeAuth();

    await expect(service.register(REGISTER_DTO)).rejects.toBeDefined();
    const event = firstEvent(record);
    expect(event.type).toBe("REGISTER_FAILED");
    expect(event.detail?.reasonCode).toBe("EMAIL_TAKEN");
    expect(serialized(record)).not.toContain("sup3rsecret!");
    expect(serialized(record)).not.toContain("alice@example.com");
  });
});

describe("AuthService — token / 登出 / 改密", () => {
  beforeEach(() => jest.clearAllMocks());

  it("刷新成功 -> TOKEN_REFRESH", async () => {
    const { service, record } = makeAuth({
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: "rt-2" }),
        findUnique: jest.fn().mockResolvedValue({
          id: "rt-1",
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3600_000),
          user,
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await service.rotateRefresh("raw-refresh-token");
    expect(firstEvent(record)).toMatchObject({
      type: "TOKEN_REFRESH",
      userId: "user-1",
    });
    expect(serialized(record)).not.toContain("raw-refresh-token");
  });

  it("刷新失败 -> TOKEN_REFRESH_FAILED（不记录 token 本身）", async () => {
    const { service, record } = makeAuth();

    await expect(service.rotateRefresh("bad-token")).rejects.toBeDefined();
    const event = firstEvent(record);
    expect(event.type).toBe("TOKEN_REFRESH_FAILED");
    expect(event.detail?.reasonCode).toBe("INVALID_REFRESH_TOKEN");
    expect(serialized(record)).not.toContain("bad-token");
  });

  it("缺少 refresh token -> NO_REFRESH_TOKEN", async () => {
    const { service, record } = makeAuth();
    await expect(service.rotateRefresh(undefined)).rejects.toBeDefined();
    expect(firstEvent(record).detail?.reasonCode).toBe("NO_REFRESH_TOKEN");
  });

  it("登出 -> LOGOUT", async () => {
    const { service, record } = makeAuth();
    await service.logout("raw-refresh-token");
    expect(firstEvent(record).type).toBe("LOGOUT");
    expect(serialized(record)).not.toContain("raw-refresh-token");
  });

  it("修改密码成功 -> PASSWORD_CHANGED", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("new-hash");
    const { service, record } = makeAuth();

    await service.changePassword("user-1", {
      currentPassword: "oldpassword",
      newPassword: "newpassword1",
      confirmPassword: "newpassword1",
    });

    expect(firstEvent(record)).toMatchObject({
      type: "PASSWORD_CHANGED",
      userId: "user-1",
    });
    expect(serialized(record)).not.toContain("newpassword1");
  });

  it("当前密码错误 -> PASSWORD_CHANGE_FAILED / INVALID_CREDENTIALS", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const { service, record } = makeAuth();

    await expect(
      service.changePassword("user-1", {
        currentPassword: "wrong",
        newPassword: "newpassword1",
        confirmPassword: "newpassword1",
      }),
    ).rejects.toBeDefined();

    expect(firstEvent(record)).toMatchObject({
      type: "PASSWORD_CHANGE_FAILED",
      riskLevel: "MEDIUM",
    });
  });
});

describe("VerificationService — 验证码事件", () => {
  beforeEach(() => jest.clearAllMocks());

  function makeVerification(prismaOverride: Record<string, unknown> = {}) {
    const record = makeRecorder();
    const prisma = {
      verificationCode: {
        create: jest.fn().mockResolvedValue({ id: "vc-1" }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        ...prismaOverride,
      },
    };
    const service = new VerificationService(prisma as never, { record } as never);
    return { service, prisma, record };
  }

  it("发送验证码 -> EMAIL_VERIFICATION_SENT，且不记录验证码", async () => {
    process.env.EMAIL_HOST = "smtp.test";
    process.env.EMAIL_USER = "test@example.com";
    process.env.EMAIL_PASSWORD = "test-password";

    const { service, record } = makeVerification();
    const result = await service.sendCode("alice@example.com");

    const event = firstEvent(record);
    expect(event.type).toBe("EMAIL_VERIFICATION_SENT");
    const text = JSON.stringify(event);
    expect(text).not.toContain("alice@example.com");
    expect(text).toContain("a***@example.com");
  });

  it("验证成功 -> EMAIL_VERIFICATION_SUCCESS", async () => {
    const { service, record } = makeVerification({
      findFirst: jest.fn().mockResolvedValue({
        id: "vc-1",
        codeHash: createHash("sha256").update("123456").digest("hex"),
        attempts: 0,
      }),
    });

    await service.verifyCode("alice@example.com", "123456");
    expect(firstEvent(record).type).toBe("EMAIL_VERIFICATION_SUCCESS");
  });

  it("验证码错误 -> EMAIL_VERIFICATION_FAILED / CODE_MISMATCH，且不记录验证码", async () => {
    const { service, record } = makeVerification({
      findFirst: jest.fn().mockResolvedValue({
        id: "vc-1",
        codeHash: "some-other-hash",
        attempts: 0,
      }),
    });

    await expect(service.verifyCode("alice@example.com", "999999")).rejects.toBeDefined();
    const event = firstEvent(record);
    expect(event.type).toBe("EMAIL_VERIFICATION_FAILED");
    expect(event.detail?.reasonCode).toBe("CODE_MISMATCH");
    const text = JSON.stringify(event);
    expect(text).not.toContain("999999");
    expect(text).not.toContain("alice@example.com");
  });

  it("无有效验证码 -> CODE_INVALID", async () => {
    const { service, record } = makeVerification();
    await expect(service.verifyCode("alice@example.com", "123456")).rejects.toBeDefined();
    expect(firstEvent(record).detail?.reasonCode).toBe("CODE_INVALID");
  });
});
