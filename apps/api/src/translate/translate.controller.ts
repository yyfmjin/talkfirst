import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { ValidationPipe } from "../common/validation.pipe";
import { IsOptional, IsString } from "class-validator";
import { TranslateService } from "./translate.service";

class TranslateDto {
  @IsOptional()
  @IsString()
  targetLang?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class TranslateController {
  constructor(private readonly translate: TranslateService) {}

  @Get("translate/languages")
  languages() {
    return { success: true as const, data: this.translate.supported() };
  }

  @Post("messages/:id/translate")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async translateMessage(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: TranslateDto,
  ) {
    const result = await this.translate.translate(id, dto.targetLang, user.id);
    if (!result) {
      throw new NotFoundException({
        success: false,
        error: { code: "MESSAGE_NOT_FOUND", message: "Message not found" },
      });
    }
    return { success: true as const, data: result };
  }
}
