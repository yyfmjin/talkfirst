import { Global, Module } from "@nestjs/common";
import { AccessLogService } from "./access-log.service";
import { AuditRetentionService } from "./audit-retention.service";
import { DeviceIdentityService } from "./device-identity.service";
import { SecurityEventService } from "./security-event.service";

/**
 * Security Audit Center (P1).
 *
 * Global so auth, admin and every other module can record a security event
 * without each one importing this module by hand.
 *
 * ## Phase O1 changes
 *
 * `AccessLogInterceptor` used to be registered here as `APP_INTERCEPTOR`. It was
 * removed: interceptors run *after* guards, so every guard-rejected request
 * (401/403 on the whole protected surface) and every unmatched 404 produced **no
 * audit row at all**. Access logging now lives in `AccessLogMiddleware`, which
 * `main.ts` installs on the Express instance because only middleware —
 * combined with `res.on("finish")` — observes every response regardless of
 * which layer produced it.
 *
 * Also added here:
 *  - `DeviceIdentityService` — writer for `DeviceIdentity` / `DeviceUser`, the
 *    two tables the P1 schema shipped but never populated;
 *  - `AuditRetentionService` — the missing retention story for `AccessLog` /
 *    `SecurityEvent`, which previously grew without bound.
 */
@Global()
@Module({
  providers: [
    SecurityEventService,
    AccessLogService,
    DeviceIdentityService,
    AuditRetentionService,
  ],
  exports: [
    SecurityEventService,
    AccessLogService,
    DeviceIdentityService,
    AuditRetentionService,
  ],
})
export class SecurityModule {}
