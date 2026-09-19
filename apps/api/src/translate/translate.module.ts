import { Module } from "@nestjs/common";
import { TranslateController } from "./translate.controller";
import { TranslateService } from "./translate.service";
import { TranslationProvider } from "./translation.provider";

@Module({
  controllers: [TranslateController],
  providers: [TranslateService, TranslationProvider],
  exports: [TranslateService],
})
export class TranslateModule {}
