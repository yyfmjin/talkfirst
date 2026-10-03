import { generateKeyPairSync, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { JwksCache } from "./jwks-cache";
import { OidcIdTokenVerifier } from "./oidc-id-token-verifier";
import { OAuthError } from "./oauth.types";
import type { GoogleConfig } from "./oauth-config";

/**
 * `id_token` 验签的拒绝路径。
 *
 * Every case here is a real RS256 token signed by a real key, and the verifier is
 * pointed at a JWKS document served by a stub `fetch`. Nothing about the
 * verification is mocked: `jsonwebtoken` checks the signature, and the JWKS →
 * KeyObject conversion is Node's own. So a test that passes proves the token was
 * genuinely accepted or genuinely refused, not that a mock said so.
 *
 * The negative cases are the point. A verifier that accepts everything would pass
 * a "happy path" suite, so each row below removes one validation and asserts the
 * refusal that its absence would cause.
 */

const ISSUER = "https://accounts.google.com";
const AUDIENCE = "client-id.apps.googleusercontent.com";

function makeFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const kid = "test-key-1";

  /** A JWKS document as the provider would serve it. */
  const jwksBody = JSON.stringify({ keys: [{ ...jwk, kid, use: "sig", alg: "RS256" }] });

  let fetches = 0;
  const bodies: string[] = [jwksBody];
  const fetchImpl = jest.fn(async () => {
    // Read the body for THIS call, then advance — so `setJwks` before a call
    // decides what that call sees.
    const body = bodies[Math.min(fetches, bodies.length - 1)];
    fetches += 1;
    return { ok: true, status: 200, text: async () => body };
  });

  const now = () => 1_700_000_000_000;
  const config: GoogleConfig = {
    kind: "google",
    clientId: AUDIENCE,
    clientSecret: "secret",
    redirectUri: "https://api.example.com/api/v1/auth/oauth/google/callback",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: ISSUER,
  };

  const verifier = new OidcIdTokenVerifier(config, new JwksCache(fetchImpl as never, now));

  function sign(claims: Record<string, unknown>, options: jwt.SignOptions = {}, key: KeyObject = privateKey) {
    return jwt.sign({ iss: ISSUER, aud: AUDIENCE, ...claims }, key, {
      algorithm: "RS256",
      keyid: kid,
      expiresIn: "5m",
      ...options,
    });
  }

  return {
    sign,
    verifier,
    config,
    privateKey,
    publicKey,
    get fetches() {
      return fetches;
    },
    setJwks: (body: string) => {
      bodies.push(body);
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
  throw new Error("expected the verifier to refuse this token, but it accepted it");
}

describe("OidcIdTokenVerifier — 接受的路径", () => {
  it("签名、iss、aud、exp 都合法时返回 provider 身份", async () => {
    const fx = makeFixture();
    const token = fx.sign({
      sub: "112233445566778899",
      email: "Alice@Example.com ",
      email_verified: true,
      name: "Alice",
    });

    const identity = await fx.verifier.verify(token, null);

    expect(identity).toEqual({
      provider: "GOOGLE",
      providerUserId: "112233445566778899",
      // Normalised here so every downstream comparison cannot drift on case.
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice",
    });
  });

  it("nonce 匹配时放行", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1", nonce: "nonce-abc" });
    await expect(fx.verifier.verify(token, "nonce-abc")).resolves.toMatchObject({ providerUserId: "s1" });
  });

  it("缺少 email 时返回 null 而不是抛错（由账号解析决定怎么处理）", async () => {
    const fx = makeFixture();
    const identity = await fx.verifier.verify(fx.sign({ sub: "s1" }), null);
    expect(identity.email).toBeNull();
    expect(identity.emailVerified).toBe(false);
  });
});

describe("OidcIdTokenVerifier — 签名与算法", () => {
  it("用别的密钥签名 -> 拒绝", async () => {
    const fx = makeFixture();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = fx.sign({ sub: "attacker", email: "victim@example.com" }, {}, other.privateKey);

    expect(await refusalOf(fx.verifier.verify(forged, null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("alg=none 的无签名 token -> 拒绝（不是「签名缺失就跳过校验」）", async () => {
    const fx = makeFixture();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: "test-key-1" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: "attacker", email_verified: true }),
    ).toString("base64url");
    const unsigned = `${header}.${payload}.`;

    expect(await refusalOf(fx.verifier.verify(unsigned, null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("把公钥当 HMAC 密钥（alg=HS256）-> 拒绝", async () => {
    const fx = makeFixture();
    const pem = fx.publicKey.export({ type: "spki", format: "pem" }) as string;
    const confused = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: "attacker" }, pem, {
      algorithm: "HS256",
      keyid: "test-key-1",
    });

    expect(await refusalOf(fx.verifier.verify(confused, null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("结构损坏的 token -> 拒绝", async () => {
    const fx = makeFixture();
    expect(await refusalOf(fx.verifier.verify("not-a-jwt", null))).toBe("OAUTH_TOKEN_INVALID");
    expect(await refusalOf(fx.verifier.verify("", null))).toBe("OAUTH_TOKEN_INVALID");
  });
});

describe("OidcIdTokenVerifier — 注册声明", () => {
  it("iss 不是 Google -> 拒绝", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1", iss: "https://evil.example.com" });
    expect(await refusalOf(fx.verifier.verify(token, null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("aud 是别的应用 -> 拒绝（防止拿别的应用的 token 登录本应用）", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1", aud: "someone-elses-client-id" });
    expect(await refusalOf(fx.verifier.verify(token, null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("已过期 -> 拒绝", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1" }, { expiresIn: "-10m" });
    expect(await refusalOf(fx.verifier.verify(token, null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("缺少 sub -> 拒绝（没有稳定标识就不能建号）", async () => {
    const fx = makeFixture();
    const token = jwt.sign({ iss: ISSUER, aud: AUDIENCE, email: "a@b.com" }, fx.privateKey, {
      algorithm: "RS256",
      keyid: "test-key-1",
      expiresIn: "5m",
    });
    expect(await refusalOf(fx.verifier.verify(token, null))).toBe("OAUTH_TOKEN_INVALID");
  });
});

describe("OidcIdTokenVerifier — nonce（重放防护）", () => {
  it("提供了预期 nonce 但 token 里没有 -> 拒绝", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1" });
    expect(await refusalOf(fx.verifier.verify(token, "expected-nonce"))).toBe("OAUTH_NONCE_MISMATCH");
  });

  it("nonce 不一致 -> 拒绝（重放旧的 token）", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1", nonce: "old-nonce" });
    expect(await refusalOf(fx.verifier.verify(token, "new-nonce"))).toBe("OAUTH_NONCE_MISMATCH");
  });

  it("没要求 nonce 但 token 带了 -> 拒绝（token 是为别的请求签发的）", async () => {
    const fx = makeFixture();
    const token = fx.sign({ sub: "s1", nonce: "unexpected" });
    expect(await refusalOf(fx.verifier.verify(token, null))).toBe("OAUTH_NONCE_MISMATCH");
  });
});

describe("OidcIdTokenVerifier — email_verified 只认严格的 true", () => {
  it.each([
    ["缺失", undefined],
    ["false", false],
    ["字符串 \"true\"", "true"],
    ["数字 1", 1],
  ])("email_verified 为 %s 时判定为未验证", async (_label, value) => {
    const fx = makeFixture();
    const claims: Record<string, unknown> = { sub: "s1", email: "a@b.com" };
    if (value !== undefined) claims.email_verified = value;

    const identity = await fx.verifier.verify(fx.sign(claims), null);
    expect(identity.emailVerified).toBe(false);
  });

  it("真的是 true 时才判定为已验证", async () => {
    const fx = makeFixture();
    const identity = await fx.verifier.verify(fx.sign({ sub: "s1", email: "a@b.com", email_verified: true }), null);
    expect(identity.emailVerified).toBe(true);
  });
});

describe("JwksCache — 密钥轮换与抓取纪律", () => {
  it("未知 kid 会立即重新抓取一次（轮换的正常表现）", async () => {
    const fx = makeFixture();
    // First sign-in populates the cache.
    await fx.verifier.verify(fx.sign({ sub: "s1" }), null);
    const afterFirst = fx.fetches;

    // The provider rotates: a NEW key set is published under a new kid.
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rotatedJwk = rotated.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    fx.setJwks(JSON.stringify({ keys: [{ ...rotatedJwk, kid: "test-key-2", use: "sig", alg: "RS256" }] }));

    const rotatedToken = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: "s1" }, rotated.privateKey, {
      algorithm: "RS256",
      keyid: "test-key-2",
      expiresIn: "5m",
    });

    await expect(fx.verifier.verify(rotatedToken, null)).resolves.toMatchObject({ providerUserId: "s1" });
    expect(fx.fetches).toBe(afterFirst + 1);
  });

  it("已知 kid 命中缓存，不重复抓取（否则每次登录都会打到 Google）", async () => {
    const fx = makeFixture();
    await fx.verifier.verify(fx.sign({ sub: "s1" }), null);
    const afterFirst = fx.fetches;

    await fx.verifier.verify(fx.sign({ sub: "s2" }), null);
    await fx.verifier.verify(fx.sign({ sub: "s3" }), null);

    expect(fx.fetches).toBe(afterFirst);
  });

  it("同一个 kid 连续失败时不会每次都重新抓取（防止被当作流量放大器）", async () => {
    const fx = makeFixture();
    await fx.verifier.verify(fx.sign({ sub: "s1" }), null);
    const afterFirst = fx.fetches;

    // A forged token with an unknown kid, twice in a row.
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: "x" }, other.privateKey, {
      algorithm: "RS256",
      keyid: "does-not-exist",
      expiresIn: "5m",
    });

    await refusalOf(fx.verifier.verify(forged, null));
    const afterFirstFailure = fx.fetches;
    await refusalOf(fx.verifier.verify(forged, null));

    // The second failure must be served from the cache, not by hammering Google.
    expect(afterFirstFailure).toBe(afterFirst + 1);
    expect(fx.fetches).toBe(afterFirstFailure);
  });

  it("JWKS 抓取失败 -> OAUTH_TOKEN_INVALID（不是 500）", async () => {
    const failing = jest.fn(async () => {
      throw new Error("network down");
    });
    const config: GoogleConfig = {
      kind: "google",
      clientId: AUDIENCE,
      clientSecret: "secret",
      redirectUri: "https://api.example.com/cb",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      issuer: ISSUER,
    };
    const verifier = new OidcIdTokenVerifier(config, new JwksCache(failing as never));

    expect(await refusalOf(verifier.verify("a.b.c", null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("JWKS 里混入一个损坏的 key 时，同一个文档里的好 key 仍然可用", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const body = JSON.stringify({
      keys: [
        { kty: "RSA", kid: "broken", n: "!!!", e: "AQAB" },
        { ...jwk, kid: "good", use: "sig", alg: "RS256" },
      ],
    });
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, text: async () => body }));
    const config: GoogleConfig = {
      kind: "google",
      clientId: AUDIENCE,
      clientSecret: "secret",
      redirectUri: "https://api.example.com/cb",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      issuer: ISSUER,
    };
    const verifier = new OidcIdTokenVerifier(config, new JwksCache(fetchImpl as never));
    const token = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: "s1" }, privateKey, {
      algorithm: "RS256",
      keyid: "good",
      expiresIn: "5m",
    });

    await expect(verifier.verify(token, null)).resolves.toMatchObject({ providerUserId: "s1" });
  });

  it("JWKS 文档里没有 keys 数组 -> 拒绝", async () => {
    const body = JSON.stringify({ nope: true });
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, text: async () => body }));
    const config: GoogleConfig = {
      kind: "google",
      clientId: AUDIENCE,
      clientSecret: "secret",
      redirectUri: "https://api.example.com/cb",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      issuer: ISSUER,
    };
    const verifier = new OidcIdTokenVerifier(config, new JwksCache(fetchImpl as never));
    expect(await refusalOf(verifier.verify("a.b.c", null))).toBe("OAUTH_TOKEN_INVALID");
  });

  it("JWKS 返回非 200 -> 拒绝", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, text: async () => "{}" }));
    const config: GoogleConfig = {
      kind: "google",
      clientId: AUDIENCE,
      clientSecret: "secret",
      redirectUri: "https://api.example.com/cb",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      issuer: ISSUER,
    };
    const verifier = new OidcIdTokenVerifier(config, new JwksCache(fetchImpl as never));
    expect(await refusalOf(verifier.verify("a.b.c", null))).toBe("OAUTH_TOKEN_INVALID");
  });
});
