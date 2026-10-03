import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TokenCryptoService } from "./token-crypto.service";
import { ProviderManager } from "./providers/provider-manager";
import { SocialProviderError, type ExternalPost } from "./external-post";
import type { ExternalTokens } from "./external-post";
import {
  ProviderUnavailableError,
  isSocialProvider,
  providerConfiguration,
  type SocialProviderId,
} from "./social-sync.config";

/**
 * Pulls a member's recent external posts into the local cache.
 *
 * ## The three rules this enforces, and why each matters
 *
 * 1. **Nothing is fetched on read.** The profile page only reads PostgreSQL. The alternative
 *    — calling a provider when someone opens a profile — makes page latency depend on an
 *    external service, burns the member's API quota on other people's page views, and breaks
 *    the page entirely when the provider is slow.
 *
 * 2. **Deduplication is by `(socialAccountId, provider, externalPostId)`.** A repeat sync
 *    UPDATEs the existing row rather than creating a second one, so a member's per-post
 *    choices (`hidden`, `importedMomentId`) survive every subsequent sync. An insert would
 *    reset them on each run.
 *
 * 3. **A failed sync never deletes anything.** `syncLimit` shrinking from 3 to 1 hides the
 *    older posts from the response but leaves the rows, so raising the limit again brings
 *    them back and an import that referenced one is not broken.
 *
 * ## Error handling
 *
 * A provider refusal is recorded on the account (`lastSyncError`, and `NEEDS_REAUTH` where
 * re-authorization is the remedy) and re-thrown for the caller. It is never allowed to leave
 * the account in a worse state than it was: the tokens are only overwritten on a successful
 * refresh.
 */

/** What changed in one sync, for the caller and the log. */
export type SyncOutcome = {
  provider: SocialProviderId;
  fetched: number;
  created: number;
  updated: number;
  /** True when a refresh happened mid-sync. */
  refreshed: boolean;
};

@Injectable()
export class SocialSyncService {
  private readonly logger = new Logger(SocialSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    private readonly providers: ProviderManager,
  ) {}

  /**
   * Syncs one account.
   *
   * `accountId` rather than a provider id, because the caller has already resolved which
   * connection to refresh — and resolving it again here would let the two disagree.
   */
  async syncAccount(accountId: string): Promise<SyncOutcome> {
    const account = await this.prisma.socialSyncAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new Error(`No social account ${accountId}`);
    }
    if (account.status === "REVOKED") {
      throw new SocialProviderError("SOCIAL_AUTH_REQUIRED", "This connection has been disconnected");
    }

    const provider = account.provider as SocialProviderId;
    if (!isSocialProvider(provider)) {
      throw new SocialProviderError("SOCIAL_PROVIDER_NOT_SUPPORTED", `Unknown provider ${account.provider}`);
    }

    const config = providerConfiguration(provider);
    if (config.availability !== "AVAILABLE") {
      throw new ProviderUnavailableError(provider, config.availability);
    }

    const adapter = this.providers.require(provider);

    let accessToken = this.crypto.tryDecrypt(account.accessTokenEnc);
    if (!accessToken) {
      /**
       * The stored token cannot be decrypted at all — a rotated `TOKEN_ENCRYPTION_KEY`, or a
       * tampered row. Only re-authorization can fix it, so the account is marked rather than
       * retried, and the member is told to reconnect instead of watching a sync fail forever.
       */
      await this.markNeedsReauth(accountId, "SOCIAL_AUTH_REQUIRED");
      throw new SocialProviderError("SOCIAL_AUTH_REQUIRED", "The stored authorization could not be read");
    }

    let refreshed = false;

    /**
     * Refresh ahead of expiry rather than on failure.
     *
     * A token with five minutes left will expire mid-request, and the resulting 401 is
     * indistinguishable from a revoked grant — so the member would be told to reconnect when
     * a refresh would have sufficed. The 60-second margin covers clock skew and request time.
     */
    const expiresSoon =
      account.tokenExpiresAt !== null && account.tokenExpiresAt.getTime() - Date.now() < 60_000;

    if (expiresSoon) {
      const refreshToken = this.crypto.tryDecrypt(account.refreshTokenEnc);
      if (!refreshToken) {
        await this.markNeedsReauth(accountId, "SOCIAL_AUTH_REQUIRED");
        throw new SocialProviderError(
          "SOCIAL_AUTH_REQUIRED",
          "The authorization has expired and cannot be renewed",
        );
      }

      let renewed: ExternalTokens;
      try {
        renewed = await adapter.refreshToken({ config, refreshToken });
      } catch (error) {
        const code = error instanceof SocialProviderError ? error.code : "SOCIAL_TOKEN_REFRESH_FAILED";
        /**
         * A refresh refusal means the grant is gone — the member revoked access at the
         * provider, or the refresh token aged out. `NEEDS_REAUTH` is the state the UI reads to
         * offer "重新授权" instead of a retry button that cannot work.
         */
        await this.markNeedsReauth(accountId, code);
        throw error;
      }

      await this.persistTokens(accountId, renewed, account.refreshTokenEnc);
      accessToken = renewed.accessToken;
      refreshed = true;
    }

