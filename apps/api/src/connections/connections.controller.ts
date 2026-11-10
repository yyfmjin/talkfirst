import {
  Put,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { ValidationPipe } from "../common/validation.pipe";
import { ConnectionsService } from "./connections.service";
import { RespondRequestDto, SendRequestDto } from "./connections.dto";

@Controller("connections")
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get("templates")
  templates() {
    return { success: true as const, data: this.connectionsService.listTemplates() };
  }

  @Get("requests/incoming")
  @UseGuards(JwtAuthGuard)
  incoming(@CurrentUser() user: AuthUser) {
    return this.connectionsService
      .listIncoming(user.id)
      .then((data) => ({ success: true as const, data }));
  }

  @Get("requests/sent")
  @UseGuards(JwtAuthGuard)
  sent(@CurrentUser() user: AuthUser) {
    return this.connectionsService
      .listSent(user.id)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("requests")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  send(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: SendRequestDto) {
    return this.connectionsService
      .sendRequest(user.id, dto.receiverId, dto.message, dto.templateId)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("requests/:id/respond")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  respond(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: RespondRequestDto,
  ) {
    return this.connectionsService
      .respond(user.id, id, dto.action)
      .then((data) => ({ success: true as const, data }));
  }

  @Delete("requests/:id")
  @UseGuards(JwtAuthGuard)
  cancel(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    return this.connectionsService
      .cancelRequest(user.id, id)
      .then((data) => ({ success: true as const, data }));
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.connectionsService
      .listConnections(user.id)
      .then((data) => ({ success: true as const, data }));
  }

  /* ───────── 好友分组（2026-11-10） ───────── */

  @Get("groups")
  @UseGuards(JwtAuthGuard)
  groups(@CurrentUser() user: AuthUser) {
    return this.connectionsService
      .listFriendGroups(user.id)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("groups")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  createGroup(@CurrentUser() user: AuthUser, @Body() body: { name?: string }) {
    return this.connectionsService
      .createFriendGroup(user.id, String(body?.name ?? ""))
      .then((data) => ({ success: true as const, data }));
  }

  @Delete("groups/:id")
  @UseGuards(JwtAuthGuard)
  deleteGroup(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    return this.connectionsService
      .deleteFriendGroup(user.id, id)
      .then((data) => ({ success: true as const, data }));
  }

  /** 给一个好友打分类：内置关系类型 + 自定义分组（可空）。 */
  @Put(":id/tag")
  @UseGuards(JwtAuthGuard)
  tag(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body() body: { kind?: string; groupId?: string | null },
  ) {
    const allowed = ["FRIEND", "LOVER", "PARTNER", "FAMILY"];
    const kind = allowed.includes(String(body?.kind)) ? String(body.kind) : "FRIEND";
    return this.connectionsService
      .tagConnection(user.id, id, kind, body?.groupId ?? null)
      .then((data) => ({ success: true as const, data }));
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    return this.connectionsService
      .removeConnection(user.id, id)
      .then((data) => ({ success: true as const, data }));
  }
}
