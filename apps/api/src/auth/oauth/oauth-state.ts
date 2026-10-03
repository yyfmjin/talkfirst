import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 授权码流程的中间状态：`state`、PKCE 的 `code_verifier`、`nonce`。
 *
 * ## What has to survive the redirect, and why a cookie
 *
 * The flow leaves this server for the provider and comes back, so three values
 * have to be recoverable on the callback:
 *
 *  - `state` — matched against the one in the query string to prove the callback
 *    belongs to a sign-in THIS server started (CSRF);
 *  - `code_verifier` — sent to the token endpoint so the authorization code is
 *    only useful to whoever started the flow (PKCE, RFC 7636);
 *  - `nonce` — compared against the `id_token`'s claim (replay).
 *
 * They live in a short-lived HttpOnly cookie rather than a table: no migration,
 * no cleanup job, and — because the cookie never reaches JavaScript — nothing for
 * an XSS to steal. The cookie is `SameSite=Lax` so it survives the provider's
 * top-level redirect back to us, and it is cleared on every callback, success or
 * failure, so a state value is genuinely single-use.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not carry the user's identity or the tokens. It carries only what is
 * needed to validate the redirect; the session is created afterwards, from the
 * provider's verified answer.
 */

export const OAUTH_STATE_COOKIE_PREFIX = "tf_oauth_state";

/** How long a started sign-in stays valid. Short: it is one redirect round trip. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export type OAuthFlowState = {
  provider: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  /**
   * Where to send the browser once the session exists.
   *
   * Stored server-side (here) rather than accepted from the callback query: a
   * `?next=` parameter on the callback would be an open redirect, because anyone
   * could craft the link that the provider bounces the user back with.
   */
  redirectTo: string;
};

/** Cookie name is per-provider so two sign-ins in two tabs cannot collide. */
export function oauthStateCookieName(provider: string): string {
  return `${OAUTH_STATE_COOKIE_PREFIX}_${provider.toLowerCase()}`;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** A fresh `state`: 256 bits of randomness, URL-safe. */
export function newStateValue(): string {
  return base64Url(randomBytes(32));
}

/** A fresh `nonce` for the `id_token` replay check. */
export function newNonceValue(): string {
  return base64Url(randomBytes(32));
}

/** A fresh PKCE `code_verifier` (RFC 7636 allows 43-128 chars; this is 43). */
export function newCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

/**
 * `code_challenge` = BASE64URL(SHA256(verifier)), method `S256`.
 *
 * S256 is the only method offered: `plain` sends the verifier itself in the
 * authorization request, which defeats the point of PKCE.
 */
export function codeChallengeFor(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/**
 * Constant-time `state` comparison.
 *
 * `state` is not a long-lived secret, but it IS the CSRF guard, and a comparison
 * that returns early on the first differing byte would leak how much of a guessed
 * value was correct. Cheap to do properly here, since both sides are the same
 * fixed length.
 */
export function stateMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build the provider's authorization URL.
 *
 * `access_type=online` deliberately: this app only needs the identity for the
 * sign-in itself. Asking for offline access would request a refresh token we do
 * not store and do not need, which is exactly the kind of over-collection the
 * privacy policy has to answer for.
 */
export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  params: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Only the identity is needed, for this sign-in only. Asking for offline access
  // would request a refresh token we do not store and do not need.
  url.searchParams.set("access_type", "online");
  // Re-asking for consent on every sign-in would be noise; the account picker is
  // still shown, so a shared browser can still choose a different account.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * Where the browser may be sent after a successful callback.
 *
 * An open redirect is the one thing a `redirectTo` must never become: the
 * callback URL is handed to the provider, so anyone able to influence this value
 * could bounce a freshly-authenticated user to an attacker's page — with the
 * session cookie already set, which is how a phishing flow gets to look like it
 * happened on our own site.
 *
 * Two shapes are accepted, and nothing else:
 *
 *  - a **root-relative path** (`/discover`) — cannot leave the origin by
 *    construction;
 *  - an absolute URL whose origin **exactly equals** the configured web app
 *    origin. No prefix/suffix matching: `https://talkfirst.ccwu.cc.evil.com`
 *    would satisfy `startsWith`.
 *
 * Anything rejected falls back to the default, so a bad value degrades to "go to
 * the app" rather than to "go somewhere else".
 */
export function safeRedirectTarget(candidate: string | undefined | null, appUrl: string): string {
  const fallback = "/discover";
  if (!candidate) return fallback;

  const value = candidate.trim();
  if (!value) return fallback;

  if (value.startsWith("/")) {
    /**
     * `//evil.com` is protocol-relative — a browser reads it as an absolute URL
     * to another host, while a naive `startsWith("/")` check reads it as a path.
     * A leading `/\` is the same trick for some parsers.
     */
    if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
    return value;
  }

  try {
    const parsed = new URL(value);
    const allowed = new URL(appUrl);
    if (parsed.origin !== allowed.origin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
