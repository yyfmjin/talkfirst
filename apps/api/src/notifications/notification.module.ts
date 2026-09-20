import { Global, Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * PC-3.1b — makes `NotificationService` the one notification writer.
 *
 * `@Global` is deliberate: producers live in connections, chat, exchange,
 * moments, social, admin and users, and threading an import through every one
 * of those modules would add ceremony without adding safety. There is exactly
 * one provider instance because there is exactly one module.
 *
 * PC-3.1d adds the read side to the same module: `NotificationsService` and the
 * three read routes. `@Global` does not change anything for a controller — it
 * only governs provider visibility — so the routes are mounted wherever
 * `AppModule` imports this module, which it already does.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService, NotificationsService],
  exports: [NotificationService],
})
export class NotificationsModule {}
