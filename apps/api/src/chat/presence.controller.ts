import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { PresenceService } from "./presence.service";

@Controller("presence")
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get("online")
  online(@CurrentUser() user: AuthUser) {
    return {
      success: true as const,
      data: {
        userId: user.id,
        online: this.presence.isOnline(user.id),
        lastSeen: this.presence.lastSeen(user.id)?.toISOString() ?? null,
      },
    };
  }
}
