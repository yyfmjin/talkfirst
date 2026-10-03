import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { jwtSecretOrDevFallback } from "../../common/security-config";
import { JWT_ACCESS_SECRET } from "../auth.constants";
import { SessionService } from "../session.service";
import { OAuthAccountService, type AccountLoginMethods } from "./oauth-account.service";
import {
  type OAuthProviderConfig,
  DEV_PROVIDER_ID,
  readConfiguredProviders,
  readOAuthProviderConfig,
} from "./oauth-config";
import {
  OAUTH_STATE_TTL_SECONDS,
  buildAuthorizationUrl,
  codeChallengeFor,
  newCodeVerifier,
  newNonceValue,
  newStateValue,
  safeRedirectTarget,
  stateMatches,
  type OAuthFlowState,
} from "./oauth-state";
import { OAuthError, type IdTokenVerifier, type ProviderIdentity } from "./oauth.types";

/**
 * Google 登录的编排层：发起 → 回调 → 账号解析 → 会话。
 *
 * ## Why the flow state travels in a signed cookie
 *
 * See `oauth-state.ts`. The short version: `state`, the PKCE verifier and the
 * nonce must survive a round trip through the provider, and a signed HttpOnly
 * cookie does that with no table, no cleanup job and nothing readable by
 * JavaScript.
 *
 * ## Why the state token is signed with the ACCESS secret and a distinct `type`
 *
 * It reuses the secret this process already refuses to boot without, rather than
 * introducing a fourth one. The `type: "oauth_state"` claim is what keeps it from
 * being usable as a session: `JwtStrategy` only accepts `type: "access"`, so even
 * if this token leaked into the Authorization header it would not authenticate
 * anything.
 */

/** Claim discriminator. Any other value is not a flow state. */
const STATE_TOKEN_TYPE = "oauth_state";

/** What a completed sign-in needs, before the controller touches HTTP. */
export type OAuthSignInResult = {
  redirectTo: string;
  user: unknown;
  accessToken: string;
  refreshToken: string;
  /** True when this sign-in created the account for the first time. */
  isNewAccount: boolean;
};

/** Extra data the controller needs when a refusal is reported to the user. */
export type OAuthRefusal = {
  code: string;
  /** Non-null only for `account_exists`. */
  methods?: AccountLoginMethods;
};

@Injectable()
export class OAuthService {
  private readonly logger = new Logger("OAuth");

  constructor(
    private readonly sessions: SessionService,
    private readonly accounts: OAuthAccountService,
    private readonly jwtService: JwtService,
    /** Injected so tests and the E2E suite can substitute a local verifier. */
    private readonly verifierFactory: (config: OAuthProviderConfig) => IdTokenVerifier,
  ) {}

  /** Providers that are configured and therefore offered to the client. */
  configuredProviders(): string[] {
    return readConfiguredProviders();
  }

  isConfigured(provider: string): boolean {
    return this.configuredProviders().includes(provider.toLowerCase());
  }

  /**
   * Start a sign-in: returns the provider URL to send the browser to, plus the
   * cookie value the caller must set.
   *
   * The state is generated here and never accepted from the request — a
   * caller-supplied `state` would let an attacker pre-plant the CSRF token.
   */
  begin(
    provider: string,
    config: OAuthProviderConfig,
    options: { redirectTo?: string | null; appUrl: string },
  ): { authorizationUrl: string; stateToken: string; flowState: OAuthFlowState } {
    const state = newStateValue();
    const nonce = newNonceValue();
    const codeVerifier = newCodeVerifier();

    const flowState: OAuthFlowState = {
      provider,
      state,
      codeVerifier,
      nonce,
      redirectTo: safeRedirectTarget(options.redirectTo, options.appUrl),
    };

    const stateToken = this.jwtService.sign(
      { type: STATE_TOKEN_TYPE, ...flowState },
      {
        secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET),
        expiresIn: OAUTH_STATE_TTL_SECONDS,
      },
    );

    const authorizationUrl = buildAuthorizationUrl(config.authorizationEndpoint, {
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      nonce,
      codeChallenge: codeChallengeFor(codeVerifier),
    });

