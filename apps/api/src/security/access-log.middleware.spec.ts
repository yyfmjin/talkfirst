import type { NextFunction, Request, Response } from "express";
import {
  ERROR_CODE_HEADER,
  createAccessLogMiddleware,
  isAdminPath,
  pathOf,
  resolveErrorCode,
  statusErrorCode,
} from "./access-log.middleware";
import { AccessLogService } from "./access-log.service";
import { runWithRequestContext } from "./request-context";

/**
 * Phase O1 — access logging moved from an interceptor to a middleware.
 *
 * Covers every outcome class the original interceptor spec covered
 * (200/400/401/403/404/429/500), the sensitive-data ban, and the fault-isolation
 * rule. It adds the cases that motivated the move: a request rejected by a guard
 * and a request that matches no route at all must BOTH still be recorded, which
 * an interceptor could never do because guards short-circuit before it runs.
 */
type CreateArgs = { data: Record<string, unknown> };
type CreateMock = jest.Mock<Promise<unknown>, [CreateArgs]>;

function makeAccessLogs(): { service: AccessLogService; create: CreateMock } {
  const create = jest.fn(async (_args: CreateArgs) => ({})) as unknown as CreateMock;
  const prisma = { accessLog: { create } };
  return { service: new AccessLogService(prisma as never), create };
}

function dataOf(create: CreateMock, call = 0): Record<string, unknown> {
  const invocation = create.mock.calls[call];
  if (!invocation) throw new Error("prisma.accessLog.create was never called");
  return invocation[0].data;
}

/**
 * Minimal Express exchange. `finish()` emits the `finish` event the middleware
 * listens on, which is how every response — handler, guard or 404 — is observed.
 */
function makeExchange(init: {
  method?: string;
  url?: string;
  query?: Record<string, unknown>;
  user?: { id: string } | undefined;
  statusCode?: number;
  errorCodeHeader?: string;
  userAgent?: string;
}) {
  const listeners: Record<string, Array<() => void>> = {};
  const headers: Record<string, string> = {};
  if (init.errorCodeHeader) headers[ERROR_CODE_HEADER] = init.errorCodeHeader;

  const request = {
    method: init.method ?? "GET",
    originalUrl: init.url ?? "/api/v1/users/me",
    url: init.url ?? "/api/v1/users/me",
    query: init.query ?? {},
    headers: { "user-agent": init.userAgent ?? "jest-agent" } as Record<string, string>,
    user: init.user,
  } as unknown as Request;

  const response = {
    statusCode: init.statusCode ?? 200,
    once: (event: string, handler: () => void) => {
      (listeners[event] ??= []).push(handler);
      return response;
    },
    getHeader: (name: string) => headers[name.toLowerCase()] ?? headers[name],
  };

  return {
    request,
    response: response as unknown as Response,
    finish: () => (listeners.finish ?? []).forEach((handler) => handler()),
  };
}

function runMiddleware(
  accessLogs: AccessLogService,
  exchange: ReturnType<typeof makeExchange>,
  devices?: unknown,
) {
  const middleware = createAccessLogMiddleware(accessLogs, devices as never);
  middleware(exchange.request, exchange.response, (() => undefined) as NextFunction);
}

describe("AccessLogMiddleware — 每个响应都会留下一条记录", () => {
  it.each([
    ["200", 200],
    ["400", 400],
    ["401", 401],
    ["403", 403],
    ["404", 404],
    ["429", 429],
    ["500", 500],
  ])("status %s 写入一条 AccessLog", async (_label, status) => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({ user: { id: "user-1" }, statusCode: status });
    runMiddleware(service, exchange);
    exchange.finish();

    expect(create).toHaveBeenCalledTimes(1);
    const data = dataOf(create);
    expect(data.statusCode).toBe(status);
    expect(data.method).toBe("GET");
    expect(data.path).toBe("/api/v1/users/me");
    expect(data.authenticated).toBe(true);
    expect(data.userId).toBe("user-1");
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("守卫拒绝（401，未经 handler/拦截器）依然被记录 —— 这正是迁移的原因", async () => {
    const { service, create } = makeAccessLogs();
    // No `user`: a guard rejected the request, so Passport never populated it.
    const exchange = makeExchange({ url: "/api/v1/users/me", statusCode: 401 });
    runMiddleware(service, exchange);
    exchange.finish();

    expect(create).toHaveBeenCalledTimes(1);
    const data = dataOf(create);
    expect(data.statusCode).toBe(401);
    expect(data.authenticated).toBe(false);
    expect(data.userId).toBeNull();
    expect(data.errorCode).toBe("UNAUTHORIZED");
  });

  it("未匹配路由（404）也被记录，因为没有任何 handler 会运行", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({ url: "/api/v1/definitely-not-a-route", statusCode: 404 });
    runMiddleware(service, exchange);
    exchange.finish();

    expect(dataOf(create).statusCode).toBe(404);
    expect(dataOf(create).errorCode).toBe("NOT_FOUND");
  });

  it("admin 路由被标记为 isAdmin", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({ url: "/api/v1/admin/users" });
    runMiddleware(service, exchange);
    exchange.finish();
    expect(dataOf(create).isAdmin).toBe(true);
  });

  it("未登录请求 authenticated=false 且 userId 为空", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({});
    runMiddleware(service, exchange);
    exchange.finish();
    expect(dataOf(create).authenticated).toBe(false);
    expect(dataOf(create).userId).toBeNull();
  });

  it("成功响应不写 errorCode（存储层把 undefined 归一为 NULL）", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({ statusCode: 200 });
    runMiddleware(service, exchange);
    exchange.finish();
    // The middleware omits the field; `AccessLogService` maps it to `null` for
    // the nullable column, which is the same thing at the database level.
    expect(dataOf(create).errorCode ?? null).toBeNull();
  });

  it("429 的 riskLevel 是 MEDIUM（不用 500 简单定级）", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({ statusCode: 429 });
    runMiddleware(service, exchange);
    exchange.finish();
    expect(dataOf(create).riskLevel).toBe("MEDIUM");
  });
});

