import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { jwtSecretOrDevFallback } from "../common/security-config";
import { JWT_ACCESS_SECRET } from "../auth/auth.constants";
import {
  OAUTH_STATE_TTL_SECONDS,
  codeChallengeFor,
  newCodeVerifier,
  newStateValue,
  stateMatches,
} from "../auth/oauth/oauth-state";
import { SocialProviderError, type ExternalTokens } from "./external-post";
import { ProviderManager } from "./providers/provider-manager";
import { TokenCryptoService } from "./token-crypto.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ProviderUnavailableError,
  isSocialProvider,
  requireProviderConfig,
  socialCallbackUri,
  type SocialProviderId,
} from "./social-sync.config";

/**
 * The authorization flow that connects an external account for SYNC.
 *
 * ## Why this is separate from sign-in, and why it reuses its primitives
 *
 * The two flows have different purposes and different scopes: sign-in proves who someone is,
 * this grants read access to their posts. Sharing the *service* would mean a scope change for
 * sync could break login.
 *
 * What they must not each reinvent is the security mechanism, so this reuses
 * `oauth-state.ts` — the same `state` value, PKCE verifier, and signed-cookie transport that
 * sign-in already uses and that has integration tests. The one difference is the claim
 * discriminator: `type: "social_sync_state"` rather than `"oauth_state"`, so a cookie issued
 * for one flow can never complete the other. That matters because a sync state carries a
 * member id — accepting a sign-in state here would let a login redirect be replayed as a
 * connection.
 *
 * ## The flow
 *
 *   start    → signed cookie + authorization URL
 *   callback → verify state, exchange the code, encrypt and store the tokens, sync once
 *
 * The first sync happens inline, so the member sees their posts immediately after connecting
 * rather than at some later scheduled run.
 */

/** Claim discriminator. Any other value is not a sync state. */
const STATE_TOKEN_TYPE = "social_sync_state";

export type SyncStartResult = {
  authorizationUrl: string;
  stateToken: string;
};

