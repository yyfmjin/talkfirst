import { Module } from "@nestjs/common";
import { MomentsController } from "./moments.controller";
import { MomentsService } from "./moments.service";
import { SafetyModule } from "../safety/safety.module";
import { TranslateModule } from "../translate/translate.module";

@Module({
  imports: [SafetyModule, TranslateModule],
  controllers: [MomentsController],
  providers: [MomentsService],
  exports: [MomentsService],
})
export class MomentsModule {}