    return { authorizationUrl, stateToken, flowState };
  }

  /**
   * Complete a sign-in from the provider's callback.
   *
   * @param stateToken the value of the flow-state cookie; `undefined` when the
   *   cookie is missing (expired, cleared, or a callback that never started here)
   * @param providerError the provider's own `error` parameter, when the user
   *   refused consent or the request was rejected before reaching us
   */
  async complete(
    provider: string,
    config: OAuthProviderConfig,
    params: { code?: string; state?: string; stateToken?: string; providerError?: string },
  ): Promise<OAuthSignInResult> {
    if (params.providerError) {
      /**
       * The provider refused (most often `access_denied` — the user pressed
       * "cancel"). Reported as an invalid attempt rather than a 500: nothing is
       * broken, the sign-in simply did not happen.
       */
      throw new OAuthError("OAUTH_EXCHANGE_FAILED", `The provider refused the request: ${params.providerError}`);
    }

    const flowState = this.readFlowState(params.stateToken);
    if (!flowState) {
      throw new OAuthError("OAUTH_STATE_INVALID", "The sign-in attempt has expired or was not started here");
    }
    if (flowState.provider !== provider) {
      // A state issued for one provider must not complete another's callback.
      throw new OAuthError("OAUTH_STATE_INVALID", "The sign-in attempt belongs to a different provider");
    }
    if (!stateMatches(flowState.state, params.state)) {
      throw new OAuthError("OAUTH_STATE_INVALID", "The sign-in attempt does not match this callback");
    }
    if (!params.code) {
      throw new OAuthError("OAUTH_EXCHANGE_FAILED", "The provider returned no authorization code");
    }

    const identity = await this.exchangeCodeForIdentity(config, params.code, flowState);
    const resolution = await this.accounts.resolve(identity);

    if (resolution.kind === "account_exists") {
      throw new OAuthAccountExistsError(resolution.methods);
    }

    const session = await this.sessions.issue(resolution.user);
    // Same device bookkeeping as a password login, so `DeviceUser.loginCount`
    // keeps meaning "authentications", not "password authentications".
    await this.sessions.recordDevice(resolution.user.id);

    return {
      redirectTo: flowState.redirectTo,
      user: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      // Taken from the resolution rather than inferred from the user row:
      // `createdAt === updatedAt` looked like a shortcut but Prisma's `@updatedAt`
      // is not guaranteed to equal `createdAt` on insert, so it would have been a
      // flag that is sometimes wrong — worse than no flag.
      isNewAccount: resolution.isNewAccount,
    };
  }

  /**
   * Resolve the provider config, refusing with the code the client understands.
   *
   * Centralised so every entry point answers an unconfigured provider the same
   * way (`OAUTH_PROVIDER_DISABLED`) instead of each one inventing its own null
   * handling — and so the "is it on?" question has exactly one implementation.
   */
  requireProviderConfig(provider: string): OAuthProviderConfig {
    const config = readOAuthProviderConfig(provider);
    if (!config) {
      throw new OAuthError("OAUTH_PROVIDER_DISABLED", `The ${provider} provider is not configured`);
    }
    return config;
  }

  /** Decode and validate the flow-state cookie. Returns null for anything unusable. */
  readFlowState(stateToken: string | undefined): OAuthFlowState | null {
    if (!stateToken) return null;
    try {
      const payload = this.jwtService.verify<OAuthFlowState & { type?: string }>(stateToken, {
        secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET),
      });
      /**
       * The `type` check is what stops a session token being replayed as a flow
       * state (and vice versa): both are signed with the same secret, so only the
       * discriminator separates them.
       */
      if (payload.type !== STATE_TOKEN_TYPE) return null;
      if (!payload.state || !payload.codeVerifier || !payload.nonce) return null;
      return {
        provider: payload.provider,
        state: payload.state,
        codeVerifier: payload.codeVerifier,
        nonce: payload.nonce,
        redirectTo: payload.redirectTo ?? "/discover",
      };
    } catch {
      // Expired, tampered with, or signed with a different secret — all the same
      // answer to the caller.
      return null;
    }
  }

  /**
   * Trade the authorization code for an `id_token`, then verify it.
   *
   * The code is exchanged from the SERVER with the client secret, so the tokens
   * never pass through the browser. `code_verifier` proves this server is the one
   * that started the flow, so a code intercepted from the redirect is useless on
   * its own.
   */
  private async exchangeCodeForIdentity(
    config: OAuthProviderConfig,
    code: string,
    flowState: OAuthFlowState,
  ): Promise<ProviderIdentity> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: flowState.codeVerifier,
    });

    let payload: { id_token?: unknown; error?: unknown; error_description?: unknown };
    try {
      const response = await fetch(config.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: body.toString(),
      });
      payload = (await response.json()) as typeof payload;
      if (!response.ok) {
        /**
         * The provider's own error is surfaced in the MESSAGE (for the security
         * event and the server log) but never in the response body — it can name
         * the reason a client id or secret was rejected, which is config
         * information.
         */
        const detail = typeof payload.error_description === "string" ? payload.error_description : "no detail";
        const code_ = typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
        throw new OAuthError("OAUTH_EXCHANGE_FAILED", `Token endpoint refused the code: ${code_} (${detail})`);
      }
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      this.logger.error(`Token exchange failed: ${error instanceof Error ? error.message : "unknown"}`);
      throw new OAuthError("OAUTH_EXCHANGE_FAILED", "Could not reach the provider's token endpoint");
    }

    if (typeof payload.id_token !== "string") {
      throw new OAuthError("OAUTH_EXCHANGE_FAILED", "The provider returned no id_token");
    }

    return this.verifierFactory(config).verify(payload.id_token, flowState.nonce);
  }

  /** Exposed so the controller can report which provider ids exist. */
  get devProviderId(): string {
    return DEV_PROVIDER_ID;
  }
}

/**
 * `account_exists` is a refusal that needs to CARRY data.
 *
 * `OAuthError` only has a code, but this branch must tell the client which ways
 * the account can actually be entered — otherwise the message becomes "use your
 * password" for an account that has none, which is the dead end this design
 * exists to avoid.
 */
export class OAuthAccountExistsError extends OAuthError {
  readonly methods: AccountLoginMethods;

  constructor(methods: AccountLoginMethods) {
    super("OAUTH_ACCOUNT_EXISTS", "An account with this e-mail already exists");
    this.name = "OAuthAccountExistsError";
    this.methods = methods;
  }
}

/** Narrowing helper used by the controller. */
export function isAccountExistsError(error: unknown): error is OAuthAccountExistsError {
  return error instanceof OAuthAccountExistsError;
}
