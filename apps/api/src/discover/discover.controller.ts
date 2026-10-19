import { Controller, Get, Headers, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { DiscoverService } from "./discover.service";
import { resolveLocale } from "../common/i18n";

@Controller("discover")
@UseGuards(JwtAuthGuard)
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  /**
   * The filter tabs, so the client never hardcodes them.
   *
   * Declared BEFORE `views/:userId` would not matter for `GET` (that route is a `POST`),
   * but the path is static and non-overlapping either way.
   */
  @Get("categories")
  async categories(@Headers("accept-language") acceptLanguage?: string) {
    return {
      success: true as const,
      data: await this.discoverService.listCategories(resolveLocale({ locale: acceptLanguage })),
    };
  }

  @Get("recommendations")
  async recommendations(
    @CurrentUser() user: AuthUser,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
    @Query("filter") filter?: string,
    /* 推荐理由与筛选标签都按**浏览者**的语言：他是唯一会看到这些文字的人。 */
    @Headers("accept-language") acceptLanguage?: string,
  ) {
    return {
      success: true as const,
      data: await this.discoverService.getRecommendations(
        user.id,
        limit,
        filter,
        resolveLocale({ locale: acceptLanguage }),
      ),
    };
  }

  @Post("views/:userId")
  async markViewed(
    @CurrentUser() user: AuthUser,
    @Param("userId", UuidParamPipe) viewedUserId: string,
  ) {
    return {
      success: true as const,
      data: await this.discoverService.markViewed(user.id, viewedUserId),
    };
  }
}
