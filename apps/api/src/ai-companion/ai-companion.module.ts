import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SafetyModule } from "../safety/safety.module";
import { AiCompanionController } from "./ai-companion.controller";
import { AiCompanionService } from "./ai-companion.service";
import { AiService } from "./ai.service";

@Module({
  imports: [PrismaModule, SafetyModule],
  controllers: [AiCompanionController],
  providers: [AiCompanionService, AiService],
  exports: [AiService, AiCompanionService],
})
export class AiCompanionModule {}
