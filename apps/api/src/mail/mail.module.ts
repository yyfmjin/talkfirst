import { Module } from "@nestjs/common";
import { MailService, createMailProvider } from "./mail.service";

/**
 * SEC-005 — mail wiring.
 *
 * Registered by factory in the same spirit as `LoginAttemptService` in
 * `auth.module.ts`: the concrete transport is an environment decision rather
 * than a DI token, so the container must not try to resolve it by type.
 */
@Module({
  providers: [{ provide: MailService, useFactory: () => new MailService(createMailProvider()) }],
  exports: [MailService],
})
export class MailModule {}
