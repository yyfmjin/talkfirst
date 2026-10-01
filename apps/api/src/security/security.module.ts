import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AccessLogInterceptor } from "./access-log.interceptor";
import { AccessLogService } from "./access-log.service";
import { SecurityEventService } from "./security-event.service";

/**
 * Security Audit Center (P1).
 *
 * Global so auth, admin and every other module can record a security event
 * without each one importing this module by hand. The access log interceptor is
 * registered here (rather than in `AppModule`) so the whole feature — writers
 * plus the HTTP hook — stays in one place.
 */
@Global()
@Module({
  providers: [
    SecurityEventService,
    AccessLogService,
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
  exports: [SecurityEventService, AccessLogService],
})
export class SecurityModule {}
