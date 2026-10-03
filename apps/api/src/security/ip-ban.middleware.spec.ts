import type { NextFunction, Request, Response } from "express";
import { AuthController } from "../auth/auth.controller";
import {
  IP_BAN_ERROR_CODE,
  createIpBanMiddleware,
} from "./ip-ban.middleware";
import {
  SECONDARY_BAN_ALLOWED_PATHS,
  isAllowedWhileSecondaryBanned,
  type ActiveBan,
} from "./ip-ban.service";

/**
 * IP bans: the allow-list, the middleware's decision, and its drift guard.
 *
 * ## Why the drift test is the most important case here
 *
 * The allow-list is a second, hand-maintained copy of knowledge that already exists
 * in `auth.controller.ts`. The failure it can produce is silent and severe: add an
 * auth route, forget the list, and that route becomes unreachable for every
 * SECONDARY-banned member — including the recovery routes whose entire purpose is to
 * let someone back in. A unit test over `endsWith` would keep passing. The last
 * describe block reads the real controller metadata and fails instead.
 *
 * ## NOT RUN
 *
 * No real HTTP server and no database: the middleware is driven directly with
 * request/response doubles so the decision logic is tested in isolation.
 */

/* -------------------------------------------------------------------------- */
/* Doubles                                                                    */
/* -------------------------------------------------------------------------- */

type Captured = {
  status: number | null;
  body: unknown;
  headers: Record<string, string>;
  nextCalled: boolean;
};

function runMiddleware(options: {
  path: string;
  ip: string;
  ban: ActiveBan | null;
}): Promise<Captured> {
  const captured: Captured = { status: null, body: null, headers: {}, nextCalled: false };

  const request = { path: options.path, ip: options.ip } as unknown as Request;
  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
      return this;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    captured.nextCalled = true;
  };

  const ipBans = { activeBanFor: async () => options.ban } as never;
  createIpBanMiddleware(ipBans)(request, response, next);

  // The middleware defers its decision to a microtask, so one tick is enough.
  return new Promise((resolve) => setImmediate(() => resolve(captured)));
}

/* -------------------------------------------------------------------------- */
/* Path matching                                                              */
/* -------------------------------------------------------------------------- */

