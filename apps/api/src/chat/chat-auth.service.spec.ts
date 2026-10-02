import { ChatAuthService, type SocketAuthFailure } from "./chat-auth.service";
import { socketAuthError } from "./chat.gateway";

/**
 * SEC-005 follow-up — the Socket.IO handshake must honour the same e-mail
 * verification gate as `JwtStrategy`.
 *
 * Before this, `ChatAuthService` selected only `{ id, email, status }`, so with
 * enforcement on the HTTP business API refused an unverified account while a
 * chat socket was still allowed to connect. These tests drive the real service
 * against a stateful user store so the four required cases (off/unverified,
 * on/verified, on/unverified, verified-after-rejection) are checked as
 * behaviour rather than by reading source.
 *
 * Socket refusal codes are the service-level `SocketAuthFailure` values; the
 * gateway maps them to the client `error` payload. SEC-002's status verdicts
 * (ACTIVE / DISABLED / SUSPENDED / BANNED) must be unchanged.
 */

const ACCESS_PAYLOAD = { sub: "user-1", email: "alice@example.test", type: "access" };

type UserRow = {
  id: string;
  email: string;
  status: string;
  emailVerified: boolean;
};

const ACTIVE_VERIFIED: UserRow = {
  id: "user-1",
  email: "alice@example.test",
  status: "ACTIVE",
  emailVerified: true,
};

const ACTIVE_UNVERIFIED: UserRow = { ...ACTIVE_VERIFIED, emailVerified: false };

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

/** A mock whose `user.findUnique` can be re-pointed at any snapshot per call. */
function makeService(initial: UserRow | null = ACTIVE_VERIFIED) {
  let current = initial;
  const findUnique = jest.fn(async () => current);
  const prisma = { user: { findUnique } };
  const verifyAsync = jest.fn(async () => ACCESS_PAYLOAD);
  const jwtService = { verifyAsync };
  const service = new ChatAuthService(jwtService as never, prisma as never);
  return {
    service,
    findUnique,
    verifyAsync,
    setUser: (row: UserRow | null) => {
      current = row;
    },
  };
}

async function handshake(
  service: ChatAuthService,
  enforcement: boolean,
  token: string | undefined = "raw-access-token",
) {
  return withEnforcement(enforcement, () => service.verifyAccessToken(token));
}

describe("ChatAuthService — SEC-005 WebSocket e-mail verification gate", () => {
  it("enforcement 关闭 + 未验证 -> 握手通过（行为不变）", async () => {
    const { service } = makeService(ACTIVE_UNVERIFIED);
    const result = await handshake(service, false);
    expect(result).toEqual({
      user: { id: "user-1", email: "alice@example.test" },
      failure: null,
    });
  });

  it("enforcement 开启 + 已验证 -> 握手通过", async () => {
    const { service } = makeService(ACTIVE_VERIFIED);
    const result = await handshake(service, true);
    expect(result.user).toEqual({ id: "user-1", email: "alice@example.test" });
    expect(result.failure).toBeNull();
  });

  it("enforcement 开启 + 未验证 -> 拒绝 EMAIL_VERIFIED_REQUIRED", async () => {
    const { service } = makeService(ACTIVE_UNVERIFIED);
    const result = await handshake(service, true);
    expect(result.user).toBeNull();
    expect(result.failure).toBe<SocketAuthFailure>("EMAIL_VERIFIED_REQUIRED");
  });

  it("拒绝时不泄露邮箱（user 为 null，无可读用户信息）", async () => {
    const { service } = makeService(ACTIVE_UNVERIFIED);
    const result = await handshake(service, true);
    expect(result.user).toBeNull();
    expect(JSON.stringify(result)).not.toContain("alice@example.test");
  });

  it("验证邮箱后，同一个未过期 token 重新握手即通过（无需重新登录）", async () => {
    const h = makeService(ACTIVE_UNVERIFIED);

    const before = await handshake(h.service, true);
    expect(before.failure).toBe<SocketAuthFailure>("EMAIL_VERIFIED_REQUIRED");

    // The database is the source of truth, re-read on every handshake.
    h.setUser(ACTIVE_VERIFIED);
    const after = await handshake(h.service, true);
    expect(after.failure).toBeNull();
    expect(after.user).toEqual({ id: "user-1", email: "alice@example.test" });
  });

  it("注册后签发的旧 token（未验证）无法绕过：enforcement 开启时始终拒绝", async () => {
    const { service } = makeService(ACTIVE_UNVERIFIED);
    // Strategy A lets an unverified account refresh, so a valid access token can
    // exist before verification — it must still be refused at the socket.
    const result = await handshake(service, true);
    expect(result.user).toBeNull();
    expect(result.failure).toBe<SocketAuthFailure>("EMAIL_VERIFIED_REQUIRED");
  });

  it("只在需要时查询 emailVerified（select 精确）", async () => {
    const { service, findUnique } = makeService(ACTIVE_VERIFIED);
    await handshake(service, true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true, email: true, status: true, emailVerified: true },
    });
  });
});

