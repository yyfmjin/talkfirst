import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { SafetyModule } from "../safety/safety.module";
import { ProfileAttributesService } from "./profile-attributes.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UserStatusScheduler } from "./user-status.scheduler";

@Module({
  // AdminModule is a one-way dependency (AdminModule imports nothing), so this
  // introduces no cycle. It exists so the expiry sweep can reach
  // `AdminService.recordSystemAudit`.
  //
  // PC-1.3: SafetyModule provides the existing text scan used before any
  // user-authored attribute is persisted.
  imports: [AdminModule, SafetyModule],
  controllers: [UsersController],
  providers: [UsersService, UserStatusScheduler, ProfileAttributesService],
  exports: [UsersService, ProfileAttributesService],
})
export class UsersModule {}
