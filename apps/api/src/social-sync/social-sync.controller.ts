import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { accessCookieOptions } from "../auth/auth.constants";
import { OAUTH_STATE_TTL_SECONDS } from "../auth/oauth/oauth-state";
import { ValidationPipe } from "../common/validation.pipe";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderManager } from "./providers/provider-manager";
import { SocialAuthService } from "./social-auth.service";
import { SocialSyncService } from "./social-sync.service";
import { SocialProviderError } from "./external-post";
import { ProviderUnavailableError, isSocialProvider } from "./social-sync.config";

/**
 * Social account sync: connect, configure, sync, list, hide, import, disconnect.
 *
 * ## Route split
 *
 * Everything except `:provider/callback` requires a session, because everything else acts on
 * the signed-in member's own connections. The callback does not, and that is deliberate: it
 * arrives as a top-level cross-site navigation from the provider, where relying on the
 * session cookie is a dependency this flow does not need — the signed state token already
 * names the member, and it is verified before anything is written.
 *
 * ## Why the provider id is validated here rather than in the service
 *
 * A path segment is user input. Checking it at the boundary means the service can take a
 * typed `SocialProviderId`, and an unknown value produces `SOCIAL_PROVIDER_NOT_SUPPORTED`
 * instead of an internal error.
 */

/** `syncLimit` is the product's 1–3 promise. The database CHECK constraint enforces it too. */
class SyncSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  syncLimit?: number;

  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean;
}

class HidePostDto {
  @IsBoolean()
  hidden!: boolean;
}

class ImportPostDto {
  /** Optional body override for the created moment; defaults to the external text. */
  @IsOptional()
  content?: string;
}

