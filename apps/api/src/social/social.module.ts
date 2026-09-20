import { Module } from "@nestjs/common";
import { SafetyModule } from "../safety/safety.module";
import { MomentsModule } from "../moments/moments.module";
import { SocialSafetyController } from "./social-safety.controller";

// `MomentsModule` is imported for `MomentsService.resolveMomentAccess`, so a
// moment report reuses the one visibility rule rather than re-deriving it.
@Module({
  imports: [SafetyModule, MomentsModule],
  controllers: [SocialSafetyController],
})
export class SocialModule {}
