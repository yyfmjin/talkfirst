import { JwtService } from "@nestjs/jwt";
import type { PrismaService } from "../prisma/prisma.service";
import type { DeviceIdentityService } from "../security/device-identity.service";
import { AuthService } from "./auth.service";
import { LoginAttemptService } from "./login-attempt.service";
import { SessionService } from "./session.service";

/**
 * 构造 `AuthService` 的测试夹具。
 *
 * ## Why this exists
 *
 * `AuthService` issues sessions through `SessionService` — the single owner of
 * that logic, extracted so the OAuth module can reuse it without a circular
 * module import. That made session issuance a real dependency, and seven
 * pre-existing specs construct `AuthService` by hand with positional arguments
 * (`new AuthService(prisma, jwt, { record })` and friends). Threading one more
 * positional argument through every one of them would have been mechanical churn
 * that has to be repeated on the next dependency, and it invites the mistake of
 * passing the wrong `undefined`.
 *
 * So the wiring lives here once. Tests keep building the service the way they
 * always did — `prisma` first, `jwt` second, then only the collaborators that
 * particular test cares about — and the optional tail is passed by name, which is
 * what makes a six-argument constructor readable at a call site.
 *
 * ## The session service it builds is the REAL one
 *
 * Not a stub: it runs against whatever `prisma` the test supplied, so a spec that
 * asserts "a refresh-token row was created" is still asserting that, and the
 * access token is still signed by the supplied `JwtService`. Only the object graph
 * is arranged here; no behaviour is replaced.
 */
export function makeAuthService(
  prisma: PrismaService,
  jwtService: JwtService,
  overrides: {
    securityEvents?: unknown;
    loginAttempts?: LoginAttemptService;
    verificationService?: unknown;
    devices?: DeviceIdentityService;
    sessions?: SessionService;
  } = {},
): AuthService {
  const sessions =
    overrides.sessions ?? new SessionService(prisma, jwtService, overrides.devices);

  return new AuthService(
    prisma,
    jwtService,
    overrides.securityEvents as never,
    overrides.loginAttempts,
    overrides.verificationService as never,
    overrides.devices,
    sessions,
  );
}
