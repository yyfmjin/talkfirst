import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { PermissionGuard } from "./permission.guard";
import { AdminService } from "./admin.service";
import { FeedbackModule } from "../feedback/feedback.module";

@Module({
  // Imported so the console's feedback queue and settings screen go through the SAME
  // services the member-facing endpoints use. A second reader for the support address
  // would be a second chance for the two to disagree about what is configured.
  imports: [FeedbackModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, PermissionGuard],
  // Exported so `UserStatusScheduler` can record SYSTEM audit entries through
  // `AdminService.recordSystemAudit` — the single entry point for machine
  // actions — instead of writing `adminAuditLog` rows on its own.
  exports: [AdminService],
})
export class AdminModule {}
