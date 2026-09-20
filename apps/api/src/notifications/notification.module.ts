import { Global, Module } from "@nestjs/common";
import { NotificationService } from "./notification.service";

/**
 * PC-3.1b — makes `NotificationService` the one notification writer.
 *
 * `@Global` is deliberate: producers live in connections, chat, exchange,
 * moments, social, admin and users, and threading an import through every one
 * of those modules would add ceremony without adding safety. There is exactly
 * one provider instance because there is exactly one module.
 */
@Global()
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
