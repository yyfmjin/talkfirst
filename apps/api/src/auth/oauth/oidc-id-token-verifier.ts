import jwt from "jsonwebtoken";
import { type KeyObject } from "node:crypto";
import { JwksCache, type JwksFetcher } from "./jwks-cache";
import { OAuthError, type IdTokenVerifier, type ProviderIdentity } from "./oauth.types";
import type { OAuthProviderConfig } from "./oauth-config";
import { OAuthProvider } from "@prisma/client";

/**
 * OIDC `id_token` 的验签与声明校验。
 *
 * ## Why every check below exists
 *
 * A provider's `id_token` is a JWT signed with a key we do not control. Accepting
 * one is accepting a statement about who somebody is, so each validation is the
 * thing that stops a specific attack:
 *
 * | check | what it stops |
 * |---|---|
 * | signature against the provider's JWKS | a hand-written token claiming any identity |
 * | `alg` pinned to RS256 | the `alg: none` / HMAC confusion family, where an attacker signs with the *public* key as an HMAC secret |
 * | `iss` | a token minted for a different issuer being replayed here |
 * | `aud` | a token minted for a DIFFERENT application being replayed here — the classic confused-deputy mistake, and the reason this cannot be skipped for a public client id either |
 * | `exp` / `iat` with a small tolerance | replay of an old token; the tolerance is for clock skew, not for convenience |
 * | `nonce` | replay of a token captured from a previous sign-in by the same user |
 * | `email_verified` | treating an unverified address as proof of owning it, which is how an attacker's address gets linked to someone else's account |
 *
 * ## What is deliberately NOT trusted
 *
 * The token's `email` is a claim, not a lookup key: `ProviderIdentity` returns it
 * as data and the account-resolution step is what decides what it is allowed to
 * mean (see `OAuthIdentity`'s model comment).
 */

/** Clock skew allowance, in seconds. For skew — not for leniency. */
const CLOCK_TOLERANCE_SECONDS = 60;

/** Only RS256. See the `alg` row in the table above. */
const ALLOWED_ALGORITHMS: jwt.Algorithm[] = ["RS256"];

type IdTokenClaims = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  nonce?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  iat?: unknown;
};

export class OidcIdTokenVerifier implements IdTokenVerifier {
  readonly provider: OAuthProvider;

  constructor(
    private readonly config: OAuthProviderConfig,
    private readonly jwks: JwksCache = new JwksCache(),
  ) {
    /**
     * Every config that reaches this class verifies Google-format tokens. The
     * `local` development provider is a stand-in for Google (same OIDC shape,
     * locally signed keys), so it maps to the same provider value on purpose —
     * a sign-in through it is stored as a Google identity because that is the
     * provider it is emulating. `assertOAuthConfiguration` is what stops that
     * config existing outside development.
     */
    this.provider = OAuthProvider.GOOGLE;
  }

  async verify(idToken: string, expectedNonce: string | null): Promise<ProviderIdentity> {
    if (!idToken || typeof idToken !== "string") {
      throw new OAuthError("OAUTH_TOKEN_INVALID", "No id_token was supplied");
    }

    const decoded = this.decode(idToken);
    const key = await this.resolveKey(decoded.header.kid);
    const claims = this.checkSignatureAndRegisteredClaims(idToken, key);
    this.checkNonce(claims, expectedNonce);

    const providerUserId = typeof claims.sub === "string" ? claims.sub.trim() : "";
    if (!providerUserId) {
      throw new OAuthError("OAUTH_TOKEN_INVALID", "id_token has no subject claim");
    }

    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;

    return {
      provider: this.provider,
      providerUserId,
      email: email && email.length > 0 ? email : null,
      /**
       * Strict `=== true`. Google sends a real boolean; anything else (missing,
       * `"true"`, `1`) is not the provider asserting verification, and guessing in
       * the permissive direction is the account-takeover path.
       */
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
    };
  }

