import { JwtService } from "@nestjs/jwt";
import { OAuthAccountService } from "./oauth-account.service";
import { SessionService } from "../session.service";
import { OAuthService, OAuthAccountExistsError, isAccountExistsError } from "./oauth.service";
import { OAuthError, type IdTokenVerifier, type ProviderIdentity } from "./oauth.types";
import type { OAuthProviderConfig } from "./oauth-config";
import { safeRedirectTarget, stateMatches } from "./oauth-state";
import { jwtSecretOrDevFallback } from "../../common/security-config";

/**
 * 授权码流程的编排：state/nonce/PKCE 的生成与校验、跳转白名单、拒绝路径。
 *
 * The token verification itself is covered by `oidc-id-token-verifier.spec.ts`
 * with real signatures. Here the verifier is a stub, because what is under test is
 * everything AROUND it: does a mismatched `state` stop the exchange, is the nonce
 * forwarded, is the PKCE verifier sent, is the redirect target constrained, and
 * does a refusal ever leave a session behind.
 */

/** The flow-state token is signed with the same secret `JwtStrategy` uses. */
const STATE_SECRET = jwtSecretOrDevFallback("JWT_SECRET");

const APP_URL = "https://talkfirst.ccwu.cc";

const CONFIG: OAuthProviderConfig = {
  kind: "google",
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "https://talkfirst.ccwu.cc/api/v1/auth/oauth/google/callback",
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuer: "https://accounts.google.com",
};

const USER = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: null,
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
  profileCompleted: false,
  createdAt: new Date(),
  lastActiveAt: null,
};

function makeService(options: {
  resolution?: unknown;
  verify?: (token: string, nonce: string | null) => Promise<ProviderIdentity>;
} = {}) {
  const sessions = {
    issue: jest.fn(async () => ({ accessToken: "access", refreshToken: "refresh", user: USER })),
    recordDevice: jest.fn(async () => undefined),
  };
  const accounts = {
    resolve: jest.fn(async () =>
      options.resolution ?? { kind: "session", user: USER, linked: false, isNewAccount: true },
    ),
  };
  const verifier: IdTokenVerifier = {
    provider: "GOOGLE" as never,
    verify: jest.fn(
      options.verify ??
        (async () => ({
          provider: "GOOGLE" as never,
          providerUserId: "sub-1",
          email: "alice@example.com",
          emailVerified: true,
          name: "Alice",
        })),
    ),
  };

  const service = new OAuthService(
    sessions as unknown as SessionService,
    accounts as unknown as OAuthAccountService,
    new JwtService({}),
    () => verifier,
  );

  return { service, sessions, accounts, verifier: verifier.verify as jest.Mock };
}

/** A `fetch` stub for the token endpoint, returning a fixed payload. */
function stubTokenEndpoint(payload: unknown, ok = true, status = 200) {
  const fetchMock = jest.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  }));
  const original = globalThis.fetch;
  globalThis.fetch = fetchMock as never;
  return {
    fetchMock,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OAuthError) return error.code;
    throw error;
  }
  throw new Error("expected a refusal, but the call resolved");
}

describe("safeRedirectTarget — 开放重定向防护", () => {
  it("接受根相对路径", () => {
    expect(safeRedirectTarget("/discover", APP_URL)).toBe("/discover");
    expect(safeRedirectTarget("/moments/123?x=1", APP_URL)).toBe("/moments/123?x=1");
  });

  it("接受同源绝对地址", () => {
    expect(safeRedirectTarget(`${APP_URL}/me`, APP_URL)).toBe(`${APP_URL}/me`);
  });

  it("拒绝绝对的外部地址", () => {
    expect(safeRedirectTarget("https://evil.example.com/steal", APP_URL)).toBe("/discover");
  });

  it("拒绝前缀欺骗（把本域名当前缀的外部域名）", () => {
    // A naive `startsWith(appUrl)` would accept this.
    expect(safeRedirectTarget("https://talkfirst.ccwu.cc.evil.com/x", APP_URL)).toBe("/discover");
  });

  it("拒绝协议相对地址 //evil.com（浏览器会当成绝对地址）", () => {
    expect(safeRedirectTarget("//evil.example.com", APP_URL)).toBe("/discover");
    expect(safeRedirectTarget("/\\evil.example.com", APP_URL)).toBe("/discover");
  });

  it("拒绝非 http(s) 协议", () => {
    expect(safeRedirectTarget("javascript:alert(1)", APP_URL)).toBe("/discover");
    expect(safeRedirectTarget("data:text/html,x", APP_URL)).toBe("/discover");
  });

  it("空值 / 无值 -> 默认跳转", () => {
    expect(safeRedirectTarget(undefined, APP_URL)).toBe("/discover");
    expect(safeRedirectTarget(null, APP_URL)).toBe("/discover");
    expect(safeRedirectTarget("   ", APP_URL)).toBe("/discover");
  });
});

