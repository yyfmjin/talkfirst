import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { HttpThrottlerGuard, globalThrottleLimit } from "./common/http-throttler.guard";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { SecurityModule } from "./security/security.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { MetaModule } from "./meta/meta.module";
import { DiscoverModule } from "./discover/discover.module";
import { ConnectionsModule } from "./connections/connections.module";
import { SocialModule } from "./social/social.module";
import { ChatModule } from "./chat/chat.module";
import { ExchangeModule } from "./exchange/exchange.module";
import { SafetyModule } from "./safety/safety.module";
import { TranslateModule } from "./translate/translate.module";
import { AdminModule } from "./admin/admin.module";
import { UploadsModule } from "./uploads/uploads.module";
import { MomentsModule } from "./moments/moments.module";
import { FeedbackModule } from "./feedback/feedback.module";
import { SocialSyncModule } from "./social-sync/social-sync.module";
import { NotificationsModule } from "./notifications/notification.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    // Phase A+: drives the suspension-expiry sweep in UserStatusScheduler.
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60000, limit: globalThrottleLimit() },
    ]),
    PrismaModule,
    // Security Audit Center (P1): provides SecurityEventService/AccessLogService
    // to every module and registers the global HTTP access-log interceptor.
    SecurityModule,
    AuthModule,
    UsersModule,
    MetaModule,
    DiscoverModule,
    ConnectionsModule,
    SocialModule,
    ChatModule,
    ExchangeModule,
    SafetyModule,
    TranslateModule,
    NotificationsModule,
    AdminModule,
    UploadsModule,
    MomentsModule,
    FeedbackModule,
    SocialSyncModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
