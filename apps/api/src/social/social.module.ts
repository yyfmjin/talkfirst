import { Module } from "@nestjs/common";
import { SafetyModule } from "../safety/safety.module";
import { MomentsModule } from "../moments/moments.module";
/*
 * AI 会话的发消息要交给 AI 管线（见 `sendMessage` 里那条早退）：
 * AI 会话只有一个成员、也没有 connection，普通会话接口原先直接 404。
 */
import { AiCompanionModule } from "../ai-companion/ai-companion.module";
import { SocialSafetyController } from "./social-safety.controller";

// `MomentsModule` is imported for `MomentsService.resolveMomentAccess`, so a
// moment report reuses the one visibility rule rather than re-deriving it.
@Module({
  imports: [SafetyModule, MomentsModule, AiCompanionModule],
  controllers: [SocialSafetyController],
})
export class SocialModule {}
