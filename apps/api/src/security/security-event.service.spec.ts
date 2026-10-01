import { runWithRequestContext } from "./request-context";
import { SecurityEventService } from "./security-event.service";
import { RiskLevel, SecurityEventSource, SecurityEventType } from "./security.constants";

/**
 * Security Audit Center (P1) — the event writer.
 *
 * Two guarantees are tested here: nothing sensitive reaches Prisma, and an audit
 * failure can never propagate into the business request that triggered it.
 */
type CreateArgs = { data: Record<string, unknown> };

function makeCreate() {
  return jest.fn(async (_args: CreateArgs) => ({}));
}

type CreateMock = ReturnType<typeof makeCreate>;

function dataOf(create: CreateMock, call = 0): Record<string, unknown> {
  const invocation = create.mock.calls[call];
  if (!invocation) throw new Error("prisma.securityEvent.create was never called");
  return invocation[0].data;
}

function makeService() {
  const create = makeCreate();
  const prisma = { securityEvent: { create } };
  const service = new SecurityEventService(prisma as never);
  return { service, create };
}

describe("SecurityEventService.record", () => {
  it("从请求上下文补齐 ip / userAgent / requestId / method / path", async () => {
    const { service, create } = makeService();

    await runWithRequestContext(
      {
        requestId: "req-123",
        ip: "203.0.113.7",
        userAgent: "jest-agent",
        method: "POST",
        path: "/api/v1/auth/login",
      },
      () => service.record({ type: SecurityEventType.LOGIN_SUCCESS }),
    );

    const data = dataOf(create);
    expect(data.requestId).toBe("req-123");
    expect(data.ip).toBe("203.0.113.7");
    expect(data.userAgent).toBe("jest-agent");
    expect(data.method).toBe("POST");
    expect(data.path).toBe("/api/v1/auth/login");
    expect(data.source).toBe(SecurityEventSource.SYSTEM);
    expect(data.riskLevel).toBe(RiskLevel.LOW);
    expect(data.success).toBe(true);
  });

  it("显式传入的字段优先于请求上下文", async () => {
    const { service, create } = makeService();

    await runWithRequestContext({ requestId: "req-123", ip: "1.1.1.1" }, () =>
      service.record({
        type: SecurityEventType.RATE_LIMITED,
        ip: "2.2.2.2",
        requestId: "req-999",
      }),
    );

    const data = dataOf(create);
    expect(data.ip).toBe("2.2.2.2");
    expect(data.requestId).toBe("req-999");
  });

  it("detail 中的密码 / 验证码在落库前被脱敏", async () => {
    const { service, create } = makeService();

    await service.record({
      type: SecurityEventType.LOGIN_FAILED,
      detail: {
        password: "hunter2",
        code: "482913",
        refreshToken: "deadbeef",
        emailMasked: "a***@example.com",
        reasonCode: "INVALID_CREDENTIALS",
      },
    });

    const stored = JSON.stringify(dataOf(create));
    expect(stored).not.toContain("hunter2");
    expect(stored).not.toContain("482913");
    expect(stored).not.toContain("deadbeef");
    expect(stored).toContain("[REDACTED]");
    expect(stored).toContain("a***@example.com");
  });

  it("detail 超长时被压缩", async () => {
    const { service, create } = makeService();
    // Redaction caps each string, so the payload only overflows the row budget
    // once it has many entries — 40 × 500 chars ≈ 20k, well past MAX_JSON_CHARS.
    await service.record({
      type: SecurityEventType.API_ACCESS,
      detail: { list: Array.from({ length: 40 }, () => "x".repeat(500)) },
    });
    const detail = dataOf(create).detail as { truncated?: boolean };
    expect(detail.truncated).toBe(true);
  });

  it("数据库写入失败时不抛错（故障隔离）", async () => {
    const create = jest.fn(async (_args: CreateArgs) => {
      throw new Error("audit table is gone");
    });
    const service = new SecurityEventService({ securityEvent: { create } } as never);

    await expect(
      service.record({ type: SecurityEventType.LOGIN_SUCCESS }),
    ).resolves.toBeUndefined();
  });

  it("deviceHash 在缺少 salt 时为 null（不静默使用固定默认值）", async () => {
    const previous = process.env.SECURITY_DEVICE_SALT;
    delete process.env.SECURITY_DEVICE_SALT;
    try {
      const { service, create } = makeService();
      await runWithRequestContext({ requestId: "req-1", userAgent: "some-agent" }, () =>
        service.record({ type: SecurityEventType.LOGIN_SUCCESS }),
      );
      expect(dataOf(create).deviceHash).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.SECURITY_DEVICE_SALT;
      else process.env.SECURITY_DEVICE_SALT = previous;
    }
  });
});
