import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { LoginAttemptService } from "./login-attempt.service";
import { VerificationService } from "./verification.service";

@Module({
  imports: [PassportModule.register({ defaultStrategy: "jwt" }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Constructed by hand, not by the container: its constructor takes a policy
    // and a clock, which are not DI tokens (see `auth.module-di.spec.ts`).
    { provide: LoginAttemptService, useFactory: () => new LoginAttemptService() },
    VerificationService,
  ],
  exports: [AuthService, LoginAttemptService, VerificationService],
})
export class AuthModule {}
