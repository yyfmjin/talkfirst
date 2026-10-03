import { SocialProviderError, type ExternalTokens } from "../external-post";
import type { SocialProviderConfig } from "../social-sync.config";
import { providerRequest } from "./http";

/**
 * Shared OAuth mechanics for the adapters whose token endpoint is a plain form POST.
 *
 * ## Why a base class and not a helper per adapter
 *
 * Four adapters need the same five steps — build the authorization URL, exchange a code,
 * refresh, parse `expires_in`, and turn a provider refusal into a code. Writing them four
 * times means four chances to differ on the parts that must not differ, and `expires_in`
 * handling in particular is easy to get subtly wrong (seconds versus absolute, missing
 * field) in a way that only shows up an hour after a member connects.
 *
 * ## What is NOT shared
 *
 * Everything platform-specific stays in the subclass: which endpoint, which auth style,
 * which fields the account and posts come from. The base class knows the OAuth *shape*;
 * it has no idea what a video or a tweet is.
 */
export abstract class OAuthFormAdapter {
  /**
   * How the client authenticates at the token endpoint.
   *
   * `body` — credentials in the form body (Google, X's confidential clients).
   * `basic` — HTTP Basic, which is what TikTok, Douyin and Facebook require.
   */
  protected abstract readonly clientAuth: "body" | "basic";

  /** Extra form fields the token endpoint needs beyond the shared ones. */
  protected extraTokenFields(_config: SocialProviderConfig): Record<string, string> {
    return {};
  }

  /** Builds the authorization URL. Platform-specific query names live in the subclass. */
  abstract getAuthorizationUrl(input: {
    config: SocialProviderConfig;
    state: string;
    codeChallenge: string | null;
    redirectUri: string;
  }): string;

  /**
   * Converts a token response into `ExternalTokens`.
   *
   * Accepts both `expires_in` (seconds, the OAuth standard) and `expires_at` (absolute,
   * which Douyin returns), because a platform that uses the other name would otherwise
   * produce a token with no expiry — and a token with no expiry is never refreshed, so the
   * connection breaks silently an hour later.
   */
  protected tokensFrom(
    payload: Record<string, unknown>,
    options: { requireRefreshToken?: boolean } = {},
  ): ExternalTokens {
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!accessToken) {
      throw new SocialProviderError("SOCIAL_AUTH_FAILED", "The provider returned no access token");
    }

    const refreshToken =
      typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : null;

    if (options.requireRefreshToken && !refreshToken) {
      /**
       * X and TikTok only issue a refresh token when `offline.access` was requested and
       * granted. A connection without one cannot survive its first expiry, and discovering
       * that an hour later is worse than refusing the connection now.
       */
      throw new SocialProviderError(
        "SOCIAL_AUTH_FAILED",
        "The provider did not issue a refresh token, so this connection could not be kept alive",
      );
    }

    const expiresIn = Number(payload.expires_in);
    const absolute = Number(payload.expires_at);

    let expiresAt: Date | null = null;
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      expiresAt = new Date(Date.now() + expiresIn * 1000);
    } else if (Number.isFinite(absolute) && absolute > 0) {
      // Douyin reports seconds since the epoch, not milliseconds.
      expiresAt = new Date(absolute * 1000);
    }

    const scope = typeof payload.scope === "string" && payload.scope ? payload.scope : null;

    return { accessToken, refreshToken, scope, expiresAt };
  }

  /** Applies the configured client authentication style. */
  protected withClientAuth(
    config: SocialProviderConfig,
    form: Record<string, string>,
  ): { form: Record<string, string>; headers: Record<string, string> } {
    if (this.clientAuth === "basic") {
      const encoded = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
      return { form, headers: { Authorization: `Basic ${encoded}` } };
    }
    return {
      form: { ...form, client_id: config.clientId, client_secret: config.clientSecret },
      headers: {},
    };
  }

  /** Runs the shared authorization-code exchange. */
  protected async exchangeCode(input: {
    config: SocialProviderConfig;
    code: string;
    codeVerifier: string | null;
    redirectUri: string;
    requireRefreshToken?: boolean;
  }): Promise<ExternalTokens> {
    const base: Record<string, string> = {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      ...this.extraTokenFields(input.config),
    };
    if (input.codeVerifier) base.code_verifier = input.codeVerifier;

    const { form, headers } = this.withClientAuth(input.config, base);
    const payload = await providerRequest<Record<string, unknown>>(input.config.tokenEndpoint, {
      method: "POST",
      form,
      headers,
    });
    return this.tokensFrom(payload, { requireRefreshToken: input.requireRefreshToken });
  }

  /** Runs the shared refresh. */
  protected async refresh(input: {
    config: SocialProviderConfig;
    refreshToken: string;
  }): Promise<ExternalTokens> {
    const base: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      ...this.extraTokenFields(input.config),
    };

    const { form, headers } = this.withClientAuth(input.config, base);
    const payload = await providerRequest<Record<string, unknown>>(input.config.tokenEndpoint, {
      method: "POST",
      form,
      headers,
    }).catch((error: unknown) => {
      /**
       * Any refusal here means the stored grant is unusable, and the member has to
       * reconnect. Reported as a distinct code because the UI's remedy differs: refresh
       * failure asks for re-authorization, where a transient provider error asks to retry.
       */
      if (error instanceof SocialProviderError) {
        throw new SocialProviderError(
          "SOCIAL_TOKEN_REFRESH_FAILED",
          "The stored authorization is no longer valid",
          error.detail,
        );
      }
      throw error;
    });

    return this.tokensFrom(payload);
  }
}
