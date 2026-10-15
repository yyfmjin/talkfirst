import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { AiCompanionService } from "./ai-companion.service";
import { STYLE_PRESET_KEYS } from "./ai.service";

class UpsertCompanionDto {
  /** AI 朋友的名字（如「小星」）。 */
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string;

  /** AI 对用户的称呼（如「阿杰」）。 */
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  userNickname!: string;

  @IsOptional()
  @IsIn(STYLE_PRESET_KEYS)
  stylePreset?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  personality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  greeting?: string;
}

class SendMessageDto {
  @IsString()
  @MaxLength(2000)
  content!: string;
}

/**
 * AI 朋友 —— 一个人专属、可定制人设的 AI 聊天伙伴。
 * 会话复用 `Conversation`（type = AI），消息用 `senderKind` 区分人与 AI。
 */
@Controller("ai-companion")
@UseGuards(JwtAuthGuard)
export class AiCompanionController {
  constructor(private readonly service: AiCompanionService) {}

  /** 当前用户的 AI 朋友 + 会话 + 最近消息（无 → null）。 */
  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const state = await this.service.getForUser(user.id);
    return { success: true as const, data: state };
  }

  /** 创建或更新 AI 朋友。 */
  @Put()
  async upsert(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: UpsertCompanionDto) {
    const state = await this.service.upsert(user.id, dto);
    return { success: true as const, data: state };
  }

  /** 删除 AI 朋友（会话与消息级联删除）。 */
  @Delete()
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser) {
    return this.service.remove(user.id);
  }

  /** 发一条消息，返回 { message, reply }（LLM 失败时 reply 为 null）。 */
  @Post("messages")
  async sendMessage(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: SendMessageDto) {
    return this.service.sendMessage(user.id, dto.content);
  }

  /** 打开聊天页时把会话读到位（消未读）。 */
  @Post("messages/read")
  @HttpCode(200)
  async markRead(@CurrentUser() user: AuthUser) {
    return this.service.markRead(user.id);
  }

  /** 上一条 AI 回复没接上时，对最后一条用户消息重试。 */
  @Post("reply")
  async retryReply(@CurrentUser() user: AuthUser) {
    return this.service.retryReply(user.id);
  }
}
