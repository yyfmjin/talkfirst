import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../prisma/prisma.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { DeviceIdentityService } from "../../security/device-identity.service";
import { SessionService } from "../session.service";
import { OAuthAccountService } from "./oauth-account.service";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";
import { LocalDevProvider, type LocalDevUser } from "./local-dev-provider";
import { createIdTokenVerifier } from "./oidc-id-token-verifier";

/**
 * 授权码 + PKCE 全链路的真实 HTTP 验收。
 *
 * The unit specs cover each piece; this one proves the pieces are wired together,
 * because what can only fail in composition is invisible to a unit test:
 *
 *  - the flow-state cookie is really set, sent back, and read;
 *  - `redirect_uri` in the authorization request is character-for-character the
 *    registered one;
 *  - the PKCE verifier presented at the token endpoint matches the challenge the
 *    authorization request carried — `LocalDevProvider` enforces this, so a wrong
 *    wiring fails here instead of passing against a lenient stub;
 *  - the callback writes a real `OAuthIdentity` row and sets session cookies;
 *  - a second sign-in reuses that row rather than creating a second account;
 *  - a refusal leaves no session and no row behind.
 *
 * It runs against the real database (the PostgreSQL in `.env`), which is what
 * makes those row assertions mean something. Only the third party is local:
 * `LocalDevProvider` signs genuine RS256 tokens that the PRODUCTION
 * `OidcIdTokenVerifier` fetches keys for and verifies.
 */

const APP_URL = "http://localhost:3000";

/** Filled in `beforeAll` from the port the app actually bound. */
let apiOrigin = "";

const NEW_USER: LocalDevUser = {
  sub: "local-sub-new",
  email: "local.new@example.test",
  emailVerified: true,
  name: "本地新用户",
};
const UNVERIFIED_USER: LocalDevUser = {
  sub: "local-sub-unverified",
  email: "local.unverified@example.test",
  emailVerified: false,
  name: "本地未验证",
};
const TAKEN_USER: LocalDevUser = {
  sub: "local-sub-taken",
  email: "local.taken@example.test",
  emailVerified: true,
  name: "本地已占用",
};

let app: INestApplication;
let prisma: PrismaService;
let base = "";
let localDev: LocalDevProvider;
const savedEnv: Record<string, string | undefined> = {};

/** A cookie jar, so the round trip keeps whatever the server set. */
class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** Redirects are followed by hand: the assertions ARE about the redirects. */
async function request(url: string, init: { method?: string; jar?: Jar; body?: string } = {}) {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(init.jar ? { cookie: init.jar.header() } : {}),
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.body,
  });
  init.jar?.absorb(response);
  return response;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/**
 * One complete sign-in, driven exactly like a browser: start, load the provider's
 * page, submit the form, follow the provider's redirect into our callback.
 */
async function signIn(sub: string, options: { redirectTo?: string } = {}) {
  const jar = new Jar();

  const start = await request(
    `${base}/auth/oauth/local/start${
      options.redirectTo ? `?redirectTo=${encodeURIComponent(options.redirectTo)}` : ""
    }`,
    { jar },
  );
  const authorizationUrl = new URL(start.headers.get("location") as string);

  const page = await request(authorizationUrl.toString(), { jar });
  const html = await page.text();

  const form = new URLSearchParams();
  form.set("as", sub);
  for (const name of ["state", "code_challenge", "redirect_uri", "client_id", "nonce"]) {
    const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
    if (!match) throw new Error(`the authorize page did not carry ${name}`);
    form.set(name, decodeEntities(match[1]!));
  }

  const submitted = await request(`${apiOrigin}/api/v1/auth/oauth/local/authorize`, {
    method: "POST",
    jar,
    body: form.toString(),
  });
  const callbackUrl = submitted.headers.get("location");
  if (!callbackUrl) {
    throw new Error(`the provider did not redirect back to the callback: ${await submitted.text()}`);
  }

  const callback = await request(callbackUrl, { jar });
  return { callback, jar, authorizationUrl };
}

/** The app's error/redirect target, with its query parsed. */
function redirectTarget(response: Response): URL {
  return new URL(response.headers.get("location") as string, APP_URL);
}

