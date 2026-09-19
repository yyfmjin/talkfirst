import { Module } from "@nestjs/common";
import { SafetyModule } from "../safety/safety.module";
import { SocialSafetyController } from "./social-safety.controller";

@Module({ imports: [SafetyModule], controllers: [SocialSafetyController] })
export class SocialModule {}
