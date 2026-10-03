import { Module } from "@nestjs/common";
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
 * ## Why `AuthModule` is imported
 *
 * The flow needs a `JwtService` to sign its state cookie, and `AuthModule` already owns the
 * configured one. Constructing a second `JwtService` here would be a second place that has to
 * know the access secret, and the two could drift — a state signed with one and verified with
 * another fails in a way that looks like an expired cookie.
 *
 * ## Why `TokenCryptoService` is provided here rather than globally
 *
 * It is the only consumer of `TOKEN_ENCRYPTION_KEY`, and the only module that stores
 * third-party credentials. Keeping it local means the surface that can decrypt a provider
 * token is exactly this module, which is easier to review than a global service every module
 * could inject.
 */
@Module({
  imports: [AuthModule],
  controllers: [SocialSyncController],
  providers: [ProviderManager, TokenCryptoService, SocialAuthService, SocialSyncService, SocialSyncScheduler],
  exports: [SocialSyncService, ProviderManager, TokenCryptoService],
})
export class SocialSyncModule {}
