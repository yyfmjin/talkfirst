import { OAuthProvider } from "@prisma/client";

/**
 * Google 快捷登录 —— provider 与 token 校验层的公共类型。
 *
 * ## The one thing this layer must never do
 *
 * Every fact below comes from a token OUR SERVER fetched over TLS directly from
 * the provider's token endpoint. The browser is never a source of truth: a client
 * that "reports" an e-mail address or a subject proves nothing, which is why
 * nothing here takes an e-mail as an argument. Callers hand over a raw `id_token`
 * and this layer decides what it means.
 */

/** The provider's verified answer, reduced to the claims this app uses. */
export type ProviderIdentity = {
  provider: OAuthProvider;
  /** The provider's immutable subject claim. The ONLY safe lookup key. */
  providerUserId: string;
  /** Lowercased e-mail, or null when the provider did not supply one. */
  email: string | null;
  /**
   * True only when the provider ITSELF asserted the address is verified.
   *
   * Never inferred from "the provider gave us an address": Google returns
   * `email_verified: false` on some accounts, and treating a supplied-but-
   * unverified address as proof is how an attacker's address gets linked to
   * somebody else's account.
   */
  emailVerified: boolean;
  /** Display name, when the provider supplies one. Presentation only. */
  name: string | null;
};

/**
 * Why a sign-in was refused, as a stable machine-readable code.
 *
 * The API surface maps these onto HTTP responses, and the web client maps them
 * onto Chinese copy — so the codes are a contract and the messages are not.
 */
export type OAuthFailureCode =
  | "OAUTH_PROVIDER_DISABLED"
  | "OAUTH_TOKEN_INVALID"
  | "OAUTH_EMAIL_UNVERIFIED"
  | "OAUTH_EMAIL_REQUIRED"
  | "OAUTH_ACCOUNT_EXISTS"
  | "OAUTH_STATE_INVALID"
  | "OAUTH_EXCHANGE_FAILED"
  | "OAUTH_NONCE_MISMATCH";

/**
 * A refusal that carries a code rather than a message, so the controller can
 * pick the HTTP status and the client can translate it.
 *
 * Deliberately NOT an `HttpException`: this layer knows nothing about HTTP, and
 * a service that throws `ForbiddenException` cannot be reused behind a redirect
 * (where the correct answer is a 302 back to the app with an error, not a JSON
 * body). `OAuthService`/the controller own the translation.
 */
export class OAuthError extends Error {
  readonly code: OAuthFailureCode;

  constructor(code: OAuthFailureCode, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

/**
 * The seam that makes this testable without Google.
 *
 * The real implementation fetches Google's JWKS and verifies an RS256
 * signature. The E2E suite substitutes an implementation that verifies against a
 * locally generated key, so the entire flow — redirect, state cookie, callback,
 * account creation, session — is exercised by real code paths while only the
 * third party is simulated.
 */
export interface IdTokenVerifier {
  /** Provider this verifier speaks for. */
  readonly provider: OAuthProvider;
  /**
   * @param idToken raw JWT from the provider's token endpoint
   * @param expectedNonce the nonce this server put in the auth request; when
   *   provided, a token whose `nonce` does not match must be refused (replay
   *   protection). `null` skips the check for flows that legitimately have none.
   */
  verify(idToken: string, expectedNonce: string | null): Promise<ProviderIdentity>;
}