beforeAll(async () => {
  /**
   * Set before the app is built: provider config is read from the process
   * environment per request, exactly as production reads it.
   */
  for (const [key, value] of Object.entries({
    OAUTH_DEV_PROVIDER: "true",
    /**
     * A placeholder that `beforeAll` overwrites once `listen(0)` has picked a
     * port. It is present here so `savedEnv` records the key and the original
     * value is restored afterwards — otherwise this spec would leave
     * `API_PUBLIC_URL` pointing at a dead port for every later suite.
     */
    API_PUBLIC_URL: "http://127.0.0.1:0",
    APP_URL,
    ALLOW_INSECURE_DEFAULTS: "true",
    NODE_ENV: "test",
  })) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const moduleRef = await Test.createTestingModule({
    imports: [PrismaModule, JwtModule.register({})],
    controllers: [OAuthController],
    providers: [
      LocalDevProvider,
      OAuthAccountService,
      SessionService,
      { provide: DeviceIdentityService, useValue: { record: jest.fn(async () => undefined) } },
      // The PRODUCTION verifier: it fetches the local provider's JWKS over real
      // HTTP and verifies a real RS256 signature.
      { provide: "OAUTH_ID_TOKEN_VERIFIER_FACTORY", useValue: createIdTokenVerifier },
      {
        provide: OAuthService,
        useFactory: (
          sessions: SessionService,
          accounts: OAuthAccountService,
          jwt: JwtService,
          verifierFactory: typeof createIdTokenVerifier,
        ) => new OAuthService(sessions, accounts, jwt, verifierFactory),
        inject: [SessionService, OAuthAccountService, JwtService, "OAUTH_ID_TOKEN_VERIFIER_FACTORY"],
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  /**
   * The middleware `main.ts` installs, and each one is load-bearing here:
   *
   *  - `cookieParser()` — the callback reads the flow-state cookie through
   *    `request.cookies`. Without it, EVERY callback looks like it arrived with no
   *    state at all and answers `OAUTH_STATE_INVALID`. That is the red herring this
   *    harness produced before the parser was added: the cookie was set, sent and
   *    parseable, but nothing had parsed it.
   *  - `json` / `urlencoded` — the local token endpoint is a form POST, so without
   *    a body parser the exchange sees an empty body.
   */
  const [{ default: cookieParser }, { json, urlencoded }] = await Promise.all([
    import("cookie-parser"),
    import("express"),
  ]);
  app.use(cookieParser());
  app.use(json());
  app.use(urlencoded({ extended: true }));
  await app.listen(0);

  const url = await app.getUrl();
  const port = url.slice(url.lastIndexOf(":") + 1);
  base = `http://127.0.0.1:${port}/api/v1`;
  /**
   * Bind the config to the port the app actually opened.
   *
   * `API_PUBLIC_URL` is what builds both the `redirect_uri` and the local
   * provider's own endpoints, so a mismatch here would send the browser to a port
   * nothing is listening on — which is what `fetch failed` looked like the first
   * time. Setting it AFTER `listen(0)` removes the guess entirely; the provider
   * config is read per request, so nothing was cached against the old value.
   */
  process.env.API_PUBLIC_URL = `http://127.0.0.1:${port}`;
  apiOrigin = `http://127.0.0.1:${port}`;

  prisma = app.get(PrismaService);
  localDev = app.get(LocalDevProvider);
  localDev.setUsers([NEW_USER, UNVERIFIED_USER, TAKEN_USER]);

  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Remove everything this spec created, so it is re-runnable and leaves no trace. */
async function cleanup() {
  const emails = [NEW_USER.email, UNVERIFIED_USER.email, TAKEN_USER.email];
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

describe("Google 登录（本地假 provider，真实 HTTP + 真实数据库）", () => {
  it("首次登录：建号 + 写入 OAuthIdentity + 种下会话 Cookie + 消费 state", async () => {
    const { callback, jar } = await signIn(NEW_USER.sub);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/discover");

    const cookies = callback.headers.getSetCookie().join("\n");
    expect(cookies).toContain("tf_access=");
    expect(cookies).toContain("tf_refresh=");
    // The flow state is single-use: the callback clears it.
    expect(jar.get("tf_oauth_state_local")).toBeUndefined();

    const created = await prisma.user.findUnique({ where: { email: NEW_USER.email } });
    expect(created).not.toBeNull();
    // No password exists for a Google-only account — NOT a random hash.
    expect(created?.passwordHash).toBeNull();
    // Google already proved the address, so enforcement cannot lock them out.
    expect(created?.emailVerified).toBe(true);

    const identity = await prisma.oAuthIdentity.findUnique({
      where: { provider_providerUserId: { provider: "GOOGLE", providerUserId: NEW_USER.sub } },
    });
    expect(identity?.userId).toBe(created?.id);
    expect(identity?.email).toBe(NEW_USER.email);
    // A real refresh-token row: this sign-in used the same session machinery as a
    // password login, which is what keeps SEC-003-B's reuse detection working.
    expect(await prisma.refreshToken.count({ where: { userId: created!.id } })).toBeGreaterThan(0);
  });

  it("第二次登录：复用同一账号与同一身份行，不重复建号", async () => {
    const before = await prisma.user.findUnique({ where: { email: NEW_USER.email } });

    const { callback } = await signIn(NEW_USER.sub);
    expect(callback.status).toBe(302);

    const users = await prisma.user.findMany({ where: { email: NEW_USER.email } });
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(before!.id);

    const identities = await prisma.oAuthIdentity.findMany({ where: { userId: before!.id } });
    expect(identities).toHaveLength(1);
    expect(identities[0]!.lastLoginAt).not.toBeNull();
  });

  it("redirectTo 被带回来（同源路径）", async () => {
    const { callback } = await signIn(NEW_USER.sub, { redirectTo: "/me" });
    expect(callback.headers.get("location")).toBe("/me");
  });

  it("外部 redirectTo 被夹到默认值（开放重定向防护）", async () => {
    const { callback } = await signIn(NEW_USER.sub, { redirectTo: "https://evil.example.com/steal" });
    expect(callback.headers.get("location")).toBe("/discover");
  });

  it("provider 报告邮箱未验证 -> 拒绝，且不建号、不种会话", async () => {
    const { callback } = await signIn(UNVERIFIED_USER.sub);

    expect(redirectTarget(callback).searchParams.get("oauth_error")).toBe("OAUTH_EMAIL_UNVERIFIED");
    // A refusal must never leave a session behind.
    expect(callback.headers.getSetCookie().join("\n")).not.toContain("tf_access=");
    expect(await prisma.user.findUnique({ where: { email: UNVERIFIED_USER.email } })).toBeNull();
  });

  it("邮箱已属于密码账号 -> 不自动关联，也不建号，并回传可执行的登录方式", async () => {
    const existing = await prisma.user.create({
      data: {
        email: TAKEN_USER.email,
        // Required since P0-02. The value is arbitrary here — this account exists
        // to prove the OAuth path refuses to adopt it.
        username: "oauthspec0001",
        passwordHash: "$2b$12$abcdefghijklmnopqrstuv",
        emailVerified: true,
      },
      select: { id: true },
    });

    const { callback } = await signIn(TAKEN_USER.sub);
    const target = redirectTarget(callback);

    expect(target.searchParams.get("oauth_error")).toBe("OAUTH_ACCOUNT_EXISTS");
    // The dead end this design avoids: an account with a password must say so.
    expect(target.searchParams.get("oauth_has_password")).toBe("true");
    // Nothing was linked to the existing account, and no second account appeared.
    expect(await prisma.oAuthIdentity.findMany({ where: { userId: existing.id } })).toHaveLength(0);
    expect(await prisma.user.count({ where: { email: TAKEN_USER.email } })).toBe(1);
    expect(callback.headers.getSetCookie().join("\n")).not.toContain("tf_access=");
  });

  it("state 不匹配的回调 -> OAUTH_STATE_INVALID，且不种会话", async () => {
    const jar = new Jar();
    const start = await request(`${base}/auth/oauth/local/start`, { jar });
    await request(new URL(start.headers.get("location") as string).toString(), { jar });

    const callback = await request(`${base}/auth/oauth/local/callback?code=whatever&state=forged`, { jar });

    expect(redirectTarget(callback).searchParams.get("oauth_error")).toBe("OAUTH_STATE_INVALID");
    expect(callback.headers.getSetCookie().join("\n")).not.toContain("tf_access=");
  });

  it("完全没有 state cookie 的回调 -> OAUTH_STATE_INVALID", async () => {
    const callback = await request(`${base}/auth/oauth/local/callback?code=x&state=y`);
    expect(redirectTarget(callback).searchParams.get("oauth_error")).toBe("OAUTH_STATE_INVALID");
  });

  it("用户在 provider 侧取消 -> OAUTH_EXCHANGE_FAILED", async () => {
    const jar = new Jar();
    await request(`${base}/auth/oauth/local/start`, { jar });
    const callback = await request(`${base}/auth/oauth/local/callback?error=access_denied`, { jar });

    expect(redirectTarget(callback).searchParams.get("oauth_error")).toBe("OAUTH_EXCHANGE_FAILED");
  });

  it("未配置的 provider -> OAUTH_PROVIDER_DISABLED", async () => {
    const callback = await request(`${base}/auth/oauth/github/callback?code=x&state=y`);
    expect(redirectTarget(callback).searchParams.get("oauth_error")).toBe("OAUTH_PROVIDER_DISABLED");
  });

  it("providers 列表包含 local（因为已开启）", async () => {
    const response = await request(`${base}/auth/oauth/providers`);
    const body = (await response.json()) as { data: { providers: string[] } };
    expect(body.data.providers).toContain("local");
  });

  it("JWKS 端点返回本机公钥", async () => {
    const jwks = await request(`${base}/auth/oauth/local/jwks.json`);
    expect(jwks.status).toBe(200);
    const body = (await jwks.json()) as { keys: Array<{ kid?: string; kty?: string }> };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]!.kty).toBe("RSA");
    expect(body.keys[0]!.kid).toBeTruthy();
  });

  it("授权页渲染了全部候选账号，且让选择生效（未验证项被标记）", async () => {
    const jar = new Jar();
    const start = await request(`${base}/auth/oauth/local/start`, { jar });
    const page = await request(new URL(start.headers.get("location") as string).toString(), { jar });
    const html = await page.text();

    for (const user of localDev.users()) {
      expect(html).toContain(user.email);
    }
    expect(html).toContain("（未验证）");
    // The page names itself honestly: it is not Google.
    expect(html).toContain("这不是 Google");
  });
});