describe("ChatAuthService — SEC-002 状态控制不被破坏", () => {
  it.each<[string, string | null]>([
    ["ACTIVE", null],
    ["DISABLED", "DISABLED"],
    ["SUSPENDED", "DISABLED"],
    ["BANNED", "BANNED"],
  ])("enforcement 关闭：%s -> %s", async (status, expected) => {
    const { service } = makeService({
      id: "user-1",
      email: "alice@example.test",
      status,
      emailVerified: false,
    });
    const result = await handshake(service, false);
    expect(result.failure).toBe(expected as SocketAuthFailure | null);
  });

  // With enforcement on and the account unverified, ACTIVE is gated but a status
  // verdict must still win: a disabled/suspended/banned account is reported as
  // such, never downgraded to the generic e-mail gate. This is the ordering
  // guarantee SEC-002 relies on.
  it.each<[string, string | null]>([
    ["ACTIVE", "EMAIL_VERIFIED_REQUIRED"],
    ["DISABLED", "DISABLED"],
    ["SUSPENDED", "DISABLED"],
    ["BANNED", "BANNED"],
  ])("enforcement 开启 + 未验证：%s -> %s（状态判定优先于邮箱门禁）", async (status, expected) => {
    const { service } = makeService({
      id: "user-1",
      email: "alice@example.test",
      status,
      emailVerified: false,
    });
    const result = await handshake(service, true);
    expect(result.failure).toBe(expected as SocketAuthFailure | null);
  });

  it("BANNED 优先于未验证：返回 BANNED 而非 EMAIL_VERIFIED_REQUIRED", async () => {
    const { service } = makeService({
      id: "user-1",
      email: "alice@example.test",
      status: "BANNED",
      emailVerified: false,
    });
    const result = await handshake(service, true);
    expect(result.failure).toBe<SocketAuthFailure>("BANNED");
  });
});

describe("ChatAuthService — 令牌与用户解析（既有行为）", () => {
  it("缺少 token -> MISSING", async () => {
    const { service } = makeService();
    const result = await withEnforcement(true, () => service.verifyAccessToken(undefined));
    expect(result).toEqual({ user: null, failure: "MISSING" });
  });

  it("token 无效（verifyAsync 抛错）-> INVALID", async () => {
    const { service, verifyAsync } = makeService();
    verifyAsync.mockRejectedValueOnce(new Error("bad signature"));
    const result = await handshake(service, true);
    expect(result).toEqual({ user: null, failure: "INVALID" });
  });

  it("非 access 类型 token -> INVALID", async () => {
    const { service, verifyAsync } = makeService();
    verifyAsync.mockResolvedValueOnce({ sub: "user-1", email: "a@b.test", type: "refresh" });
    const result = await handshake(service, true);
    expect(result).toEqual({ user: null, failure: "INVALID" });
  });

  it("用户不存在 -> INVALID", async () => {
    const { service } = makeService(null);
    const result = await handshake(service, true);
    expect(result).toEqual({ user: null, failure: "INVALID" });
  });
});

describe("socketAuthError — 失败码到客户端 error 载荷", () => {
  it("EMAIL_VERIFIED_REQUIRED 与 HTTP 侧语义一致", () => {
    expect(socketAuthError("EMAIL_VERIFIED_REQUIRED")).toEqual({
      code: "EMAIL_VERIFIED_REQUIRED",
      message: "Verify your email address to continue",
    });
  });

  it("SEC-002 状态码保持不变", () => {
    expect(socketAuthError("BANNED").code).toBe("USER_BANNED");
    expect(socketAuthError("DISABLED").code).toBe("USER_DISABLED");
  });

  it("未知/缺失/无效 token 统一为 UNAUTHORIZED", () => {
    for (const failure of ["MISSING", "INVALID", null] as const) {
      expect(socketAuthError(failure).code).toBe("UNAUTHORIZED");
    }
  });

  it("错误载荷不包含邮箱、验证码或 token", () => {
    const payload = JSON.stringify(socketAuthError("EMAIL_VERIFIED_REQUIRED"));
    expect(payload).not.toContain("@");
    expect(payload).not.toContain("token");
  });
});
