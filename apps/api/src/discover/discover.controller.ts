import { Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { DiscoverService } from "./discover.service";

@Controller("discover")
@UseGuards(JwtAuthGuard)
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Get("recommendations")
  async recommendations(
    @CurrentUser() user: AuthUser,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
    @Query("filter") filter?: string,
  ) {
    return {
      success: true as const,
      data: await this.discoverService.getRecommendations(user.id, limit, filter),
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