  /** Header + payload without verification, so a `kid` can be chosen. */
  private decode(idToken: string): { header: { kid?: string; alg?: string } } {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded !== "object") {
      throw new OAuthError("OAUTH_TOKEN_INVALID", "id_token is not a well-formed JWT");
    }
    const header = (decoded as { header?: { kid?: string; alg?: string } }).header ?? {};
    /**
     * Rejected here as well as in `jwt.verify` below. The duplicate is the point:
     * this branch never touches a key, so it cannot be affected by how a future
     * key-resolution change handles an unexpected algorithm.
     */
    if (!header.alg || !ALLOWED_ALGORITHMS.includes(header.alg as jwt.Algorithm)) {
      throw new OAuthError("OAUTH_TOKEN_INVALID", `id_token uses an unsupported algorithm: ${header.alg ?? "none"}`);
    }
    return { header };
  }

  private async resolveKey(kid: string | undefined): Promise<KeyObject> {
    let key: KeyObject | null;
    try {
      key = await this.jwks.getKey(this.config.jwksUri, kid);
    } catch {
      /**
       * The key set could not be fetched. Reported as an invalid token rather
       * than as a 500: from the client's point of view the sign-in did not
       * happen, and a 500 would claim this API is broken when the provider's
       * endpoint is the thing that did not answer.
       */
      throw new OAuthError("OAUTH_TOKEN_INVALID", "Could not load the provider's signing keys");
    }
    if (!key) {
      /**
       * No matching key after a refetch. Either the token is forged or the
       * provider rotated to something we cannot fetch. Both are "cannot verify".
       */
      throw new OAuthError("OAUTH_TOKEN_INVALID", "id_token was signed with an unknown key");
    }
    return key;
  }

  private checkSignatureAndRegisteredClaims(idToken: string, key: KeyObject): IdTokenClaims {
    try {
      /**
       * `algorithms` is passed explicitly even though the header was already
       * screened: `jwt.verify` is the call that actually enforces it, and leaving
       * it out makes the security of this function depend on the caller above.
       */
      return jwt.verify(idToken, key, {
        algorithms: ALLOWED_ALGORITHMS,
        audience: this.config.clientId,
        issuer: this.config.issuer,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }) as IdTokenClaims;
    } catch (error) {
      // The reason is kept out of the response (it can distinguish "expired" from
      // "wrong audience"), but it is genuinely useful in a log — so it goes into
      // the message, which the controller puts in the security event only.
      const reason = error instanceof Error ? error.message : "signature check failed";
      throw new OAuthError("OAUTH_TOKEN_INVALID", `id_token verification failed: ${reason}`);
    }
  }

  /**
   * Nonce check.
   *
   * `expectedNonce === null` means the caller has no nonce to compare — the
   * callback always has one (it is what ties the returned token to the
   * authorization request this server started), so `null` is only reachable from
   * a caller that opted out. A token that CARRIES a nonce when none was expected
   * is also refused: it means the token was minted for a different request.
   */
  private checkNonce(claims: IdTokenClaims, expectedNonce: string | null): void {
    const actual = typeof claims.nonce === "string" ? claims.nonce : null;
    if (expectedNonce === null) {
      if (actual !== null) {
        throw new OAuthError("OAUTH_NONCE_MISMATCH", "id_token carries a nonce but none was requested");
      }
      return;
    }
    /**
     * Constant-time comparison is not required here: a nonce is a per-request
     * random value, not a long-lived secret, and an attacker who can observe the
     * comparison already holds the token. `===` would leak only the prefix of a
     * value that is already single-use.
     */
    if (actual !== expectedNonce) {
      throw new OAuthError("OAUTH_NONCE_MISMATCH", "id_token nonce does not match this sign-in attempt");
    }
  }
}

/**
 * Build a verifier for a config, with the JWKS transport injectable.
 *
 * The injection point is what lets the E2E suite point a real `OidcIdTokenVerifier`
 * at a locally generated key set: the verification logic under test is the
 * production one, only the key source differs.
 */
export function createIdTokenVerifier(
  config: OAuthProviderConfig,
  options: { fetchImpl?: JwksFetcher; now?: () => number } = {},
): IdTokenVerifier {
  return new OidcIdTokenVerifier(config, new JwksCache(options.fetchImpl, options.now));
}
