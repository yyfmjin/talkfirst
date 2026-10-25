import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional, Matches } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { ValidationPipe } from "../common/validation.pipe";
import { GuessService } from "./guess.service";

class AnswerDto {
  /**
   * 客户端回传的只能是服务端下发的三个候选之一 —— 这一点由 `GuessService.answer`
   * 再校验一次（`options` 里没有就 400），这里只挡明显不合法的大写/长度。
   */
  @Matches(/^[A-Za-z]{2}$/, { message: "countryCode must be a 2-letter country code" })
  countryCode!: string;
}

class SettingsDto {
  @IsOptional()
  @IsBoolean()
  optOut?: boolean;

  /**
   * 本人自报「我的头像不是真人照片」。入参用正向表述（是不是真人），
   * 存库时取反存成 `avatarGuessExcluded` —— 库里存「被排除」比存「是真人」
   * 更安全：新字段默认 false（= 没被排除），与「默认参与」的决定一致。
   */
  @IsOptional()
  @IsBoolean()
  avatarIsRealPhoto?: boolean;
}

/**
 * 猜猜看（2026-10-25）。
 *
 * 路由挂在 `discover/guess` 下：它和发现页共用同一个每日 20 次额度
 * （见 `GuessService.remainingFor`），放在同一个前缀下，调用方也少记一个入口。
 */
@Controller("discover/guess")
@UseGuards(JwtAuthGuard)
export class GuessController {
  constructor(private readonly guess: GuessService) {}

  /** 出一道题：三个候选（已打乱）+ 头像地址 + 剩余次数。答案不下发。 */
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async next(@CurrentUser() user: AuthUser) {
    return { success: true as const, data: await this.guess.nextRound(user.id) };
  }

  /** 自己的参与设置与「被猜中 N%」（只有本人看得到，不进入任何他人可见的接口）。 */
  @Get("settings")
  async settings(@CurrentUser() user: AuthUser) {
    return { success: true as const, data: await this.guess.settings(user.id) };
  }

  @Patch("settings")
  async updateSettings(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: SettingsDto) {
    return {
      success: true as const,
      data: await this.guess.updateSettings(user.id, { optOut: dto.optOut, avatarIsRealPhoto: dto.avatarIsRealPhoto }),
    };
  }

  /**
   * 作答。幂等：同一轮重复提交返回同一结果，不会重复计数
   * （服务端按「这一对是不是第一次」判断，见 `GuessService.answer`）。
   */
  @Post(":roundId")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async answer(
    @CurrentUser() user: AuthUser,
    @Param("roundId", UuidParamPipe) roundId: string,
    @Body(new ValidationPipe()) dto: AnswerDto,
  ) {
    return {
      success: true as const,
      data: await this.guess.answer(user.id, roundId, dto.countryCode.toUpperCase()),
    };
  }
}
