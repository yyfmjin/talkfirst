import { Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

import { UuidParamPipe } from "../admin/uuid-param.pipe";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { NotificationCursorPipe } from "./notification-cursor.pipe";
import type { NotificationCursor } from "./notification-cursor";
import { NOTIFICATION_TYPES, type NotificationType } from "./notification.types";
import { NotificationsService } from "./notifications.service";

/**
 * The query surface of `GET /notifications`.
 *
 * `type` is validated against the frozen `NOTIFICATION_TYPES` union rather than
 * accepting any string, so an unknown filter is a `400` instead of an empty
 * list that looks like "you have nothing".
 *
 * `cursor` is declared here as a plain string only so that `ValidationPipe`'s
 * `forbidNonWhitelisted` lets it through; its actual meaning belongs to
 * `NotificationCursorPipe`, which decodes the value. The DTO owns "which names
 * may appear", the pipe owns "what this one means".
 */
class NotificationListQueryDto {
  @IsIn([...NOTIFICATION_TYPES])
  @IsOptional()
  type?: NotificationType;

  /**
   * `@Type(() => Number)` so the query string is compared as a number. A
   * non-numeric value becomes `NaN` and fails `@IsInt`; `0` and negatives fail
   * `@Min`. Anything above the maximum is *not* an error — the service caps it
   * at 50, which is a valid request the server answers with fewer rows.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

/**
 * PC-3.1d — the notification read API.
 *
 * These three routes previously lived on `SocialSafetyController`, which is
 * where the notification *writer* call sites happen to sit. Reading one's own
 * notifications is not a social-safety concern, so the endpoints moved here;
 * the URLs are unchanged, and nothing about the producers was touched.
 *
 * The controller only reads parameters and hands them to `NotificationsService`
 * — no `where`, no `take`, no projection lives at this layer.
 */
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ValidationPipe()) query: NotificationListQueryDto,
    @Query("cursor", NotificationCursorPipe) cursor?: NotificationCursor,
  ) {
    const data = await this.notifications.list(user.id, {
      type: query.type,
      pageSize: query.pageSize,
      cursor,
    });
    return { success: true as const, data };
  }

  @Patch(":id/read")
  async markRead(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    const data = await this.notifications.markRead(user.id, id);
    return { success: true as const, data };
  }

  @Post("read")
  async markAllRead(@CurrentUser() user: AuthUser) {
    const data = await this.notifications.markAllRead(user.id);
    return { success: true as const, data };
  }
}