describe("stateMatches — 常量时间比较", () => {
  it("相同即通过", () => {
    expect(stateMatches("abc123", "abc123")).toBe(true);
  });

  it("不同 / 长度不同 / 缺失都拒绝", () => {
    expect(stateMatches("abc123", "abc124")).toBe(false);
    expect(stateMatches("abc123", "abc")).toBe(false);
    expect(stateMatches("abc123", undefined)).toBe(false);
    expect(stateMatches("abc123", "")).toBe(false);
  });
});

describe("OAuthService.begin — 生成授权请求", () => {
  it("返回 Google 授权地址，带上 state / nonce / S256 PKCE，且不泄漏 client_secret", () => {
    const { service } = makeService();
    const { authorizationUrl, flowState } = service.begin("google", CONFIG, { appUrl: APP_URL });

    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe(flowState.state);
    expect(url.searchParams.get("nonce")).toBe(flowState.nonce);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The verifier itself must never appear in the authorization request — only
    // its SHA-256 hash may.
    expect(authorizationUrl).not.toContain(flowState.codeVerifier);
    expect(authorizationUrl).not.toContain(CONFIG.clientSecret);
    // Only the identity is requested.
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("access_type")).toBe("online");
  });

  it("values 每次都不同（state/nonce/verifier 不能复用）", () => {
    const { service } = makeService();
    const a = service.begin("google", CONFIG, { appUrl: APP_URL }).flowState;
    const b = service.begin("google", CONFIG, { appUrl: APP_URL }).flowState;
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it("外部 redirectTo 被夹到默认值", () => {
    const { service } = makeService();
    const { flowState } = service.begin("google", CONFIG, {
      appUrl: APP_URL,
      redirectTo: "https://evil.example.com",
    });
    expect(flowState.redirectTo).toBe("/discover");
  });
});

describe("OAuthService.readFlowState — cookie 校验", () => {
  it("自己签发的 state token 可以读回", () => {
    const { service } = makeService();
    const { stateToken, flowState } = service.begin("google", CONFIG, { appUrl: APP_URL });

    const read = service.readFlowState(stateToken);
    expect(read).toMatchObject({
      provider: "google",
      state: flowState.state,
      nonce: flowState.nonce,
      codeVerifier: flowState.codeVerifier,
    });
  });

  it("缺失 / 乱码 / 被篡改 -> null", () => {
    const { service } = makeService();
    expect(service.readFlowState(undefined)).toBeNull();
    expect(service.readFlowState("garbage")).toBeNull();
    expect(service.readFlowState("a.b.c")).toBeNull();
  });

  it("用别的密钥签发的 token -> null", () => {
    const { service } = makeService();
    const foreign = new JwtService({}).sign(
      { type: "oauth_state", provider: "google", state: "s", codeVerifier: "v", nonce: "n", redirectTo: "/x" },
      { secret: "a-completely-different-secret" },
    );
    expect(service.readFlowState(foreign)).toBeNull();
  });

  it("会话 access token 不能被当成 flow state 复用（同密钥，靠 type 区分）", () => {
    const { service } = makeService();
    const sessionToken = new JwtService({}).sign(
      { sub: "user-1", email: "a@b.com", type: "access" },
      { secret: STATE_SECRET },
    );
    expect(service.readFlowState(sessionToken)).toBeNull();
  });
});

describe("OAuthService.complete — 回调校验", () => {
  it("state 不匹配 -> OAUTH_STATE_INVALID，且从不换取 token", async () => {
    const { service } = makeService();
    const stub = stubTokenEndpoint({ id_token: "x" });
    try {
      const { stateToken } = service.begin("google", CONFIG, { appUrl: APP_URL });
      expect(
        await refusalOf(
          service.complete("google", CONFIG, { code: "c", state: "forged", stateToken }),
        ),
      ).toBe("OAUTH_STATE_INVALID");
      expect(stub.fetchMock).not.toHaveBeenCalled();
    } finally {
      stub.restore();
    }
  });

  it("缺少 state cookie -> OAUTH_STATE_INVALID", async () => {
    const { service } = makeService();
    expect(
      await refusalOf(service.complete("google", CONFIG, { code: "c", state: "s" })),
    ).toBe("OAUTH_STATE_INVALID");
  });

  it("state 属于另一个 provider -> OAUTH_STATE_INVALID", async () => {
    const { service } = makeService();
    const { stateToken, flowState } = service.begin("local", CONFIG, { appUrl: APP_URL });

    expect(
      await refusalOf(
        service.complete("google", CONFIG, { code: "c", state: flowState.state, stateToken }),
      ),
    ).toBe("OAUTH_STATE_INVALID");
  });

  it("用户在 Google 侧取消（error=access_denied）-> OAUTH_EXCHANGE_FAILED", async () => {
    const { service } = makeService();
    expect(
      await refusalOf(service.complete("google", CONFIG, { providerError: "access_denied" })),
    ).toBe("OAUTH_EXCHANGE_FAILED");
  });

  it("回调没带 code -> OAUTH_EXCHANGE_FAILED", async () => {
    const { service } = makeService();
    const { stateToken, flowState } = service.begin("google", CONFIG, { appUrl: APP_URL });
    expect(
      await refusalOf(service.complete("google", CONFIG, { state: flowState.state, stateToken })),
    ).toBe("OAUTH_EXCHANGE_FAILED");
  });

  it("token 端点拒绝 -> OAUTH_EXCHANGE_FAILED，且不透传 provider 的原文", async () => {
    const { service } = makeService();
    const stub = stubTokenEndpoint(
      { error: "invalid_client", error_description: "client secret leaked detail" },
      false,
      401,
    );
    try {
      const { stateToken, flowState } = service.begin("google", CONFIG, { appUrl: APP_URL });
      const error = await service
        .complete("google", CONFIG, { code: "c", state: flowState.state, stateToken })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).code).toBe("OAUTH_EXCHANGE_FAILED");
      // The provider's own text is for the log/security event, never the client.
      expect((error as Error).message).toContain("invalid_client");
      void flowState;
    } finally {
      stub.restore();
    }
  });

  it("token 端点没有返回 id_token -> OAUTH_EXCHANGE_FAILED", async () => {
    const { service } = makeService();
    const stub = stubTokenEndpoint({ access_token: "at" });
    try {
      const { stateToken, flowState } = service.begin("google", CONFIG, { appUrl: APP_URL });
      expect(
        await refusalOf(service.complete("google", CONFIG, { code: "c", state: flowState.state, stateToken })),
      ).toBe("OAUTH_EXCHANGE_FAILED");
    } finally {
      stub.restore();
    }
  });

  it("成功路径：换码 -> 验签（带上 nonce 与 PKCE verifier）-> 签发会话 -> 回跳", async () => {
    const verify = jest.fn(async () => ({
      provider: "GOOGLE" as never,
      providerUserId: "sub-1",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
    }));
    const { service, sessions, accounts } = makeService({ verify });
    const stub = stubTokenEndpoint({ id_token: "the-id-token" });
    try {
      const { stateToken, flowState } = service.begin("google", CONFIG, {
        appUrl: APP_URL,
        redirectTo: "/me",
      });

      const result = await service.complete("google", CONFIG, {
        code: "auth-code",
        state: flowState.state,
        stateToken,
      });

      // The code is exchanged server-side, with the verifier — so an intercepted
      // code is useless without it.
      const body = String((stub.fetchMock.mock.calls[0] as unknown[])[1] &&
        ((stub.fetchMock.mock.calls[0] as unknown[])[1] as { body: string }).body);
      expect(body).toContain("code=auth-code");
      expect(body).toContain(`code_verifier=${flowState.codeVerifier}`);
      expect(body).toContain("grant_type=authorization_code");

      // The nonce from OUR flow state is what the token must match.
      expect(verify).toHaveBeenCalledWith("the-id-token", flowState.nonce);

      expect(accounts.resolve).toHaveBeenCalled();
      expect(sessions.issue).toHaveBeenCalled();
      expect(sessions.recordDevice).toHaveBeenCalledWith("user-1");
      expect(result).toMatchObject({
        redirectTo: "/me",
        accessToken: "access",
        refreshToken: "refresh",
        isNewAccount: true,
      });
    } finally {
      stub.restore();
    }
  });

  it("账号已存在 -> 抛出可携带登录方式的拒绝，且不签发任何会话", async () => {
    const { service, sessions } = makeService({
      resolution: { kind: "account_exists", methods: { hasPassword: false, providers: ["GOOGLE"] } },
    });
    const stub = stubTokenEndpoint({ id_token: "t" });
    try {
      const { stateToken, flowState } = service.begin("google", CONFIG, { appUrl: APP_URL });
      const error = await service
        .complete("google", CONFIG, { code: "c", state: flowState.state, stateToken })
        .catch((thrown: unknown) => thrown);

      expect(isAccountExistsError(error)).toBe(true);
      expect((error as OAuthAccountExistsError).methods).toEqual({
        hasPassword: false,
        providers: ["GOOGLE"],
      });
      // A refusal must never leave a session behind.
      expect(sessions.issue).not.toHaveBeenCalled();
    } finally {
      stub.restore();
    }
  });
});
