import {
  BadRequestException,
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
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UuidParamPipe } from "../common/uuid-param.pipe";
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

  // PC-2.3.2 — present means this is a reply to a top-level comment. Optional,
  // and a uuid so a malformed id is rejected before it reaches the query.
  @IsOptional()
  @IsUUID()
  parentCommentId?: string;
}

/**
 * The composer's wire format.
 *
 * FIX (audit P032) — this DTO already existed but was never wired to the route,
 * which took `@Body() raw: unknown` and hand-checked a single field. That meant
 * the one write path users are most exposed to was the only one on the whole API
 * with no `whitelist` / `forbidNonWhitelisted`, and `normalizeStringArray` had to
 * re-implement array filtering that `class-validator` already does.
 *
 * `content` is `@IsString()` but NOT `@MinLength(1)`: a media-only post is a
 * documented product case (see `MomentsService.publish`, which rejects the
 * request only when content, images AND videoUrl are all empty). Keeping the
 * "is this post empty" rule in the service means the two cannot disagree.
 */
class ComposeDto {
  @IsString()
  @MaxLength(2000)
  content!: string;

  // `ArrayMaxSize(9)` mirrors the service's own `.slice(0, 9)`, so an
  // over-long list is a clear 400 instead of being silently truncated.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(9)
  images?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  videoUrl?: string;

  // Mirrors the service's `.slice(0, 10)`.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  tags?: string[];
}

class UpdateCommentDto {
  @IsString()
  @MaxLength(500)
  content!: string;
}

class UpdateMomentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(9)
  images?: string[];

  /**
   * An empty string is the documented way to REMOVE the clip: an absent key
   * means "leave it alone" (`MomentsService.updateMoment` branches on
   * `undefined`), so clearing needs a value, and `""` is one `@IsString()`
   * accepts. A non-empty value must be an http(s) URL, which the service
   * validates — this DTO deliberately does not add a second URL rule that could
   * disagree with it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  tags?: string[];
}

function asError(code: string, message: string) {
  return { success: false, error: { code, message } };
}

/**
 * PC-2.3.2 — the comment write path answers one status (403) for every domain
 * rejection, matching the EMPTY_COMMENT precedent. Only the machine-readable
 * code and the human-readable message vary, so no new top-level error code is
 * introduced for replies.
 */
const COMMENT_ERROR_MESSAGES: Record<string, string> = {
  EMPTY_COMMENT: "Comment is empty",
  COMMENT_PARENT_INVALID: "Parent comment cannot be replied to",
};

@Controller("moments")
@UseGuards(JwtAuthGuard)
export class MomentsController {
  constructor(private readonly moments: MomentsService) {}

  @Get("platforms")
  platforms() {
    return { success: true as const, data: this.moments.platforms() };
  }

