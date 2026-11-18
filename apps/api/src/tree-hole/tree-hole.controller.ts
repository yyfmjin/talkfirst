import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, MaxLength } from "class-validator";
import type { AuthUser } from "../auth/current-user.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { TreeHoleService } from "./tree-hole.service";

/**
 * 树洞（2026-11-12）—— 匿名吐槽板。
 *
 * 需要登录才能读写：不是为了身份，而是为了**限流与投诉处理**有一个抓手。
 * 返回值里永远没有 `userId`，对外只有 `alias`（见 service 的说明）。
 *
 * 节流比普通接口紧：匿名板最容易变成刷屏与意气的场地，发帖 3 次/分、
 * 评论 10 次/分。
 */

class CreateTreeHolePostDto {
  @IsString()
  @MaxLength(500)
  content!: string;
}

class CreateTreeHoleCommentDto {
  @IsString()
  @MaxLength(300)
  content!: string;
}

@Controller("tree-hole")
@UseGuards(JwtAuthGuard)
export class TreeHoleController {
  constructor(private readonly service: TreeHoleService) {}

  /** 最新在前，游标分页。 */
  @Get("posts")
  list(@Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.service
      .list(cursor, limit ? Number(limit) : undefined)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("posts")
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  create(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: CreateTreeHolePostDto) {
    return this.service
      .create(user.id, dto.content)
      .then((data) => ({ success: true as const, data }));
  }

  @Get("posts/:id/comments")
  comments(@Param("id", UuidParamPipe) id: string) {
    return this.service
      .comments(id)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("posts/:id/comments")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  addComment(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: CreateTreeHoleCommentDto,
  ) {
    return this.service
      .addComment(user.id, id, dto.content)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * 举报一条树洞内容（帖子或评论），2026-11-13。
   *
   * 不强制 `reason` 取值域在 DTO 里（那个 DTO 只引了 IsString/MaxLength）：
   * 真正需要约束的是「同一个人对同一条内容只算一次」，那件事在 service 里；
   * 理由本身只是给审核看的标签，前端只发固定几类。
   */
  @Post("reports")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  reportPost(
    @CurrentUser() user: AuthUser,
    @Body() body: { postId?: string; commentId?: string; reason?: string },
  ) {
    return this.service
      .report(user.id, {
        postId: body?.postId,
        commentId: body?.commentId,
        reason: (body?.reason ?? "OTHER").slice(0, 24),
      })
      .then((data) => ({ success: true as const, data }));
  }
}
