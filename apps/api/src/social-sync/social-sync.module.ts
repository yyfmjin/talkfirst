import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { SocialSyncController } from "./social-sync.controller";
import { SocialAuthService } from "./social-auth.service";
import { SocialSyncService } from "./social-sync.service";
import { SocialSyncScheduler } from "./social-sync.scheduler";
import { TokenCryptoService } from "./token-crypto.service";
import { ProviderManager } from "./providers/provider-manager";

/**
 * External social account sync.
 *
 * ## Why `JwtModule` is imported directly
 *
 * The flow needs a `JwtService` to sign its state cookie. This module used to import
 * `AuthModule` alone, on the stated assumption that "`AuthModule` already owns the configured
 * one" — but **importing a module does not expose its providers unless it exports them**, and
 * `AuthModule` exports neither `JwtService` nor `JwtModule`. The result was not a subtle bug:
 *
 *   Nest can't resolve dependencies of the SocialAuthService (…, ?). Please make sure that
 *   the argument JwtService at index [3] is available in the SocialSyncModule module.
 *
 * …and since this module is loaded by `AppModule`, the whole API refused to boot (found
 * 2026-10-04, while starting the Playwright servers).
 *
 * `imports: [JwtModule.register({})]` is what `auth/oauth/oauth.module.ts` already does, so this
 * follows the existing precedent rather than inventing a third arrangement. Nothing is lost by
 * there being more than one registration: every call site signs and verifies with an explicit
 * secret (`signAsync(payload, { secret })`), so the module registration is only a container and
 * there is no "configured one" to drift from.
 *
 * ## Why `AuthModule` is still imported
 *
 * It is no longer needed for `JwtService`, and it is deliberately left in place: removing it is a
 * separate judgement (other providers may be reached dynamically), and an unused module import
 * costs nothing at runtime.
 *
 * ## Why `TokenCryptoService` is provided here rather than globally
 *
 * It is the only consumer of `TOKEN_ENCRYPTION_KEY`, and the only module that stores
 * third-party credentials. Keeping it local means the surface that can decrypt a provider
 * token is exactly this module, which is easier to review than a global service every module
 * could inject.
 */
@Module({
  imports: [JwtModule.register({}), AuthModule],
  controllers: [SocialSyncController],
  providers: [ProviderManager, TokenCryptoService, SocialAuthService, SocialSyncService, SocialSyncScheduler],
  exports: [SocialSyncService, ProviderManager, TokenCryptoService],
})
export class SocialSyncModule {}
