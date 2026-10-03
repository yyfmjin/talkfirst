import { Module } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { SessionService } from "../session.service";
import { DeviceIdentityService } from "../../security/device-identity.service";
import { OAuthAccountService } from "./oauth-account.service";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";
import { createIdTokenVerifier } from "./oidc-id-token-verifier";
import { LocalDevProvider } from "./local-dev-provider";
import { PrismaService } from "../../prisma/prisma.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [OAuthController],
  providers: [
    OAuthAccountService,
    /**
     * The development stand-in provider.
     *
     * Instantiated unconditionally — its only cost is one RSA key pair generated
     * at boot — but every route it backs is 404 unless `OAUTH_DEV_PROVIDER=true`,
     * which cannot be set in production (asserted at boot and again on read).
     */
    LocalDevProvider,
    /**
     * The SAME class `AuthModule` provides, declared here as well.
     *
     * Not a duplicate session mechanism: `SessionService` is stateless and its own
     * dependencies (`PrismaService`, `DeviceIdentityService`) are global
     * singletons, so every instance behaves identically and writes to the same
     * `RefreshToken` table. Declaring it is what keeps `OAuthModule` from
     * importing `AuthModule` — which would be a circular dependency, since
     * `AuthModule` imports this module to register the routes.
     *
     * The alternative, reaching into `AuthService`, is what actually failed: that
     * service's `LoginAttemptService` is provided by `AuthModule`, so re-declaring
     * it here left it unresolvable.
     */
    {
      provide: SessionService,
      useFactory: (prisma: PrismaService, jwt: JwtService, devices: DeviceIdentityService) =>
        new SessionService(prisma, jwt, devices),
      inject: [PrismaService, JwtService, DeviceIdentityService],
    },
    {
      /**
       * Builds the verifier for a provider's config.
       *
       * A factory (not a ready-made instance) because the verifier is per-provider
       * — the `aud`/`iss`/JWKS triple differs. It is also the substitution point
       * for the E2E suite, which points real verification at a locally generated
       * key set: the logic under test stays the production logic.
       */
      provide: "OAUTH_ID_TOKEN_VERIFIER_FACTORY",
      useValue: createIdTokenVerifier,
    },
    {
      provide: OAuthService,
      useFactory: (
        sessions: SessionService,
        accounts: OAuthAccountService,
        jwt: JwtService,
        verifierFactory: typeof createIdTokenVerifier,
      ) => new OAuthService(sessions, accounts, jwt, verifierFactory),
      inject: [SessionService, OAuthAccountService, JwtService, "OAUTH_ID_TOKEN_VERIFIER_FACTORY"],
    },
  ],
  exports: [OAuthService, OAuthAccountService],
})
export class OAuthModule {}
