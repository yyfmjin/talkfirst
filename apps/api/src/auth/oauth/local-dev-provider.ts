import { createHash, generateKeyPairSync, randomUUID, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * 开发用的假 OIDC provider。
 *
 * ## What this is for
 *
 * Google sign-in cannot be tested without Google: the real flow needs a client id
 * from a console and a browser session at accounts.google.com. That is a bad
 * reason to leave the feature untested, so this stands in for the third party and
 * nothing else:
 *
 *  - it serves the two endpoints the *real* flow talks to (an authorize page and a
 *    token endpoint) plus a JWKS document;
 *  - it signs real RS256 `id_token`s with a key generated at boot, so
 *    `OidcIdTokenVerifier` — the production verifier — does the verification, and
 *    every rejection path behaves exactly as it will against Google;
 *  - it enforces PKCE: the `code_challenge` from the authorization request must
 *    match the `code_verifier` presented at the token endpoint, so the flow's own
 *    PKCE wiring is genuinely exercised rather than assumed.
 *
 * ## What it deliberately is NOT
 *
 * It is not a mock of our own code. `oauth.service`, `oauth-account.service`,
 * `oauth-state`, the controller, the session and the database are all the real
 * ones; only "the provider" is local. That is why the E2E suite can prove things
 * like "the callback writes an `OAuthIdentity` row" with no network.
 *
 * ## Safety
 *
 * Reachable only when `OAUTH_DEV_PROVIDER=true`, which `assertOAuthConfiguration`
 * refuses outside development — and `readOAuthProviderConfig` refuses a second
 * time, because a single boot-time guard is one refactor away from being bypassed
 * by a script or a spec.
 */

/** An account the local provider will sign in. */
export type LocalDevUser = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

/**
 * The accounts offered on the authorize page.
 *
 * Three shapes, because each one drives a different branch of the account
 * resolution policy: a brand-new address (creates an account), an address that
 * already belongs to a password account (refuses to auto-link), and an address
 * the provider reports as UNVERIFIED (refuses outright). Testing only the happy
 * one would leave the interesting rules unexercised.
 */
export const LOCAL_DEV_USERS: readonly LocalDevUser[] = [
  { sub: "local-new-user", email: "local.new@example.test", emailVerified: true, name: "本地新用户" },
  { sub: "local-verified", email: "local.verified@example.test", emailVerified: true, name: "本地已验证" },
  { sub: "local-unverified", email: "local.unverified@example.test", emailVerified: false, name: "本地未验证" },
];

type PendingAuthorization = {
  user: LocalDevUser;
  codeChallenge: string;
  nonce: string | null;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
};

/** Authorization codes live for one exchange and are then gone. */
const CODE_TTL_MS = 5 * 60 * 1000;

/** What the token endpoint answers with, mirroring Google's response shape. */
export type LocalTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  id_token: string;
};

export class LocalDevProvider {
  private readonly privateKey: KeyObject;
  private readonly publicJwk: Record<string, unknown>;
  private readonly keyId: string;
  /** Issued codes, keyed by the code itself (single use). */
  private readonly pending = new Map<string, PendingAuthorization>();
  /** The `sub` the next authorize page submit should sign in as. */
  private selectedSub: string = LOCAL_DEV_USERS[0]!.sub;
  /**
   * The accounts offered on the page. Seeded from `LOCAL_DEV_USERS`, but writable
   * so an integration test can stand up the exact collision it needs — for example
   * "this provider address already belongs to a password account here" — without
   * adding a permanent account to the shipped list.
   */
  private accounts: LocalDevUser[] = [...LOCAL_DEV_USERS];

  constructor(private readonly now: () => number = () => Date.now()) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.keyId = `local-dev-${randomUUID().slice(0, 8)}`;
    this.publicJwk = {
      ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
      kid: this.keyId,
      use: "sig",
      alg: "RS256",
    };
  }

  /** The JWKS document `OidcIdTokenVerifier` fetches. */
  jwks(): { keys: Array<Record<string, unknown>> } {
    return { keys: [this.publicJwk] };
  }

  users(): readonly LocalDevUser[] {
    return this.accounts;
  }

  /** Test seam: replace the offered accounts. */
  setUsers(users: readonly LocalDevUser[]): void {
    this.accounts = [...users];
  }

  /**
   * The HTML the authorize endpoint renders.
   *
   * A real form with a submit button, because the E2E suite drives this through a
   * browser: clicking it is what makes the test cover our callback rather than
   * only its inputs.
   */
  authorizePage(params: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    clientId: string;
    nonce: string | null;
  }): string {
    const options = this.accounts.map(
      (user) =>
        `<label style="display:block;margin:6px 0">` +
        `<input type="radio" name="as" value="${escapeHtml(user.sub)}"` +
        `${user.sub === this.selectedSub ? " checked" : ""}> ` +
        `${escapeHtml(user.name)} — ${escapeHtml(user.email)}` +
        `${user.emailVerified ? "" : " （未验证）"}` +
        `</label>`,
    ).join("");

    /**
     * Every parameter is carried through as a hidden field and re-validated on
     * submit. They are NOT re-read from the query string at that point, which
     * would let the POST invent its own `redirect_uri`.
     */
    const hidden = [
      ["state", params.state],
      ["code_challenge", params.codeChallenge],
      ["redirect_uri", params.redirectUri],
      ["client_id", params.clientId],
      ["nonce", params.nonce ?? ""],
    ]
      .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value as string)}">`)
      .join("");

    return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>本地开发登录</title></head>