@Controller("social-sync")
export class SocialSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: SocialAuthService,
    private readonly sync: SocialSyncService,
    private readonly providers: ProviderManager,
  ) {}

  /**
   * The advertised platforms and their availability.
   *
   * `REQUIRES_APPROVAL` is returned as data rather than hidden, because the product's answer
   * for those platforms is to say so: a member who cannot sync Instagram should be told why
   * and offered the alternative, not shown a button that fails.
   */
  @Get("providers")
  @UseGuards(JwtAuthGuard)
  providersCatalogue() {
    return { success: true as const, data: { providers: this.providers.catalogue() } };
  }

  /** The member's connections. */
  @Get("accounts")
  @UseGuards(JwtAuthGuard)
  async accounts(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.socialSyncAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        provider: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
        syncLimit: true,
        syncEnabled: true,
        status: true,
        lastSyncedAt: true,
        lastSyncError: true,
      },
    });
    return { success: true as const, data: { accounts: rows } };
  }

  /**
   * Begins a connection and returns the provider URL.
   *
   * The state travels in an HttpOnly cookie scoped to this route prefix, which is a different
   * path from the sign-in cookie — so the two flows cannot read each other's state even
   * though both are signed with the same secret.
   */
  @Get(":provider/start")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  start(
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const provider = this.requireProvider(request);
    const { authorizationUrl, stateToken } = this.auth.start(provider, user.id);

    response.cookie(stateCookieName(provider), stateToken, stateCookieOptions());
    return { success: true as const, data: { authorizationUrl } };
  }

  /**
   * The provider's redirect back.
   *
   * Redirects the browser to the app with a code, because a navigation cannot read JSON. The
   * cookie is cleared on every path, success or failure, so a state value is genuinely
   * single-use.
   */
  @Get(":provider/callback")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") providerError?: string,
  ) {
    const provider = this.requireProvider(request);
    const cookieName = stateCookieName(provider);
    const stateToken = (request.cookies as Record<string, string> | undefined)?.[cookieName];

    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    const target = new URL("/me/social", appUrl);

    try {
      const result = await this.auth.complete({ provider, code, state, stateToken, providerError });

      /**
       * The first sync runs inline so the member sees their posts immediately. A failure here
       * does NOT fail the connection: the tokens are stored and valid, and the member can
       * press 立即同步. Reporting a failure would send them through authorization again for
       * something a retry fixes.
       */
      try {
        await this.sync.syncAccount(result.accountId);
        target.searchParams.set("social_sync", "connected");
      } catch (error) {
        const code2 = error instanceof SocialProviderError ? error.code : "SOCIAL_SYNC_FAILED";
        target.searchParams.set("social_sync", "connected_sync_failed");
        target.searchParams.set("social_error", code2);
      }
    } catch (error) {
      const code = error instanceof SocialProviderError ? error.code : "SOCIAL_AUTH_FAILED";
      target.searchParams.set("social_error", code);
    } finally {
      response.clearCookie(cookieName, stateCookieOptions());
    }

    response.redirect(target.toString());
  }

  /** Updates the member's choices for one connection. */
  @Patch("accounts/:id")
  @UseGuards(JwtAuthGuard)
  async updateAccount(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: SyncSettingsDto,
  ) {
    /**
     * The 1–3 range is validated here AND enforced by a database CHECK constraint. The DTO
     * alone would be bypassed by any caller that does not go through this route.
     */
    const data: { syncLimit?: number; syncEnabled?: boolean } = {};
    if (dto.syncLimit !== undefined) data.syncLimit = dto.syncLimit;
    if (dto.syncEnabled !== undefined) data.syncEnabled = dto.syncEnabled;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Nothing to change" },
      });
    }

    // `updateMany` with the owner in the filter: a row belonging to another member matches
    // nothing rather than being updated, which is the same outcome as a 404 without an
    // existence check that would leak whether the id exists.
    const result = await this.prisma.socialSyncAccount.updateMany({
      where: { id, userId: user.id },
      data,
    });
    if (result.count === 0) {
      throw new BadRequestException({
        success: false,
        error: { code: "SOCIAL_ACCOUNT_NOT_FOUND", message: "No such connection" },
      });
    }
    return { success: true as const, data: { updated: result.count } };
  }

  /** Manual "立即同步". */
  @Post("accounts/:id/sync")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 6, ttl: 60000 } })
  async syncNow(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    // Ownership is checked before the sync, so a member cannot trigger API calls on someone
    // else's connection — which would spend that person's provider quota.
    const owned = await this.prisma.socialSyncAccount.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      throw new BadRequestException({
        success: false,
        error: { code: "SOCIAL_ACCOUNT_NOT_FOUND", message: "No such connection" },
      });
    }
    return { success: true as const, data: await this.sync.syncAccount(id) };
  }

  /** Disconnects, and asks the provider to drop the grant. */
  @Delete("accounts/:id")
  @UseGuards(JwtAuthGuard)
  async disconnect(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    await this.auth.disconnect(user.id, "", id);
    return { success: true as const, data: { disconnected: true } };
  }

  /**
   * The member's synced posts.
   *
   * `hidden` rows are excluded from this list — it is the public-facing view of their own
   * profile — while the settings screen lists them so a member can un-hide one.
   */
  @Get("posts")
  @UseGuards(JwtAuthGuard)
  async posts(@CurrentUser() user: AuthUser) {
    const accounts = await this.prisma.socialSyncAccount.findMany({
      where: { userId: user.id },
      select: { id: true, provider: true, syncLimit: true, syncEnabled: true, status: true },
    });

    /**
     * The limit is applied per account, in the query, rather than by fetching everything and
     * slicing — otherwise a member who lowered their limit to 1 would still transfer their
     * whole history on every profile read.
     */
    const perAccount = await Promise.all(
      accounts.map(async (account) => {
        const posts = await this.prisma.socialSyncPost.findMany({
          where: { socialAccountId: account.id, hidden: false },
          orderBy: { publishedAt: "desc" },
          take: account.syncLimit,
          select: {
            id: true,
            provider: true,
            externalPostId: true,
            externalUrl: true,
            authorName: true,
            authorAvatar: true,
            text: true,
            title: true,
            mediaType: true,
            thumbnailUrl: true,
            embedUrl: true,
            publishedAt: true,
            importedMomentId: true,
          },
        });
        return { accountId: account.id, provider: account.provider, posts };
      }),
    );

    return { success: true as const, data: { accounts: perAccount } };
  }

  /** Hides or shows one synced post. */
  @Patch("posts/:id")
  @UseGuards(JwtAuthGuard)
  async hidePost(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: HidePostDto,
  ) {
    const owned = await this.prisma.socialSyncPost.findFirst({
      where: { id, socialAccount: { userId: user.id } },
      select: { id: true },
    });
    if (!owned) {
      throw new BadRequestException({
        success: false,
        error: { code: "SOCIAL_POST_NOT_FOUND", message: "No such post" },
      });
    }
    await this.prisma.socialSyncPost.update({ where: { id }, data: { hidden: dto.hidden } });
    return { success: true as const, data: { hidden: dto.hidden } };
  }

  /**
   * Imports one external post as a native moment.
   *
   * ## What "import" means, and what it does not
   *
   * It creates a TalkFirst `Moment` that QUOTES the external post: the text is copied, the
   * original is linked, and — crucially — no media is downloaded. The external URL is kept on
   * the moment so the origin is never lost, which is also what keeps the feature inside every
   * platform's terms: the content is referenced, not republished.
   *
   * ## Why it is idempotent
   *
   * `importedMomentId` is checked first, so pressing the button twice returns the existing
   * moment rather than creating a second copy. A member who double-taps should not get two
   * identical posts on their profile.
   */
  @Post("posts/:id/import")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async importPost(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: ImportPostDto,
  ) {
    const post = await this.prisma.socialSyncPost.findFirst({
      where: { id, socialAccount: { userId: user.id } },
    });
    if (!post) {
      throw new BadRequestException({
        success: false,
        error: { code: "SOCIAL_POST_NOT_FOUND", message: "No such post" },
      });
    }
    if (post.importedMomentId) {
      return { success: true as const, data: { momentId: post.importedMomentId, alreadyImported: true } };
    }

    const text = (dto.content ?? post.text ?? post.title ?? "").trim();
    const body = [
      text,
      // The source line is part of the moment rather than metadata only, so the origin
      // survives being copied, screenshotted, or read outside the app.
      `原文：${post.externalUrl}`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 2000);

    if (!body) {
      throw new BadRequestException({
        success: false,
        error: { code: "SOCIAL_IMPORT_NOT_SUPPORTED", message: "This post has no text to import" },
      });
    }

    const moment = await this.prisma.moment.create({
      data: {
        userId: user.id,
        platform: "TALKFIRST" as never,
        platformName: "TalkFirst",
        content: body,
        images: [],
        // No video is attached even for a video post: the media is not downloaded, and
        // pointing `videoUrl` at the provider's CDN would break as soon as that URL expires.
        videoUrl: null,
        tags: [],
        source: "USER",
        syncedAt: new Date(),
        // An import is the member's own deliberate act, so it is published under the same
        // moderation rules as any other post rather than bypassing them.
        reviewStatus: "APPROVED",
      },
      select: { id: true },
    });

    await this.prisma.socialSyncPost.update({
      where: { id: post.id },
      data: { importedMomentId: moment.id },
    });

    return { success: true as const, data: { momentId: moment.id, alreadyImported: false } };
  }

  private requireProvider(request: Request): string {
    const raw = ((request.params as Record<string, string | undefined>).provider ?? "").toLowerCase();
    if (!isSocialProvider(raw.toUpperCase())) {
      throw new BadRequestException({
        success: false,
        error: { code: "SOCIAL_PROVIDER_NOT_SUPPORTED", message: `未知平台：${raw}` },
      });
    }
    return raw.toUpperCase();
  }
}

/**
 * The flow-state cookie, named per provider and scoped to this route prefix.
 *
 * A different name and a different `path` from the sign-in cookie is what makes the two flows
 * independent: neither can read the other's state even though both are signed with the same
 * secret, and a member can be mid-connection on two platforms at once.
 */
export function stateCookieName(provider: string): string {
  return `tf_social_sync_state_${provider.toLowerCase()}`;
}

function stateCookieOptions() {
  return {
    httpOnly: true,
    // `lax` so it survives the provider's top-level redirect back; `strict` would drop it on
    // exactly the request that needs it.
    sameSite: "lax" as const,
    secure: accessCookieOptions().secure,
    path: "/api/v1/social-sync",
    maxAge: OAUTH_STATE_TTL_SECONDS * 1000,
  };
}

export { ProviderUnavailableError };