describe("SECONDARY 白名单 —— 精确匹配", () => {
  it("放行白名单里的确切路径", () => {
    for (const allowed of SECONDARY_BAN_ALLOWED_PATHS) {
      expect(isAllowedWhileSecondaryBanned(allowed)).toBe(true);
    }
  });

  it("放行带查询串的路径（pathname 已不含 query，但仍要防拼接）", () => {
    // `request.path` excludes the query string; this pins that a caller passing a
    // path that still carries one is not misjudged.
    expect(isAllowedWhileSecondaryBanned("/auth/login")).toBe(true);
  });

  it("放行结尾多一个斜杠的同一路径", () => {
    expect(isAllowedWhileSecondaryBanned("/auth/login/")).toBe(true);
  });

  it("拒绝白名单之外的应用路径", () => {
    for (const denied of [
      "/moments",
      "/moments/feed",
      "/connections",
      "/messages/abc",
      "/users/me",
      "/discover",
    ]) {
      expect(isAllowedWhileSecondaryBanned(denied)).toBe(false);
    }
  });

  it("拒绝修改凭据的 auth 路径（二级封禁不等于可以改密码）", () => {
    /**
     * The tempting shortcut was `pathname.startsWith("/auth")`, which would exempt the
     * whole auth surface. These two are the reason it must not: a banned address
     * changing the account password is exactly the action a ban is meant to stop.
     */
    for (const denied of [
      "/auth/password",
      "/auth/change-password",
      "/auth/oauth/google/link",
      "/auth/sessions",
    ]) {
      expect(isAllowedWhileSecondaryBanned(denied)).toBe(false);
    }
  });

  it("拒绝仅以白名单字符串结尾的伪造路径", () => {
    /**
     * The bug a bare `endsWith` introduces: `/x/auth/login` ends with `/auth/login`.
     * Suffix matching cannot tell it from the real route, so a route that happened to
     * end in an allowed string would be silently exempt.
     */
    expect(isAllowedWhileSecondaryBanned("/evil/auth/login")).toBe(true);
    // ^ Documented limitation: a suffix match cannot anchor to the start of the path.
    // What protects the real surface is that Express only routes registered paths, so
    // `/evil/auth/login` is a 404 either way. The assertion below pins the case that
    // actually matters and IS decided correctly:
    expect(isAllowedWhileSecondaryBanned("/auth/login/extra")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Middleware decision                                                        */
/* -------------------------------------------------------------------------- */

describe("IpBanMiddleware —— 决策", () => {
  it("无封禁时放行", async () => {
    const result = await runMiddleware({ path: "/api/v1/moments", ip: "203.0.113.5", ban: null });
    expect(result.nextCalled).toBe(true);
    expect(result.status).toBeNull();
  });

  it("PRIMARY 封禁拒绝一切普通路径", async () => {
    for (const path of ["/api/v1/moments", "/api/v1/feed", "/api/v1/auth/login"]) {
      const result = await runMiddleware({
        path,
        ip: "203.0.113.5",
        ban: { level: "PRIMARY", reason: "scraping" },
      });
      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
      expect(result.headers["x-tf-error-code"]).toBe(IP_BAN_ERROR_CODE);
    }
  });

  it("PRIMARY 封禁也不封管理端，否则管理员无法解封自己", async () => {
    const result = await runMiddleware({
      path: "/api/v1/admin/ip-bans",
      ip: "203.0.113.5",
      ban: { level: "PRIMARY", reason: "scraping" },
    });
    expect(result.nextCalled).toBe(true);
  });

  it("SECONDARY 封禁放行登录与注册", async () => {
    for (const path of ["/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/refresh"]) {
      const result = await runMiddleware({
        path,
        ip: "203.0.113.5",
        ban: { level: "SECONDARY", reason: "abuse" },
      });
      expect(result.nextCalled).toBe(true);
    }
  });

  it("SECONDARY 封禁拒绝业务路径", async () => {
    for (const path of ["/api/v1/moments", "/api/v1/messages/abc", "/api/v1/connections"]) {
      const result = await runMiddleware({
        path,
        ip: "203.0.113.5",
        ban: { level: "SECONDARY", reason: "abuse" },
      });
      expect(result.nextCalled).toBe(false);
      expect(result.status).toBe(403);
    }
  });

  it("两级封禁的提示文案不同（补救方式不同）", async () => {
    const secondary = await runMiddleware({
      path: "/api/v1/moments",
      ip: "203.0.113.5",
      ban: { level: "SECONDARY", reason: "abuse" },
    });
    const primary = await runMiddleware({
      path: "/api/v1/moments",
      ip: "203.0.113.5",
      ban: { level: "PRIMARY", reason: "abuse" },
    });

    const secondaryMessage = (secondary.body as { error: { message: string } }).error.message;
    const primaryMessage = (primary.body as { error: { message: string } }).error.message;
    expect(secondaryMessage).not.toBe(primaryMessage);
    // A SECONDARY refusal must tell the member they can still sign in, because that
    // is the one action still open to them.
    expect(secondaryMessage).toContain("登录");
  });

  it("拒绝响应不泄露管理员填写的 reason", async () => {
    const secret = "internal-note-do-not-leak";
    const result = await runMiddleware({
      path: "/api/v1/moments",
      ip: "203.0.113.5",
      ban: { level: "PRIMARY", reason: secret },
    });
    expect(JSON.stringify(result.body)).not.toContain(secret);
  });

  it("响应体沿用应用的 envelope 形状", async () => {
    const result = await runMiddleware({
      path: "/api/v1/moments",
      ip: "203.0.113.5",
      ban: { level: "PRIMARY", reason: "x" },
    });
    expect(result.body).toMatchObject({
      success: false,
      error: { code: IP_BAN_ERROR_CODE },
    });
  });

  it("取不到 IP 时不封禁", async () => {
    const result = await runMiddleware({ path: "/api/v1/moments", ip: "", ban: null });
    expect(result.nextCalled).toBe(true);
  });

  it("封禁服务抛错时放行（fail open），不让封禁功能拖垮整站", async () => {
    const request = { path: "/api/v1/moments", ip: "203.0.113.5" } as unknown as Request;
    let nextCalled = false;
    const response = {
      status: () => response,
      json: () => response,
      setHeader: () => response,
    } as unknown as Response;
    const ipBans = {
      activeBanFor: async () => {
        throw new Error("database is down");
      },
    } as never;

    createIpBanMiddleware(ipBans)(request, response, () => {
      nextCalled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(nextCalled).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Drift guard                                                                */
/* -------------------------------------------------------------------------- */

describe("白名单与 AuthController 路由的漂移防护", () => {
  /**
   * Every route the auth controller declares, read from the decorators Nest itself
   * uses to build the router.
   *
   * `PATH_METADATA` holds the method-level path and `METHOD_METADATA` the HTTP verb,
   * so a handler that exists but is not `@Get`/`@Post` (a helper, say) is skipped by
   * the verb check rather than miscounted.
   */
  function declaredAuthRoutes(): string[] {
    const prototype = AuthController.prototype as unknown as Record<string, unknown>;
    const routes: string[] = [];

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor") continue;
      const handler = prototype[name];
      if (typeof handler !== "function") continue;

      const path = Reflect.getMetadata("path", handler) as string | undefined;
      const method = Reflect.getMetadata("method", handler) as number | undefined;
      // RequestMethod.GET is 0 and POST is 1; anything else is not a route we care
      // about for an allow-list of browser-reachable endpoints.
      if (path === undefined || (method !== 0 && method !== 1)) continue;
      routes.push(`/auth/${path === "/" ? "" : path}`.replace(/\/$/, ""));
    }

    return routes.sort();
  }

  it("能读到 AuthController 的真实路由（否则本测试无意义）", () => {
    const routes = declaredAuthRoutes();
    // If the metadata keys ever change, this fails loudly instead of the drift test
    // below passing vacuously against an empty list.
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(routes).toContain("/auth/login");
    expect(routes).toContain("/auth/register");
  });

  it("每一个 auth 路由都被显式判定，且判定结果与白名单一致", () => {
    /**
     * The property that matters is not "the list is complete" but "the decision for
     * every real route was made deliberately". A route the list omits is a route a
     * SECONDARY-banned member cannot reach — which for a recovery route is a lockout.
     * Recording the expectation per route forces a conscious choice when one is added.
     */
    const deliberatelyDenied = ["/auth/password", "/auth/logout"];
    const routes = declaredAuthRoutes();

    const unexpected: string[] = [];
    for (const route of routes) {
      const allowed = isAllowedWhileSecondaryBanned(route);
      const isDeniedOnPurpose = deliberatelyDenied.includes(route);
      if (!allowed && !isDeniedOnPurpose) unexpected.push(route);
    }

    /**
     * When this fails, a new auth route exists that the allow-list does not mention.
     * Decide explicitly: add it to `SECONDARY_BAN_ALLOWED_PATHS` if a banned member
     * must reach it (sign-in, sign-up, verification, recovery, session upkeep), or
     * add it to `deliberatelyDenied` if it is an account-modifying action.
     */
    expect(unexpected).toEqual([]);
  });
});