<body style="font:14px/1.6 system-ui;max-width:520px;margin:40px auto;padding:0 16px">
  <h1 style="font-size:18px">本地开发用假 OIDC 登录</h1>
  <p style="color:#a00"><strong>这不是 Google。</strong>仅在 <code>OAUTH_DEV_PROVIDER=true</code>
  且非生产环境可用；它签发的 id_token 由本机密钥签名，用于在没有真实凭据时端到端验证整条链路。</p>
  <form method="POST" action="authorize">
    ${hidden}
    <fieldset style="border:1px solid #ddd;border-radius:8px;padding:12px">
      <legend>选择一个账号</legend>
      ${options}
    </fieldset>
    <button type="submit" data-testid="local-authorize-submit"
      style="margin-top:12px;padding:10px 18px;border-radius:8px;border:0;background:#4f46e5;color:#fff;font-size:14px">
      同意并登录
    </button>
  </form>
</body></html>`;
  }

  /**
   * Handle the authorize form submit and produce a redirect back to the callback.
   *
   * Validates the essentials before issuing a code: the redirect URI must be the
   * one this deployment registered, and the PKCE challenge must be present. A
   * provider that skipped either would let the tests pass against a flow that
   * could never work with Google.
   */
  authorize(params: {
    sub: string;
    state: string;
    codeChallenge: string;
    redirectUri: string;
    clientId: string;
    nonce: string | null;
    expectedRedirectUri: string;
    expectedClientId: string;
  }): string {
    const user = this.accounts.find((candidate) => candidate.sub === params.sub);
    if (!user) throw new Error(`unknown local dev user: ${params.sub}`);
    if (params.redirectUri !== params.expectedRedirectUri) {
      throw new Error(`redirect_uri mismatch: ${params.redirectUri} !== ${params.expectedRedirectUri}`);
    }
    if (params.clientId !== params.expectedClientId) {
      throw new Error(`client_id mismatch: ${params.clientId}`);
    }
    if (!params.codeChallenge) {
      throw new Error("code_challenge is required (PKCE)");
    }

    const code = randomUUID();
    this.pending.set(code, {
      user,
      codeChallenge: params.codeChallenge,
      nonce: params.nonce,
      redirectUri: params.redirectUri,
      clientId: params.clientId,
      expiresAt: this.now() + CODE_TTL_MS,
    });

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", params.state);
    return target.toString();
  }

  /**
   * Exchange a code for an `id_token`.
   *
   * Mirrors the real token endpoint's contract closely enough that
   * `OAuthService.exchangeCodeForIdentity` needs no knowledge of which provider it
   * is talking to: form-encoded POST, `code_verifier` checked against the stored
   * challenge, an `id_token` in the JSON response.
   */
  exchange(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    /** Passed straight into the signed token so `iss`/`aud` match the verifier. */
    issuer: string;
    audience: string;
  }): LocalTokenResponse | { error: string; error_description: string } {
    const entry = this.pending.get(params.code);
    // Single use: consumed whether or not the rest validates.
    this.pending.delete(params.code);

    if (!entry) {
      return { error: "invalid_grant", error_description: "authorization code is unknown or already used" };
    }
    if (entry.expiresAt < this.now()) {
      return { error: "invalid_grant", error_description: "authorization code has expired" };
    }
    if (entry.redirectUri !== params.redirectUri) {
      return { error: "invalid_grant", error_description: "redirect_uri does not match the authorization request" };
    }
    if (entry.clientId !== params.clientId) {
      return { error: "invalid_client", error_description: "client_id does not match" };
    }
    if (!params.clientSecret) {
      return { error: "invalid_client", error_description: "client_secret is required" };
    }
    /**
     * PKCE check, exactly as a real provider does it: SHA-256 of the presented
     * verifier, base64url, compared with the challenge from the authorization
     * request. A mismatch means the caller is not the one that started the flow.
     */
    const computed = createHash("sha256").update(params.codeVerifier ?? "").digest("base64url");
    if (computed !== entry.codeChallenge) {
      return { error: "invalid_grant", error_description: "code_verifier does not match code_challenge" };
    }

    return {
      access_token: `local-access-${randomUUID()}`,
      token_type: "Bearer",
      expires_in: 3600,
      id_token: this.signIdToken(entry.user, entry.nonce, {
        issuer: params.issuer,
        audience: params.audience,
      }),
    };
  }

  /**
   * Sign an `id_token` in Google's shape.
   *
   * `iss` and `aud` come from the CALLER'S config rather than being hard-coded
   * here. A hard-coded pair would let this provider's tokens satisfy a verifier
   * that production would reject — a test green against a token shape Google never
   * sends is worse than no test. Reading both from the same config the verifier
   * uses means the two cannot disagree.
   */
  signIdToken(
    user: LocalDevUser,
    nonce: string | null,
    options: { issuer: string; audience: string; overrides?: Record<string, unknown> },
  ): string {
    const claims: Record<string, unknown> = {
      iss: options.issuer,
      aud: options.audience,
      sub: user.sub,
      email: user.email,
      email_verified: user.emailVerified,
      name: user.name,
      ...options.overrides,
    };
    if (nonce) claims.nonce = nonce;
    return jwt.sign(claims, this.privateKey, {
      algorithm: "RS256",
      keyid: this.keyId,
      expiresIn: "5m",
    });
  }

  /** Test seam: force which account the next authorize submit signs in as. */
  selectUser(sub: string): void {
    this.selectedSub = sub;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
