import {
  REDACTED,
  isSensitiveKey,
  redact,
  summarizeQuery,
  toSafeJson,
} from "./redact";

/**
 * Security Audit Center (P1) — the redaction contract.
 *
 * Every audit payload passes through `redact()` before it is persisted. These
 * tests pin down the two properties that matter: nothing credential-shaped ever
 * survives, and the utility itself cannot be turned into a denial-of-service by
 * a hostile payload (deep nesting, cycles, huge strings/arrays).
 */
describe("redact — sensitive keys never survive", () => {
  it("每类敏感字段都会被替换", () => {
    const result = redact({
      password: "hunter2",
      passwordConfirm: "hunter2",
      token: "abc",
      accessToken: "a.b.c",
      refreshToken: "deadbeef",
      authorization: "Bearer xyz",
      cookie: "tf=1",
      "set-cookie": "tf=1",
      code: "482913",
      verificationCode: "482913",
      resetToken: "reset",
      oauthToken: "oauth",
      secret: "s",
      clientSecret: "cs",
    }) as Record<string, unknown>;

    for (const key of Object.keys(result)) {
      expect(result[key]).toBe(REDACTED);
    }
  });

  it("大小写不敏感", () => {
    const result = redact({ Password: "p", authorization: "a" }) as Record<string, unknown>;
    expect(result.Password).toBe(REDACTED);
    expect(result.authorization).toBe(REDACTED);
  });

  it("嵌套对象里的敏感字段同样被替换", () => {
    const result = redact({
      user: { email: "a@b.com", credentials: { password: "p", nested: { refreshToken: "r" } } },
    }) as {
      user: {
        email: string;
        credentials: { password: unknown; nested: { refreshToken: unknown } };
      };
    };

    expect(result.user.email).toBe("a@b.com");
    expect(result.user.credentials.password).toBe(REDACTED);
    expect(result.user.credentials.nested.refreshToken).toBe(REDACTED);
  });

  it("数组中的对象也会被处理", () => {
    const result = redact([{ password: "p" }, { ok: 1 }]) as Array<Record<string, unknown>>;
    expect(result[0].password).toBe(REDACTED);
    expect(result[1].ok).toBe(1);
  });

  it("reasonCode / statusCode / errorCode 不会被误伤", () => {
    const result = redact({
      reasonCode: "INVALID_CREDENTIALS",
      statusCode: 401,
      errorCode: "HTTP_ERROR",
    }) as Record<string, unknown>;
    expect(result.reasonCode).toBe("INVALID_CREDENTIALS");
    expect(result.statusCode).toBe(401);
    expect(result.errorCode).toBe("HTTP_ERROR");
  });

  it("isSensitiveKey 精确匹配，不做子串匹配", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("Password")).toBe(true);
    expect(isSensitiveKey("passwordHash")).toBe(false);
  });
});

describe("redact — hostile payloads are contained", () => {
  it("循环引用不会导致无限递归", () => {
    const node: Record<string, unknown> = { name: "root" };
    node.self = node;
    const result = redact(node) as Record<string, unknown>;
    expect(result.name).toBe("root");
    expect(result.self).toBe("[CIRCULAR]");
  });

  it("超长字符串被截断", () => {
    const result = redact({ blob: "x".repeat(5000) }) as { blob: string };
    expect(result.blob.length).toBeLessThan(600);
    expect(result.blob).toContain("[TRUNCATED]");
  });

  it("超长数组被截断", () => {
    const result = redact({ list: Array.from({ length: 200 }, (_, i) => i) }) as {
      list: unknown[];
    };
    expect(result.list.length).toBeLessThanOrEqual(51);
  });

  it("过深的对象在深度上限处停止", () => {
    let deep: unknown = { value: 1 };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    const serialized = JSON.stringify(redact(deep));
    expect(serialized).toContain("MAX_DEPTH");
  });

  it("非 JSON 值被安全丢弃", () => {
    const result = redact({ fn: () => undefined, ok: true }) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.fn).toBeUndefined();
  });

  it("同一对象出现在兄弟位置时不会被误判为循环", () => {
    const shared = { id: "shared" };
    const result = redact({ a: shared, b: shared }) as Record<string, unknown>;
    expect(result.a).toEqual({ id: "shared" });
    expect(result.b).toEqual({ id: "shared" });
  });
});

describe("summarizeQuery — 只保留白名单键", () => {
  it("白名单键保留，其余全部丢弃", () => {
    const digest = summarizeQuery({
      page: "2",
      pageSize: "20",
      email: "victim@example.com",
      token: "abc",
    });
    expect(digest).toBe("page=2&pageSize=20");
    expect(digest).not.toContain("victim");
    expect(digest).not.toContain("abc");
  });

  it("空查询返回 undefined", () => {
    expect(summarizeQuery({})).toBeUndefined();
    expect(summarizeQuery(undefined)).toBeUndefined();
    expect(summarizeQuery({ email: "x" })).toBeUndefined();
  });
});

describe("toSafeJson — 超限时降级而不是抛错", () => {
  it("正常值直接返回", () => {
    expect(toSafeJson({ a: 1 })).toEqual({ a: 1 });
  });

  it("超限时返回截断标记", () => {
    const big = { blob: "x".repeat(10000) };
    const result = toSafeJson(big, 100) as { truncated?: boolean };
    expect(result.truncated).toBe(true);
  });

  it("undefined 保持 undefined（让 Prisma 用默认值）", () => {
    expect(toSafeJson(undefined)).toBeUndefined();
  });
});
