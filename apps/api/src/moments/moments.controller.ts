import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { MomentsService } from "./moments.service";

class BindDto {
  @IsIn(["TALKFIRST", "INSTAGRAM", "X", "TIKTOK", "YOUTUBE", "FACEBOOK"])
  platform!: string;

  @IsString()
  @MaxLength(128)
  handle!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  displayName?: string;
}

class ToggleDto {
  @IsBoolean()
  syncEnabled!: boolean;
}

class SettingDto {
  @IsOptional()
  @IsBoolean()
  syncEnabled?: boolean;

  @IsOptional()
  @IsString()
  visibleTo?: string;

  @IsOptional()
  @IsBoolean()
  filterSensitive?: boolean;

  @IsOptional()
  @IsBoolean()
  showPhotos?: boolean;

  @IsOptional()
  @IsBoolean()
  showVideos?: boolean;

  @IsOptional()
  @IsBoolean()
  showTexts?: boolean;

  @IsOptional()
  @IsBoolean()
  showReels?: boolean;

  @IsOptional()
  @IsBoolean()
  showLives?: boolean;
}

class CommentDto {
  @IsString()
  @MaxLength(500)
  content!: string;
}

class ComposeDto {
  @IsString()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  images?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  videoUrl?: string;

  @IsOptional()
  tags?: string[];
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return undefined;
}

function asError(code: string, message: string) {
  return { success: false, error: { code, message } };
}

@Controller("moments")
@UseGuards(JwtAuthGuard)
export class MomentsController {
  constructor(private readonly moments: MomentsService) {}

  @Get("platforms")
  platforms() {
    return { success: true as const, data: this.moments.platforms() };
  }

  @Get("feed")
  feed(
    @CurrentUser() user: AuthUser,
    @Query("tab") tab?: string,
    @Query("platform") platform?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    try {
      return this.moments.feed(user.id, { tab, platform, limit: Number(limit ?? 20), cursor }).then((data) => ({
        success: true as const,
        data,
      }));
    } catch {
      throw new ForbiddenException(asError("UNKNOWN_PLATFORM", "Unknown platform"));
    }
  }

  @Get("user/:id")
  async userMoments(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("platform") platform?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    try {
      const data = await this.moments.userMoments(user.id, id, {
        platform,
        limit: Number(limit ?? 20),
        cursor,
      });
      if (!data) {
        throw new NotFoundException(asError("USER_NOT_FOUND", "User not found"));
      }
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      throw new ForbiddenException(asError("UNKNOWN_PLATFORM", "Unknown platform"));
    }
  }

  @Get("bindings")
  bindings(@CurrentUser() user: AuthUser) {
    return this.moments.myBindings(user.id).then((data) => ({ success: true as const, data }));
  }

  @Post("bindings")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async bind(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: BindDto) {
    try {
      const data = await this.moments.bindPlatform(user.id, dto.platform, dto.handle, dto.displayName);
      return { success: true as const, data };
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new ForbiddenException(
        asError(code ?? "BIND_FAILED", code === "INVALID_HANDLE" ? "Invalid handle" : "Bind failed"),
      );
    }
  }

  @Delete("bindings/:platform")
  async unbind(@CurrentUser() user: AuthUser, @Param("platform") platform: string) {
    try {
      const data = await this.moments.togglePlatform(user.id, platform.toUpperCase(), false).then(async () => {
        await this.moments.unbindPlatform(user.id, platform.toUpperCase());
        return { unbound: true };
      });
      return { success: true as const, data };
    } catch {
      throw new ForbiddenException(asError("UNKNOWN_PLATFORM", "Unknown platform"));
    }
  }

  @Patch("bindings/:platform")
  async toggle(@CurrentUser() user: AuthUser, @Param("platform") platform: string, @Body(new ValidationPipe()) dto: ToggleDto) {
    try {
      const data = await this.moments.togglePlatform(user.id, platform.toUpperCase(), dto.syncEnabled);
      return { success: true as const, data };
    } catch {
      throw new ForbiddenException(asError("UNKNOWN_PLATFORM", "Unknown platform"));
    }
  }

  @Get("settings")
  setting(@CurrentUser() user: AuthUser) {
    return this.moments.mySetting(user.id).then((data) => ({ success: true as const, data }));
  }

  @Patch("settings")
  async updateSetting(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: SettingDto) {
    try {
      const data = await this.moments.updateSetting(user.id, dto);
      return { success: true as const, data };
    } catch {
      throw new ForbiddenException(asError("INVALID_VISIBILITY", "Invalid visibility"));
    }
  }

  @Post(":id/like")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async like(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    try {
      const data = await this.moments.toggleLike(user.id, id);
      if (!data) {
        throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      }
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      if ((error as { code?: string }).code === "MOMENT_LOCKED") {
        throw new ForbiddenException(asError("MOMENT_LOCKED", "This moment is not visible to you"));
      }
      throw error;
    }
  }

  @Get(":id/comments")
  async comments(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("limit") limit?: string) {
    try {
      const data = await this.moments.listComments(user.id, id, Number(limit ?? 20));
      if (!data) {
        throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      }
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      if ((error as { code?: string }).code === "MOMENT_LOCKED") {
        throw new ForbiddenException(asError("MOMENT_LOCKED", "This moment is not visible to you"));
      }
      throw error;
    }
  }

  @Post(":id/comments")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async addComment(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ValidationPipe()) dto: CommentDto,
  ) {
    try {
      const data = await this.moments.addComment(user.id, id, dto.content);
      if (!data) {
        throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      }
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      if ((error as { code?: string }).code === "MOMENT_LOCKED") {
        throw new ForbiddenException(asError("MOMENT_LOCKED", "This moment is not visible to you"));
      }
      const code = (error as { code?: string }).code;
      throw new ForbiddenException(
        asError(code ?? "COMMENT_FAILED", code === "EMPTY_COMMENT" ? "Comment is empty" : "Comment blocked"),
      );
    }
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async compose(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const dto = (raw ?? {}) as ComposeDto;
    if (typeof dto.content !== "string") {
      throw new ForbiddenException(asError("EMPTY_CONTENT", "Content is empty"));
    }
    try {
      const data = await this.moments.publish(user.id, {
        content: dto.content,
        images: normalizeStringArray(dto.images),
        videoUrl: typeof dto.videoUrl === "string" ? dto.videoUrl : undefined,
        tags: normalizeStringArray(dto.tags),
      });
      return { success: true as const, data };
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new ForbiddenException(
        asError(
          code ?? "PUBLISH_FAILED",
          code === "EMPTY_CONTENT" ? "Content is empty" : code === "CONTENT_BLOCKED" ? "Content blocked" : "Publish failed",
        ),
      );
    }
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const data = await this.moments.remove(user.id, id);
    if (!data) {
      throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
    }
    return { success: true as const, data };
  }
}
