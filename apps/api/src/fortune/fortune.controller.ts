import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { FortuneService } from "./fortune.service";
import type { FortuneLang } from "./fortune.copy";

/**
 * 每日占卜卡片。
 *
 * 只有读操作、结果只跟「谁 + 哪一天」有关，所以不需要任何写入接口；
 * 限流给得比翻译宽（60/分钟）：卡片在首页，切前后台会重拉。
 */
@Controller("fortune")
@UseGuards(JwtAuthGuard)
export class FortuneController {
  constructor(private readonly fortune: FortuneService) {}

  @Get("today")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async today(
    @CurrentUser() user: AuthUser,
    @Query("lang") lang?: string,
    @Query("date") date?: string,
  ) {
    return {
      success: true as const,
      data: await this.fortune.today(user.id, normalizeLang(lang), date),
    };
  }
}

/** `en` / `en-US` / `en-GB` 都当英文；其余一律中文（产品的主语言）。 */
export function normalizeLang(value?: string): FortuneLang {
  return typeof value === "string" && value.toLowerCase().startsWith("en") ? "en" : "zh-CN";
}
