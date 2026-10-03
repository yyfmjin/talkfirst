import {
  assertOAuthConfiguration,
  apiPublicOrigin,
  oauthCallbackPath,
  readConfiguredProviders,
  readOAuthProviderConfig,
} from "./oauth-config";
import { InsecureConfigurationError } from "../../common/security-config";

/**
 * 启动期配置校验。
 *
 * `assertOAuthConfiguration` runs in `main.ts`, and its whole value is failing the
 * boot on the configuration mistakes a developer cannot see from the code. Each
 * case below is one of those mistakes, so each one is pinned with the message
 * fragment that tells the operator what to fix.
 *
 * The environment is always passed explicitly: these functions default to
 * `process.env`, and a test that relied on that would pass or fail depending on
 * the machine it ran on.
 */

const DEVELOPMENT = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
const PRODUCTION = {
  NODE_ENV: "production",
  JWT_SECRET: "a-real-secret-value",
  JWT_REFRESH_SECRET: "another-real-secret-value",
} as NodeJS.ProcessEnv;

const GOOGLE_ENV = {
  ...PRODUCTION,
  GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "secret",
  API_PUBLIC_URL: "https://talkfirst.ccwu.cc",
} as NodeJS.ProcessEnv;

describe("readConfiguredProviders — 配了就开，没配就没有", () => {
  it("两个凭据都为空 -> 不提供任何 provider（合法状态，不是错误）", () => {
    expect(readConfiguredProviders(DEVELOPMENT)).toEqual([]);
  });

  it("两个凭据都在 -> 自动开启 google", () => {
    expect(readConfiguredProviders(GOOGLE_ENV)).toEqual(["google"]);
  });

  it("OAUTH_DEV_PROVIDER=true -> 额外开启 local", () => {
    expect(readConfiguredProviders({ ...DEVELOPMENT, OAUTH_DEV_PROVIDER: "true" })).toEqual(["local"]);
    expect(readConfiguredProviders({ ...GOOGLE_ENV, OAUTH_DEV_PROVIDER: "true" })).toEqual([
      "google",
      "local",
    ]);
  });

  it("显式列表覆盖推导结果", () => {
    expect(readConfiguredProviders({ ...GOOGLE_ENV, OAUTH_PROVIDERS: "google" })).toEqual(["google"]);
  });

  it("列表里拼错的 provider -> 直接抛错（否则表现为「按钮不见了」）", () => {
    expect(() => readConfiguredProviders({ ...GOOGLE_ENV, OAUTH_PROVIDERS: "google,gogle" })).toThrow(
      /unsupported provider/,
    );
  });
});

describe("readOAuthProviderConfig — 半配置返回 null，而不是拼出一个坏配置", () => {
  it("只有 client id -> null（不是「将就用」）", () => {
    expect(
      readOAuthProviderConfig("google", { ...PRODUCTION, GOOGLE_CLIENT_ID: "x" }),
    ).toBeNull();
  });

  it("只有 client secret -> null", () => {
    expect(
      readOAuthProviderConfig("google", { ...PRODUCTION, GOOGLE_CLIENT_SECRET: "x" }),
    ).toBeNull();
  });

  it("两个都在 -> 返回完整配置，回调地址由 API_PUBLIC_URL 推导", () => {
    const config = readOAuthProviderConfig("google", GOOGLE_ENV);
    expect(config).not.toBeNull();
    expect(config?.redirectUri).toBe("https://talkfirst.ccwu.cc/api/v1/auth/oauth/google/callback");
    // Google's own endpoints are fixed, not per-tenant, so they are not read from
    // the environment.
    expect(config?.issuer).toBe("https://accounts.google.com");
    expect(config?.jwksUri).toBe("https://www.googleapis.com/oauth2/v3/certs");
  });

  it("未知 provider -> null", () => {
    expect(readOAuthProviderConfig("github", GOOGLE_ENV)).toBeNull();
  });

  it("local 在开发环境但未开启 -> null；开启后回调地址在 local 路径下", () => {
    expect(readOAuthProviderConfig("local", DEVELOPMENT)).toBeNull();
    const config = readOAuthProviderConfig("local", { ...DEVELOPMENT, OAUTH_DEV_PROVIDER: "true" });
    expect(config?.kind).toBe("local");
    expect(config?.redirectUri).toBe("http://localhost:4000/api/v1/auth/oauth/local/callback");
    /**
     * The dev provider's own endpoints must NOT live under `/callback/…`: the
     * controller's routes are single-segment (`:provider/authorize`), so a nested
     * path matches no route at all.
     */
    expect(config?.authorizationEndpoint).toBe("http://localhost:4000/api/v1/auth/oauth/local/authorize");
  });

  it("local 在生产环境直接抛错（第二道锁，独立于启动断言）", () => {
    expect(() => readOAuthProviderConfig("local", { ...PRODUCTION, OAUTH_DEV_PROVIDER: "true" })).toThrow(
      InsecureConfigurationError,
    );
  });
});

