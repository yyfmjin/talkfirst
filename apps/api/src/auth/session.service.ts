import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DeviceIdentityService } from "../security/device-identity.service";
import { getRequestContext } from "../security/request-context";
import { newRawToken, sha256Hex } from "../common/crypto";
import { jwtSecretOrDevFallback } from "../common/security-config";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ACCESS_SECRET,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./auth.constants";
import { toPublicUser } from "./public-user";

/**
 * 签发与撤销会话 —— 所有登录方式的**唯一**出口。
 *
 * ## Why this is its own provider rather than a method on `AuthService`
 *
 * `AuthService` carries the password machinery (bcrypt, login lockout, e-mail
 * verification, password reset). Google sign-in needs none of that — it needs
 * exactly one thing from the password world: the session that a proven identity
 * ends in.
 *
 * Reaching into `AuthService` for it created a circular module dependency
 * (`AuthModule` imports `OAuthModule`, and re-declaring `AuthService` inside
 * `OAuthModule` broke its own constructor resolution — `LoginAttemptService` is
 * provided by `AuthModule`, not by the container). Extracting the session is the
 * fix that does not require either module to know about the other's providers.
 *
 * ## Why one implementation matters, and not only for tidiness
 *
 * Session issuance is where the refresh-token row is written, and SEC-003-B's
 * reuse detection works by following `replacedById` chains through those rows. A
 * second, hand-rolled session path in the OAuth module would produce tokens that
 * look valid but sit outside that chain — so a stolen token from the OAuth path
 * would never be detected as replayed. There is one implementation because there
 * has to be.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly devices?: DeviceIdentityService,
  ) {}

  /**
   * Mint a session for a user whose identity has already been proven.
   *
   * Callers own the decision that the account may be signed into: `AuthService`
   * checks `status` and the e-mail-verification policy before calling this, and
   * `OAuthAccountService` checks `status` on the OAuth path. This method does not
   * re-check, matching its previous behaviour on `AuthService`.
   */
  async issue(user: User) {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = newRawToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: this.refreshExpiresAt(),
      },
    });
    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  /**
   * Phase O1 — record the device↔account association for a successful sign-in.
   *
   * Deliberately awaited but fault-isolated: `DeviceIdentityService.record()`
   * never throws, so a broken device table cannot turn a valid login into a 500.
   */
  async recordDevice(userId: string): Promise<void> {
    await this.devices?.record({
      userAgent: getRequestContext()?.userAgent,
      userId,
      // The ONLY caller allowed to pass this: the flag means "an authentication
      // actually succeeded", so traffic and token refreshes must not set it.
      bumpLoginCount: true,
    });
  }

  private async signAccessToken(user: User): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, email: user.email, type: "access" },
      {
        secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  private refreshExpiresAt(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }
}