  @Get("feed")
  async feed(
    @CurrentUser() user: AuthUser,
    @Query("tab") tab?: string,
    @Query("platform") platform?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    /**
     * FIX (audit P030), plus a latent bug found while fixing it.
     *
     * The original body was
     *     try { return this.moments.feed(...).then(...) } catch { throw ... }
     * which cannot catch anything: `feed()` is async, so it returns a *promise*
     * and the `try` block has already completed by the time it rejects. Every
     * domain error was therefore swallowed into a generic
     * `UNKNOWN_PLATFORM` 403 — including the malformed-cursor case, which is a
     * client error, not a platform problem. Awaiting the call makes the `catch`
     * reachable and lets each error keep its own status.
     */
    try {
      const data = await this.moments.feed(user.id, {
        tab,
        platform,
        limit: Number(limit ?? 20),
        cursor,
      });
      return { success: true as const, data };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "INVALID_CURSOR") {
        throw new BadRequestException(asError("VALIDATION_ERROR", "cursor is not a cursor issued by this API"));
      }
      if (code === "UNKNOWN_PLATFORM") {
        throw new BadRequestException(asError("UNKNOWN_PLATFORM", "Unknown platform"));
      }
      throw error;
    }
  }

  @Get("user/:id")
  async userMoments(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
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
      const code = (error as { code?: string }).code;
      if (code === "INVALID_CURSOR") {
        throw new BadRequestException(asError("VALIDATION_ERROR", "cursor is not a cursor issued by this API"));
      }
      if (code === "UNKNOWN_PLATFORM") {
        throw new BadRequestException(asError("UNKNOWN_PLATFORM", "Unknown platform"));
      }
      throw error;
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
  async like(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
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
  async comments(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    // PC-2.4 — `limit` was this route's page size before it was paginated. It is
    // still honoured when `pageSize` is absent, so an existing caller keeps the
    // behaviour it had instead of silently falling back to the default.
    @Query("limit") limit?: string,
  ) {
    try {
      const data = await this.moments.listComments(user.id, id, Number(page ?? 1), Number(pageSize ?? limit ?? 20));
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
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: CommentDto,
  ) {
    try {
      const data = await this.moments.addComment(user.id, id, dto.content, dto.parentCommentId ?? null);
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
        asError(code ?? "COMMENT_FAILED", COMMENT_ERROR_MESSAGES[code ?? ""] ?? "Comment blocked"),
      );
    }
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async compose(
    @CurrentUser() user: AuthUser,
    // FIX (audit P032): the same `ValidationPipe` every other write path uses.
    // This route alone took `@Body() raw: unknown` and hand-checked one field, so
    // an unknown property (or a non-array `images`) bypassed the whitelist that
    // the rest of the API enforces.
    @Body(new ValidationPipe()) dto: ComposeDto,
  ) {
    try {
      const data = await this.moments.publish(user.id, {
        content: dto.content,
        images: dto.images,
        videoUrl: dto.videoUrl,
        tags: dto.tags,
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

  @Get(":id")
  async moment(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    try {
      const data = await this.moments.getMoment(user.id, id);
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
  @Patch(":id/comments/:commentId")
  async updateComment(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Param("commentId", UuidParamPipe) commentId: string,
    @Body(new ValidationPipe()) dto: UpdateCommentDto,
  ) {
    try {
      const data = await this.moments.updateComment(user.id, id, commentId, dto.content);
      if (!data) throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      const code = (error as { code?: string }).code;
      if (code === "MOMENT_LOCKED") {
        throw new ForbiddenException(asError("MOMENT_LOCKED", "This moment is not visible to you"));
      }
      if (code === "COMMENT_NOT_FOUND") {
        throw new NotFoundException(asError("COMMENT_NOT_FOUND", "Comment not found"));
      }
      if (code === "COMMENT_FORBIDDEN") {
        throw new ForbiddenException(asError("COMMENT_FORBIDDEN", "You can only edit your own comment"));
      }
      if (code === "EMPTY_COMMENT") {
        throw new ForbiddenException(asError("EMPTY_COMMENT", "Comment is empty"));
      }
      if (code === "CONTENT_BLOCKED") {
        throw new ForbiddenException(asError("CONTENT_BLOCKED", "Comment contains blocked words"));
      }
      throw error;
    }
  }

  /**
   * PC-2.4 — the owner deletes their own comment. Declared before `@Delete(":id")`
   * so the two-segment route is never shadowed, and mapped onto the codes the
   * service raises: a missing comment is a 404, someone else's is a 403, and an
   * unreachable moment keeps answering MOMENT_LOCKED like the rest of the
   * thread does.
   */
  @Delete(":id/comments/:commentId")
  async removeComment(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Param("commentId", UuidParamPipe) commentId: string,
  ) {
    try {
      const data = await this.moments.deleteComment(user.id, id, commentId);
      if (!data) throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      const code = (error as { code?: string }).code;
      if (code === "MOMENT_LOCKED") {
        throw new ForbiddenException(asError("MOMENT_LOCKED", "This moment is not visible to you"));
      }
      if (code === "COMMENT_NOT_FOUND") {
        throw new NotFoundException(asError("COMMENT_NOT_FOUND", "Comment not found"));
      }
      if (code === "COMMENT_FORBIDDEN") {
        throw new ForbiddenException(asError("COMMENT_FORBIDDEN", "You can only delete your own comment"));
      }
      throw error;
    }
  }

  @Patch(":id")
  async updateMoment(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: UpdateMomentDto,
  ) {
    try {
      const data = await this.moments.updateMoment(user.id, id, dto);
      if (!data) {
        throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      }
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      const code = (error as { code?: string }).code;
      if (code === "MOMENT_FORBIDDEN") {
        throw new ForbiddenException(asError("MOMENT_FORBIDDEN", "You can only edit your own moment"));
      }
      if (code === "EMPTY_CONTENT") {
        throw new ForbiddenException(asError("EMPTY_CONTENT", "Moment cannot be empty"));
      }
      if (code === "CONTENT_BLOCKED") {
        throw new ForbiddenException(asError("CONTENT_BLOCKED", "Moment contains blocked words"));
      }
      throw error;
    }
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    try {
      const data = await this.moments.remove(user.id, id);
      if (!data) {
        throw new NotFoundException(asError("MOMENT_NOT_FOUND", "Moment not found"));
      }
      return { success: true as const, data };
    } catch (error) {
      if ((error as { status?: number }).status === 404) throw error;
      const code = (error as { code?: string }).code;
      if (code === "MOMENT_FORBIDDEN") {
        throw new ForbiddenException(asError("MOMENT_FORBIDDEN", "You can only delete your own moment"));
      }
      throw error;
    }
  }
}
