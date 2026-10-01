import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { AccessLogInterceptor, errorCodeOf } from "./access-log.interceptor";
import { AccessLogService } from "./access-log.service";
import { runWithRequestContext } from "./request-context";

/**
 * Security Audit Center (P1) — global HTTP access logging.
 *
 * Covers every outcome class the spec calls out (200/400/401/403/404/429/500),
 * the sensitive-data ban, and the fault-isolation rule: a failing audit write
 * must leave the original response untouched.
 */
type CreateArgs = { data: Record<string, unknown> };

function makeCreate() {
  return jest.fn(async (_args: CreateArgs) => ({}));
}

type CreateMock = ReturnType<typeof makeCreate>;

function makeAccessLogs() {
  const create = makeCreate();
  const prisma = { accessLog: { create } };
  const service = new AccessLogService(prisma as never);
  return { service, create };
}

function dataOf(create: CreateMock, call = 0): Record<string, unknown> {
  const invocation = create.mock.calls[call];
  if (!invocation) throw new Error("prisma.accessLog.create was never called");
  return invocation[0].data;
}

function makeContext(init: {
  method?: string;
  url?: string;
  query?: Record<string, unknown>;
  user?: { id: string } | undefined;
  statusCode?: number;
}) {
  const request = {
    method: init.method ?? "GET",
    originalUrl: init.url ?? "/api/v1/users/me",
    url: init.url ?? "/api/v1/users/me",
    query: init.query ?? {},
    headers: { "user-agent": "jest-agent" } as Record<string, string>,
    user: init.user,
  };
  const response = { statusCode: init.statusCode ?? 200 };
  const context = {
    getType: () => "http",
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, request, response };
}

async function runSuccess(
  interceptor: AccessLogInterceptor,
  context: ExecutionContext,
  value: unknown = { success: true },
) {
  return lastValueFrom(interceptor.intercept(context, { handle: () => of(value) }));
}

async function runError(
  interceptor: AccessLogInterceptor,
  context: ExecutionContext,
  error: unknown,
) {
  return lastValueFrom(
    interceptor.intercept(context, { handle: () => throwError(() => error) }),
  );
}

describe("AccessLogInterceptor — 成功与各种失败都会被记录", () => {
  it.each([
    ["200", 200, undefined],
    ["400", 400, new BadRequestException({ success: false, error: { code: "VALIDATION_ERROR" } })],
    ["401", 401, new UnauthorizedException({ success: false, error: { code: "INVALID_CREDENTIALS" } })],
    ["403", 403, new ForbiddenException("nope")],
    ["404", 404, new NotFoundException("missing")],
    ["429", 429, new HttpException({ success: false, error: { code: "RATE_LIMITED" } }, 429)],
    ["500", 500, new Error("kaboom")],
  ])("status %s 写入一条 AccessLog", async (_label, status, error) => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context, response } = makeContext({ user: { id: "user-1" } });
    response.statusCode = status as number;

    if (error) {
      await expect(runError(interceptor, context, error)).rejects.toBeDefined();
    } else {
      await runSuccess(interceptor, context);
    }

    expect(create).toHaveBeenCalledTimes(1);
    const data = dataOf(create);
    expect(data.statusCode).toBe(status);
    expect(data.method).toBe("GET");
    expect(data.path).toBe("/api/v1/users/me");
    expect(data.authenticated).toBe(true);
    expect(data.userId).toBe("user-1");
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("非 HttpException(500) 记录 INTERNAL_ERROR（与异常过滤器一致）", async () => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({});
    await expect(runError(interceptor, context, new Error("boom"))).rejects.toBeDefined();
    expect(dataOf(create).errorCode).toBe("INTERNAL_ERROR");
    expect(dataOf(create).riskLevel).toBe("LOW");
  });

  it("429 的 riskLevel 是 MEDIUM（不用 500 简单定级）", async () => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({});
    await expect(
      runError(interceptor, context, new HttpException({ success: false }, 429)),
    ).rejects.toBeDefined();
    expect(dataOf(create).riskLevel).toBe("MEDIUM");
  });

  it("admin 路由被标记为 isAdmin", async () => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({ url: "/api/v1/admin/users" });
    await runSuccess(interceptor, context);
    expect(dataOf(create).isAdmin).toBe(true);
  });

  it("未登录请求 authenticated=false 且 userId 为空", async () => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({});
    await runSuccess(interceptor, context);
    expect(dataOf(create).authenticated).toBe(false);
    expect(dataOf(create).userId).toBeNull();
  });
});

describe("AccessLogInterceptor — 不记录敏感数据", () => {
  it("只保存白名单 query 摘要，丢弃 token / email", async () => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({
      url: "/api/v1/notifications?page=2&token=SECRETVALUE&email=victim%40example.com",
      query: { page: "2", token: "SECRETVALUE", email: "victim@example.com" },
    });

    await runSuccess(interceptor, context);

    const data = dataOf(create);
    expect(data.queryDigest).toBe("page=2");
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("SECRETVALUE");
    expect(serialized).not.toContain("victim");
    expect(serialized).not.toContain("Bearer");
  });

  it("requestId 来自请求上下文", async () => {
    const { service, create } = makeAccessLogs();
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({});

    await runWithRequestContext({ requestId: "req-abc", ip: "203.0.113.1" }, () =>
      runSuccess(interceptor, context),
    );

    expect(dataOf(create).requestId).toBe("req-abc");
    expect(dataOf(create).ip).toBe("203.0.113.1");
  });
});

describe("AccessLogInterceptor — 故障隔离", () => {
  it("审计写入失败时业务响应仍然正常返回", async () => {
    const create = jest.fn(async (_args: CreateArgs) => {
      throw new Error("audit table is gone");
    });
    const service = new AccessLogService({ accessLog: { create } } as never);
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({});

    await expect(runSuccess(interceptor, context, { data: "payload" })).resolves.toEqual({
      data: "payload",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("审计写入失败时业务异常仍按原样抛出（不替换错误）", async () => {
    const create = jest.fn(async (_args: CreateArgs) => {
      throw new Error("audit table is gone");
    });
    const service = new AccessLogService({ accessLog: { create } } as never);
    const interceptor = new AccessLogInterceptor(service);
    const { context } = makeContext({});
    const original = new BadRequestException({ success: false, error: { code: "NOPE" } });

    await expect(runError(interceptor, context, original)).rejects.toBe(original);
  });
});

describe("errorCodeOf", () => {
  it("结构化错误码优先", () => {
    expect(errorCodeOf(new BadRequestException({ error: { code: "CODE_X" } }))).toBe("CODE_X");
  });
  it("裸 401 -> UNAUTHORIZED", () => {
    expect(errorCodeOf(new UnauthorizedException())).toBe("UNAUTHORIZED");
  });
  it("裸 400 -> HTTP_ERROR", () => {
    expect(errorCodeOf(new BadRequestException("x"))).toBe("HTTP_ERROR");
  });
  it("未知错误 -> INTERNAL_ERROR", () => {
    expect(errorCodeOf(new Error("boom"))).toBe("INTERNAL_ERROR");
  });
});