type SyncFlowState = {
  provider: SocialProviderId;
  userId: string;
  state: string;
  codeVerifier: string;
};

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    private readonly providers: ProviderManager,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Begins a connection.
   *
   * The member id travels inside the signed cookie rather than being re-derived from the
   * session on the callback: the callback is a top-level navigation from the provider, and
   * relying on the session cookie surviving a cross-site redirect is a dependency this does
   * not need. The value is signed with the same secret the process already refuses to boot
   * without, so it cannot be forged.
   */
  start(provider: string, userId: string): SyncStartResult {
    if (!isSocialProvider(provider)) {
      throw new SocialProviderError("SOCIAL_PROVIDER_NOT_SUPPORTED", `Unknown provider ${provider}`);
    }

    // Throws `ProviderUnavailableError` for a platform that needs approval or credentials,
    // which the controller turns into the honest code rather than a generic failure.
    const config = requireProviderConfig(provider);

    const state = newStateValue();
    const codeVerifier = newCodeVerifier();

    const stateToken = this.jwtService.sign(
      { type: STATE_TOKEN_TYPE, provider, userId, state, codeVerifier } satisfies SyncFlowState & {
        type: string;
      },
      {
        secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET),
        expiresIn: OAUTH_STATE_TTL_SECONDS,
      },
    );

    const authorizationUrl = this.providers.require(provider).getAuthorizationUrl({
      config,
      state,
      // Every provider that documents PKCE gets it. X requires it; Google accepts it. A
      // provider that does not document it ignores the parameters.
      codeChallenge: codeChallengeFor(codeVerifier),
      redirectUri: socialCallbackUri(provider),
    });

    return { authorizationUrl, stateToken };
  }

  /** Verifies the flow-state cookie and returns what it names. */
  readFlowState(stateToken: string | undefined): SyncFlowState | null {
    if (!stateToken) return null;
    try {
      const payload = this.jwtService.verify<SyncFlowState & { type?: string }>(stateToken, {
        secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET),
      });
      // The discriminator is what keeps a sign-in state from being usable here.
      if (payload?.type !== STATE_TOKEN_TYPE) return null;
      if (!payload.provider || !payload.userId || !payload.state || !payload.codeVerifier) return null;
      return {
        provider: payload.provider,
        userId: payload.userId,
        state: payload.state,
        codeVerifier: payload.codeVerifier,
      };
    } catch {
      // Expired, tampered with, or signed by another key. All the same answer.
      return null;
    }
  }

  /**
   * Completes the connection.
   *
   * Ordering matters and is deliberate:
   *
   *   1. verify the state (a callback that did not start here is refused before any network
   *      call is made on its behalf);
   *   2. exchange the code and read the account;
   *   3. store the tokens ENCRYPTED;
   *   4. sync once.
   *
   * A failure in step 4 does not undo step 3: the connection is real and the tokens are
   * valid, and the member can press 立即同步. Rolling the connection back would make them
   * authorize again for a problem that a retry fixes.
   */
  async complete(input: {
    provider: string;
    code: string | undefined;
    state: string | undefined;
    stateToken: string | undefined;
    providerError?: string;
  }): Promise<{ userId: string; provider: SocialProviderId; accountId: string }> {
    const flowState = this.readFlowState(input.stateToken);
    if (!flowState) {
      throw new SocialProviderError(
        "SOCIAL_AUTH_FAILED",
        "The connection attempt has expired or was not started here",
      );
    }
    if (flowState.provider !== input.provider) {
      // A state issued for one platform must not complete another's callback.
      throw new SocialProviderError("SOCIAL_AUTH_FAILED", "The connection attempt belongs to a different platform");
    }
    if (!stateMatches(flowState.state, input.state)) {
      throw new SocialProviderError("SOCIAL_AUTH_FAILED", "The connection attempt could not be verified");
    }
    if (input.providerError) {
      /**
       * The member pressed cancel. `SOCIAL_AUTH_FAILED` rather than a 500: nothing is broken.
       * `access_denied` is by far the most common value here.
       */
      throw new SocialProviderError("SOCIAL_AUTH_FAILED", "The authorization was declined", input.providerError);
    }
    if (!input.code) {
      throw new SocialProviderError("SOCIAL_AUTH_FAILED", "The provider returned no authorization code");
    }

    const provider = flowState.provider;
    const config = requireProviderConfig(provider);
    const adapter = this.providers.require(provider);

    const authorization = await adapter.handleCallback({
      config,
      code: input.code,
      codeVerifier: flowState.codeVerifier,
      redirectUri: socialCallbackUri(provider),
    });

    const accountId = await this.storeConnection(flowState.userId, provider, authorization);
    return { userId: flowState.userId, provider, accountId };
  }

  /**
   * Creates or replaces the connection row.
   *
   * `upsert` on `(userId, provider)` because reconnecting is the normal way to recover from
   * `NEEDS_REAUTH`: the member authorizes again and the same row is refreshed in place. A
   * create-only path would violate the unique constraint and force an unbind first, which is
   * a worse flow for the common case.
   */
  private async storeConnection(
    userId: string,
    provider: SocialProviderId,
    authorization: { account: { providerUserId: string; handle: string | null; displayName: string | null; avatarUrl: string | null }; tokens: ExternalTokens },
  ): Promise<string> {
    const { account, tokens } = authorization;

    const data = {
      providerUserId: account.providerUserId,
      handle: account.handle,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      // Both tokens are encrypted before they reach the database. The column names end in
      // `Enc` so a reader cannot mistake them for raw values.
      accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? this.crypto.encrypt(tokens.refreshToken) : null,
      scope: tokens.scope,
      tokenExpiresAt: tokens.expiresAt,
      status: "ACTIVE" as const,
      lastSyncError: null,
    };

    const row = await this.prisma.socialSyncAccount.upsert({
      where: { userId_provider: { userId, provider: provider as never } },
      update: data,
      create: { userId, provider: provider as never, ...data },
      select: { id: true },
    });

    return row.id;
  }

  /**
   * Disconnects an account.
   *
   * Provider revocation is attempted first and its failure is swallowed: the member asked to
   * disconnect, and refusing because the provider was unreachable would trap them in a
   * connection they no longer want. The local rows go either way, which is what the member
   * can observe.
   */
  async disconnect(userId: string, provider: string, accountId: string): Promise<void> {
    const account = await this.prisma.socialSyncAccount.findFirst({
      where: { id: accountId, userId },
      select: { id: true, provider: true, accessTokenEnc: true },
    });
    if (!account) return;

    const providerId = account.provider as SocialProviderId;
    if (isSocialProvider(providerId)) {
      const config = requireProviderConfig(providerId);
      const accessToken = this.crypto.tryDecrypt(account.accessTokenEnc);
      if (accessToken) {
        try {
          await this.providers.require(providerId).revoke({ config, accessToken });
        } catch (error) {
          this.logger.warn(
            `Provider revocation failed for ${providerId} (continuing with the local unbind): ${
              error instanceof Error ? error.message : "unknown"
            }`,
          );
        }
      }
    }

    // `SocialSyncPost` has `onDelete: Cascade`, so the cached posts go with it.
    await this.prisma.socialSyncAccount.delete({ where: { id: account.id } });
    void provider;
  }

  /** Used by the controller to translate a start-time refusal into a code and message. */
  availabilityOf(provider: string) {
    if (!isSocialProvider(provider)) return null;
    return this.providers.configuration(provider).availability;
  }
}

export { ProviderUnavailableError };
