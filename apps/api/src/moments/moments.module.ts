import { Module } from "@nestjs/common";
import { MomentsController } from "./moments.controller";
import { MomentsService } from "./moments.service";
import { SafetyModule } from "../safety/safety.module";

@Module({
  imports: [SafetyModule],
  controllers: [MomentsController],
  providers: [MomentsService],
  exports: [MomentsService],
})
export class MomentsModule {}
