import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerException, ThrottlerModule, type ThrottlerLimitDetail } from "@nestjs/throttler";
import { HttpThrottlerGuard } from "./http-throttler.guard";
import { AccessLogService } from "../security/access-log.service";
import { SecurityEventService } from "../security/security-event.service";
import { runWithRequestContext } from "../security/request-context";

/**
 * Security Audit Center (P1) — the 429 hook.
 *
 * Guards run before interceptors, so a throttled request never reaches the
 * access-log interceptor. This suite proves the guard still emits both records
 * *and* that the throttling contract itself is unchanged.
 */
function makeContext(user?: { id: string }) {
  const request = {
    method: "POST",
    originalUrl: "/api/v1/auth/login?x=1",
    url: "/api/v1/auth/login?x=1",
    query: { x: "1", page: "3" },
    headers: { "user-agent": "jest-agent" } as Record<string, string>,
    user,
  };
  const context = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
  return { context, request };
}

type RecordMock = jest.Mock<Promise<void>, [Record<string, unknown>]>;
type WriteMock = jest.Mock<Promise<void>, [Record<string, unknown>]>;

type GuardInternals = {
  securityEvents?: { record: RecordMock };
  accessLogs?: { write: WriteMock };
  throwThrottlingException: (
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ) => Promise<void>;
};

const DETAIL = {} as ThrottlerLimitDetail;

function makeRecord(): RecordMock {
  return jest.fn(async (_input: Record<string, unknown>) => undefined);
}

function makeWrite(): WriteMock {
  return jest.fn(async (_input: Record<string, unknown>) => undefined);
}

function argOf<T>(mock: jest.Mock, call = 0): T {
  const invocation = mock.mock.calls[call];
  if (!invocation) throw new Error("mock was never called");
  return invocation[0] as T;
}

describe("HttpThrottlerGuard — 429 观测", () => {
  it("真正被限流时记录 RATE_LIMITED 安全事件与 429 访问日志，并仍然抛出 429", async () => {
    const guard = new HttpThrottlerGuard([] as never, {} as never, new Reflector());
    const internals = guard as unknown as GuardInternals;
    const record = makeRecord();
    const write = makeWrite();
    internals.securityEvents = { record };
    internals.accessLogs = { write };

    const { context } = makeContext({ id: "user-1" });

    await expect(internals.throwThrottlingException(context, DETAIL)).rejects.toBeInstanceOf(
      ThrottlerException,
    );

    expect(record).toHaveBeenCalledTimes(1);
    const event = argOf<Record<string, unknown>>(record);
    expect(event.type).toBe("RATE_LIMITED");
    expect(event.source).toBe("THROTTLE");
    expect(event.statusCode).toBe(429);
    expect(event.success).toBe(false);
    expect(event.userId).toBe("user-1");
    expect(event.path).toBe("/api/v1/auth/login");

    expect(write).toHaveBeenCalledTimes(1);
    const log = argOf<Record<string, unknown>>(write);
    expect(log.statusCode).toBe(429);
    expect(log.errorCode).toBe("RATE_LIMITED");
    expect(log.riskLevel).toBe("MEDIUM");
    expect(log.queryDigest).toBe("page=3");
  });

  it("观测依赖缺失时不影响限流本身", async () => {
    const guard = new HttpThrottlerGuard([] as never, {} as never, new Reflector());
    const internals = guard as unknown as GuardInternals;
    const { context } = makeContext();
    await expect(internals.throwThrottlingException(context, DETAIL)).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it("记录失败时仍然抛出 429（观测绝不吞掉限流）", async () => {
    const guard = new HttpThrottlerGuard([] as never, {} as never, new Reflector());
    const internals = guard as unknown as GuardInternals;
    internals.securityEvents = {
      record: jest.fn(() => {
        throw new Error("audit exploded");
      }) as unknown as RecordMock,
    };
    internals.accessLogs = {
      write: jest.fn(() => {
        throw new Error("audit exploded");
      }) as unknown as WriteMock,
    };
    const { context } = makeContext();
    await expect(internals.throwThrottlingException(context, DETAIL)).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it("requestId / ip 来自请求上下文", async () => {
    const guard = new HttpThrottlerGuard([] as never, {} as never, new Reflector());
    const internals = guard as unknown as GuardInternals;
    const record = makeRecord();
    const write = makeWrite();
    internals.securityEvents = { record };
    internals.accessLogs = { write };
    const { context } = makeContext();

    await runWithRequestContext({ requestId: "req-throttle", ip: "203.0.113.4" }, async () => {
      await expect(internals.throwThrottlingException(context, DETAIL)).rejects.toBeDefined();
    });

    expect(argOf<Record<string, unknown>>(record).requestId).toBe("req-throttle");
    expect(argOf<Record<string, unknown>>(record).ip).toBe("203.0.113.4");
  });
});

describe("HttpThrottlerGuard — 依赖注入", () => {
  it("通过属性注入拿到 SecurityEventService / AccessLogService", async () => {
    const events = { record: jest.fn() };
    const logs = { write: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 120 }])],
      providers: [
        HttpThrottlerGuard,
        { provide: SecurityEventService, useValue: events },
        { provide: AccessLogService, useValue: logs },
      ],
    }).compile();

    const guard = moduleRef.get(HttpThrottlerGuard);
    const internals = guard as unknown as { securityEvents?: unknown; accessLogs?: unknown };
    expect(internals.securityEvents).toBe(events);
    expect(internals.accessLogs).toBe(logs);

    await moduleRef.close();
  });
});