describe("assertOAuthConfiguration — 启动期拒绝的四种情况", () => {
  it("全部未配置 -> 通过（不提供 Google 登录是合法部署）", () => {
    expect(() => assertOAuthConfiguration(PRODUCTION)).not.toThrow();
  });

  it("完整配置 + https -> 通过", () => {
    expect(() => assertOAuthConfiguration(GOOGLE_ENV)).not.toThrow();
  });

  it("列表里列了未配置的 provider -> 拒绝启动", () => {
    expect(() =>
      assertOAuthConfiguration({ ...PRODUCTION, OAUTH_PROVIDERS: "google" }),
    ).toThrow(/incomplete/);
  });

  it("生产环境用 http 的真实域名 -> 拒绝启动（Google 会拒绝）", () => {
    expect(() =>
      assertOAuthConfiguration({ ...GOOGLE_ENV, API_PUBLIC_URL: "http://talkfirst.ccwu.cc" }),
    ).toThrow(/https/);
  });

  it("生产环境用 localhost -> 拒绝启动（这是默认值，最容易踩）", () => {
    /**
     * `http://localhost:4000` is the default, and Google ACCEPTS a loopback
     * redirect — so without this rule a production deploy would boot happily and
     * then send a callback origin nobody registered, surfacing only as
     * `redirect_uri_mismatch`.
     */
    expect(() =>
      assertOAuthConfiguration({ ...GOOGLE_ENV, API_PUBLIC_URL: "http://localhost:4000" }),
    ).toThrow(/loopback/);
  });

  it("开发环境用 localhost -> 通过（本地联调必须能用）", () => {
    expect(() =>
      assertOAuthConfiguration({
        ...DEVELOPMENT,
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        API_PUBLIC_URL: "http://localhost:4000",
      }),
    ).not.toThrow();
  });

  it("OAUTH_DEV_PROVIDER=true 出现在生产 -> 拒绝启动", () => {
    expect(() =>
      assertOAuthConfiguration({ ...GOOGLE_ENV, OAUTH_DEV_PROVIDER: "true" }),
    ).toThrow(InsecureConfigurationError);
  });
});

describe("apiPublicOrigin / oauthCallbackPath", () => {
  it("默认是本地 API", () => {
    expect(apiPublicOrigin({} as NodeJS.ProcessEnv)).toBe("http://localhost:4000");
  });

  it("去掉结尾斜杠，避免拼出 // 导致与登记值不一致", () => {
    expect(apiPublicOrigin({ API_PUBLIC_URL: "https://a.example.com/" } as NodeJS.ProcessEnv)).toBe(
      "https://a.example.com",
    );
  });

  it("回调路径固定带 /api/v1 前缀", () => {
    expect(oauthCallbackPath("google")).toBe("/api/v1/auth/oauth/google/callback");
  });
});
