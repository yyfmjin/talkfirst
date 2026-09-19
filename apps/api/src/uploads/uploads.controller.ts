import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "./uploads.service";

class PresignDto {
  @IsIn(["image/jpeg", "image/png", "image/webp"])
  mime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  filename?: string;
}

class AvatarUploadDto {
  @IsString()
  image!: string;
}

class MessageImageDto {
  @IsString()
  image!: string;
}

@Controller("uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("presign")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  presign(@Body(new ValidationPipe()) dto: PresignDto) {
    const presigned = this.uploads.presign(dto.filename ?? "upload", dto.mime);
    if (!presigned) {
      throw new ForbiddenException({
        success: false,
        error: { code: "STORAGE_NOT_CONFIGURED", message: "Object storage is not configured" },
      });
    }
    return { success: true as const, data: presigned };
  }

  @Post("avatar")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: AvatarUploadDto,
  ) {
    if (dto.image.length > 7_000_000) {
      throw new ForbiddenException({
        success: false,
        error: { code: "IMAGE_TOO_LARGE", message: "Image is too large (max 5MB)" },
      });
    }
    const parsed = dto.image.startsWith("data:")
      ? this.uploads.parseDataUrl(dto.image)
      : null;
    const url = !parsed ? this.uploads.normalizeUploadUrl(dto.image) : null;
    if (!parsed && !url) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be an image URL or base64 data URL" },
      });
    }
    const avatarUrl = parsed
      ? this.uploads.saveLocal("avatars", parsed.buffer, parsed.ext)
      : (url as string);
    const normalized = this.uploads.normalizeUploadUrl(avatarUrl);
    if (!normalized) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be an image URL or base64 data URL" },
      });
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: normalized },
    });
    return { success: true as const, data: { avatarUrl: updated.avatarUrl } };
  }

  @Post("message-image")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async uploadMessageImage(
    @Body(new ValidationPipe()) dto: MessageImageDto,
  ) {
    if (dto.image.length > 7_000_000) {
      throw new ForbiddenException({
        success: false,
        error: { code: "IMAGE_TOO_LARGE", message: "Image is too large (max 5MB)" },
      });
    }
    const parsed = this.uploads.parseDataUrl(dto.image);
    if (!parsed) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be a jpeg/png/webp data URL" },
      });
    }
    const imageUrl = this.uploads.saveLocal("messages", parsed.buffer, parsed.ext);
    return { success: true as const, data: { imageUrl, mime: parsed.mime } };
  }
}