    let posts: ExternalPost[];
    try {
      posts = await adapter.getRecentPosts({
        config,
        accessToken,
        providerUserId: account.providerUserId,
        limit: account.syncLimit,
      });
    } catch (error) {
      const code = error instanceof SocialProviderError ? error.code : "SOCIAL_SYNC_FAILED";
      // A read failure is recorded but does NOT mark the account for re-authorization unless
      // the provider said the token is bad — a rate limit or an outage is transient, and
      // forcing a reconnect for it would be a worse experience than a stale profile.
      await this.recordSyncError(accountId, code);
      throw error;
    }

    const { created, updated } = await this.upsertPosts(accountId, provider, posts);

    await this.prisma.socialSyncAccount.update({
      where: { id: accountId },
      data: { lastSyncedAt: new Date(), lastSyncError: null, status: "ACTIVE" },
    });

    this.logger.log(
      `Synced ${provider} account ${accountId}: ${posts.length} fetched, ${created} created, ${updated} updated`,
    );

    return { provider, fetched: posts.length, created, updated, refreshed };
  }

  /**
   * Writes the fetched posts, keyed by the provider's own post id.
   *
   * A single transaction so a partially-applied sync cannot leave the profile showing half of
   * one run and half of the previous one.
   */
  private async upsertPosts(
    accountId: string,
    provider: SocialProviderId,
    posts: ExternalPost[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const post of posts) {
      const existing = await this.prisma.socialSyncPost.findUnique({
        where: {
          socialAccountId_provider_externalPostId: {
            socialAccountId: accountId,
            provider: provider as never,
            externalPostId: post.externalPostId,
          },
        },
        select: { id: true },
      });

      /**
       * The mutable fields are all provider-owned content. `hidden` and `importedMomentId`
       * are deliberately absent: they are the member's decisions, and a re-sync must not
       * un-hide a post the member hid or forget that they imported one.
       */
      const data = {
        externalUrl: post.externalUrl,
        authorId: post.authorId,
        authorName: post.authorName,
        authorAvatar: post.authorAvatar,
        text: post.text,
        title: post.title,
        mediaType: post.mediaType as never,
        thumbnailUrl: post.thumbnailUrl,
        mediaUrl: post.mediaUrl,
        embedUrl: post.embedUrl,
        publishedAt: post.publishedAt,
        // The raw payload can contain fields the product never displays; it is stored for
        // debugging and is never returned to a client verbatim.
        rawData: (post.raw ?? null) as never,
      };

      if (existing) {
        await this.prisma.socialSyncPost.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await this.prisma.socialSyncPost.create({
          data: { socialAccountId: accountId, provider: provider as never, externalPostId: post.externalPostId, ...data },
        });
        created += 1;
      }
    }

    return { created, updated };
  }

  /**
   * Stores new tokens, encrypting both.
   *
   * `previousRefreshTokenEnc` is carried forward when the provider did not issue a new one —
   * Google never does on refresh, and overwriting with null would break the NEXT refresh, i.e.
   * the connection would die an hour after a successful sync.
   */
  private async persistTokens(
    accountId: string,
    tokens: ExternalTokens,
    previousRefreshTokenEnc: string | null,
  ): Promise<void> {
    await this.prisma.socialSyncAccount.update({
      where: { id: accountId },
      data: {
        accessTokenEnc: this.crypto.encrypt(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken
          ? this.crypto.encrypt(tokens.refreshToken)
          : previousRefreshTokenEnc,
        scope: tokens.scope,
        tokenExpiresAt: tokens.expiresAt,
      },
    });
  }

  private async markNeedsReauth(accountId: string, code: string): Promise<void> {
    await this.prisma.socialSyncAccount.update({
      where: { id: accountId },
      data: { status: "NEEDS_REAUTH", lastSyncError: code.slice(0, 64) },
    });
  }

  private async recordSyncError(accountId: string, code: string): Promise<void> {
    await this.prisma.socialSyncAccount.update({
      where: { id: accountId },
      data: { lastSyncError: code.slice(0, 64) },
    });
  }
}
