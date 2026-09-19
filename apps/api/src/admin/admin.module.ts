import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { PermissionGuard } from "./permission.guard";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, PermissionGuard],
  // Exported so `UserStatusScheduler` can record SYSTEM audit entries through
  // `AdminService.recordSystemAudit` — the single entry point for machine
  // actions — instead of writing `adminAuditLog` rows on its own.
  exports: [AdminService],
})
export class AdminModule {}
