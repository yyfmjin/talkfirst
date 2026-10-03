import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { MailModule } from "../mail/mail.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { LoginAttemptService } from "./login-attempt.service";
import { VerificationService } from "./verification.service";
import { SessionService } from "./session.service";
import { OAuthModule } from "./oauth/oauth.module";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    // SEC-005: supplies the mail transport `VerificationService` sends codes with.
    MailModule,
    /**
     * Google 快捷登录 —— authorization-code + PKCE + server-side callback.
     *
     * Its own module because it is a second, self-contained way to prove an
     * identity: own config, own routes, own tests. The one thing it shares with
     * the password flow is `AuthService.issueSession`, so every login path ends in
     * the same session (and the refresh-token reuse detection keeps working,
     * which it would not if OAuth minted its own tokens).
     */
    OAuthModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    /**
     * The single owner of session issuance (see `SessionService`). Provided here
     * AND in `OAuthModule`: it is stateless, its own dependencies are global
     * singletons, and declaring it twice is what avoids a circular module import
     * between the password flow and the OAuth flow.
     */
    SessionService,
    JwtStrategy,
    // Constructed by hand, not by the container: its constructor takes a policy
    // and a clock, which are not DI tokens (see `auth.module-di.spec.ts`).
    { provide: LoginAttemptService, useFactory: () => new LoginAttemptService() },
    VerificationService,
  ],
  exports: [AuthService, LoginAttemptService, VerificationService],
})
export class AuthModule {}
