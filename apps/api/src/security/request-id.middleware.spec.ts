import type { NextFunction, Request, Response } from "express";
import {
  REQUEST_ID_HEADER,
  createRequestIdMiddleware,
  resolveRequestId,
  sanitizeRequestId,
} from "./request-id.middleware";
import { getRequestContext, type RequestContext } from "./request-context";
import { getClientIp, normalizeIp, trustProxySetting } from "./client-ip";
import { deviceHash, normalizeUserAgent } from "./device-hash";

/**
 * Security Audit Center (P1) — request id, client IP and device identity.
 */
function makeExchange(headers: Record<string, string> = {}, ip = "203.0.113.9") {
  const setHeader = jest.fn((_name: string, _value: string) => undefined);
  const request = {
    headers,
    ip,
    method: "POST",
    originalUrl: "/api/v1/auth/login?redirect=/x",
    url: "/api/v1/auth/login?redirect=/x",
  } as unknown as Request;
  const response = { setHeader } as unknown as Response;
  return { request, response, setHeader };
}

describe("requestId", () => {
  it("接受合法上游 id", () => {
    expect(sanitizeRequestId("abc-123-XYZ_9")).toBe("abc-123-XYZ_9");
  });

  it("拒绝过短 / 过长 / 非法字符", () => {
    expect(sanitizeRequestId("short")).toBeUndefined();
    expect(sanitizeRequestId("a".repeat(65))).toBeUndefined();
    expect(sanitizeRequestId("bad value with spaces")).toBeUndefined();
    expect(sanitizeRequestId("bad\nvalue")).toBeUndefined();
    expect(sanitizeRequestId(12345)).toBeUndefined();
  });

  it("缺失时生成 UUID", () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("合法上游 id 被保留", () => {
    expect(resolveRequestId("trace-0001-abc")).toBe("trace-0001-abc");
  });
});

describe("createRequestIdMiddleware", () => {
  it("回写响应头并把上下文绑定到 next() 之内", () => {
    const { request, response, setHeader } = makeExchange({
      [REQUEST_ID_HEADER]: "trace-abc-123",
      "user-agent": "jest-agent/1.0",
    });
    const middleware = createRequestIdMiddleware();
    let seen: RequestContext | undefined;

    middleware(request, response, (() => {
      seen = getRequestContext();
    }) as NextFunction);

    expect(setHeader).toHaveBeenCalledWith("X-Request-Id", "trace-abc-123");
    expect(seen?.requestId).toBe("trace-abc-123");
    expect(seen?.path).toBe("/api/v1/auth/login");
    expect(seen?.method).toBe("POST");
    expect(seen?.ip).toBe("203.0.113.9");
    expect(seen?.userAgent).toBe("jest-agent/1.0");
  });

  it("非法上游 id 被替换，不会进入审计", () => {
    const { request, response, setHeader } = makeExchange({
      [REQUEST_ID_HEADER]: "x".repeat(500),
    });
    createRequestIdMiddleware()(request, response, (() => undefined) as NextFunction);

    const written = setHeader.mock.calls[0]?.[1] ?? "";
    expect(written).not.toContain("xxxxx");
    expect(written).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("请求结束后上下文被清理", () => {
    const { request, response } = makeExchange({});
    createRequestIdMiddleware()(request, response, (() => undefined) as NextFunction);
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("client-ip", () => {
  it("normalizeIp 去掉 IPv4 端口与 IPv4-mapped 前缀", () => {
    expect(normalizeIp("203.0.113.5:1234")).toBe("203.0.113.5");
    expect(normalizeIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("normalizeIp 把 IPv6 回环折到 IPv4 形式，且只匹配精确的 ::1", () => {
    // Phase O1: live data had `::1` in AccessLog.ip while IPv4 locals were
    // `127.0.0.1`, so one client was being recorded under two keys.
    expect(normalizeIp("::1")).toBe("127.0.0.1");
    expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("0:0:0:0:0:0:0:1")).toBe("127.0.0.1");
    // Anchored: a real IPv6 address that merely ends in `::1` must not be folded.
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("fe80::1")).toBe("fe80::1");
  });

  it("normalizeIp 解开带方括号的 IPv6 主机与端口", () => {
    expect(normalizeIp("[::1]:1234")).toBe("127.0.0.1");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("只读取 req.ip，忽略可伪造的转发头", () => {
    const request = {
      ip: "203.0.113.5",
      headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" },
    } as unknown as Request;
    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("trustProxySetting 默认值保守", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousTrust = process.env.TRUST_PROXY;
    try {
      delete process.env.TRUST_PROXY;
      process.env.NODE_ENV = "production";
      expect(trustProxySetting()).toBe(1);
      process.env.NODE_ENV = "test";
      expect(trustProxySetting()).toBe(false);

      process.env.TRUST_PROXY = "2";
      expect(trustProxySetting()).toBe(2);
      process.env.TRUST_PROXY = "garbage";
      expect(trustProxySetting()).toBe(false);
      process.env.TRUST_PROXY = "true";
      expect(trustProxySetting()).toBe(true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousTrust === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previousTrust;
    }
  });
});

describe("deviceHash", () => {
  it("缺少 salt 时返回 undefined（不使用固定默认盐）", () => {
    const previous = process.env.SECURITY_DEVICE_SALT;
    delete process.env.SECURITY_DEVICE_SALT;
    try {
      expect(deviceHash("Mozilla/5.0")).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.SECURITY_DEVICE_SALT = previous;
    }
  });

  it("有 salt 时稳定且对大小写/空白不敏感", () => {
    const previous = process.env.SECURITY_DEVICE_SALT;
    process.env.SECURITY_DEVICE_SALT = "unit-test-salt";
    try {
      const a = deviceHash("Mozilla/5.0  (X11)");
      const b = deviceHash("mozilla/5.0 (x11)");
      expect(a).toBeDefined();
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      if (previous === undefined) delete process.env.SECURITY_DEVICE_SALT;
      else process.env.SECURITY_DEVICE_SALT = previous;
    }
  });

  it("不同 salt 产生不同 hash", () => {
    const previous = process.env.SECURITY_DEVICE_SALT;
    try {
      process.env.SECURITY_DEVICE_SALT = "salt-a";
      const a = deviceHash("agent");
      process.env.SECURITY_DEVICE_SALT = "salt-b";
      const b = deviceHash("agent");
      expect(a).not.toBe(b);
    } finally {
      if (previous === undefined) delete process.env.SECURITY_DEVICE_SALT;
      else process.env.SECURITY_DEVICE_SALT = previous;
    }
  });

  it("空 UA 不产生标识", () => {
    expect(normalizeUserAgent(undefined)).toBe("");
    expect(deviceHash("   ")).toBeUndefined();
  });
});
