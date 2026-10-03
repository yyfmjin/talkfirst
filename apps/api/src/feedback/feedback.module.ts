import { Module } from "@nestjs/common";
import { AppSettingsService } from "./app-settings.service";
import { FeedbackController } from "./feedback.controller";
import { FeedbackService } from "./feedback.service";

/**
 * Member feedback and the runtime settings it depends on.
 *
 * `AppSettingsService` is exported because the console's settings screen writes through
 * `AdminService`, which needs the same reader the member screen uses — one implementation
 * means the address an operator saves is byte-for-byte the address a member sees.
 */
@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService, AppSettingsService],
  exports: [FeedbackService, AppSettingsService],
})
export class FeedbackModule {}
