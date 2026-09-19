import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SafetyModule } from "../safety/safety.module";
import { ChatAuthService } from "./chat-auth.service";
import { ChatGateway } from "./chat.gateway";
import { PresenceController } from "./presence.controller";
import { PresenceService } from "./presence.service";

@Module({
  imports: [JwtModule.register({}), SafetyModule],
  controllers: [PresenceController],
  providers: [ChatAuthService, ChatGateway, PresenceService],
  exports: [PresenceService],
})
export class ChatModule {}