describe("AccessLogMiddleware — 不记录敏感数据", () => {
  it("只保存白名单 query 摘要，丢弃 token / email", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({
      url: "/api/v1/notifications?page=2&token=SECRETVALUE&email=victim%40example.com",
      query: { page: "2", token: "SECRETVALUE", email: "victim@example.com" },
    });
    runMiddleware(service, exchange);
    exchange.finish();

    const data = dataOf(create);
    expect(data.queryDigest).toBe("page=2");
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("SECRETVALUE");
    expect(serialized).not.toContain("victim");
    expect(serialized).not.toContain("Bearer");
  });

  it("requestId / ip 来自请求上下文", async () => {
    const { service, create } = makeAccessLogs();
    const exchange = makeExchange({});

    runWithRequestContext({ requestId: "req-abc", ip: "203.0.113.1" }, () => {
      runMiddleware(service, exchange);
      exchange.finish();
    });

    expect(dataOf(create).requestId).toBe("req-abc");
    expect(dataOf(create).ip).toBe("203.0.113.1");
  });
});

describe("AccessLogMiddleware — 故障隔离", () => {
  it("审计写入失败时不影响响应（finish 处理器不抛）", () => {
    const create = jest.fn(async (_args: CreateArgs) => {
      throw new Error("audit table is gone");
    });
    const service = new AccessLogService({ accessLog: { create } } as never);
    const exchange = makeExchange({});

    runMiddleware(service, exchange);
    expect(() => exchange.finish()).not.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("AccessLogMiddleware — 错误码解析", () => {
  it("优先采用异常过滤器回显的真实领域码", () => {
    const exchange = makeExchange({ statusCode: 403, errorCodeHeader: "PERMISSION_DENIED" });
    expect(resolveErrorCode(exchange.response)).toBe("PERMISSION_DENIED");
  });

  it("没有回显时按状态码推导（守卫拒绝 / Nest 内建 404 走这条）", () => {
    expect(resolveErrorCode(makeExchange({ statusCode: 401 }).response)).toBe("UNAUTHORIZED");
    expect(resolveErrorCode(makeExchange({ statusCode: 404 }).response)).toBe("NOT_FOUND");
  });

  it("statusErrorCode 覆盖常见状态并区分 4xx/5xx", () => {
    expect(statusErrorCode(400)).toBe("VALIDATION_ERROR");
    expect(statusErrorCode(409)).toBe("CONFLICT");
    expect(statusErrorCode(429)).toBe("RATE_LIMITED");
    expect(statusErrorCode(418)).toBe("HTTP_ERROR");
    expect(statusErrorCode(503)).toBe("INTERNAL_ERROR");
  });

  it("isAdminPath 只匹配 admin 前缀", () => {
    expect(isAdminPath("/api/v1/admin/users")).toBe(true);
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/api/v1/users/me")).toBe(false);
    expect(isAdminPath("/api/v1/administrators")).toBe(false);
  });

  it("pathOf 去掉查询串并截断到 256", () => {
    const request = { originalUrl: `/api/v1/x?page=2` } as unknown as Request;
    expect(pathOf(request)).toBe("/api/v1/x");
    const long = { originalUrl: "/" + "a".repeat(400) } as unknown as Request;
    expect(pathOf(long).length).toBe(256);
  });
});
