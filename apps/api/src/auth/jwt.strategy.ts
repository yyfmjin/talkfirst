import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-jwt";
import { JWT_ACCESS_SECRET, jwtFromRequest } from "./auth.constants";
import { PrismaService } from "../prisma/prisma.service";
import { getRequestContext } from "../security/request-context";
import { emailVerificationEnforced, isEmailVerificationAllowedPath } from "./email-verification.policy";

export type AccessTokenPayload = { sub: string; email: string; type: "access" };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest,
      secretOrKey: process.env[JWT_ACCESS_SECRET] ?? "change-me-in-development",
      ignoreExpiration: false,
    });
  }

  async validate(payload: AccessTokenPayload) {
    if (payload.type !== "access") {
      throw new UnauthorizedException({
        success: false,
        error: { code: "INVALID_TOKEN", message: "Invalid token type" },
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, status: true, emailVerified: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    if (user.status === "BANNED") {
      throw new UnauthorizedException({
        success: false,
        error: { code: "USER_BANNED", message: "This account is banned" },
      });
    }
    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException({
        success: false,
        error: { code: "USER_DISABLED", message: "This account is disabled" },
      });
    }
    // SEC-005 — the account gate is read from the database on *every* request, so
    // a token minted before verification cannot be used to reach the product: the
    // moment enforcement is on, an unverified account is refused the business API
    // while still being allowed the handful of routes the verification flow needs.
    // Verification success flips the stored flag, which is why the same unexpired
    // token starts working again without a re-login.
    //
    // The check runs *after* the status checks so SEC-002's verdicts are unchanged.
    if (
      emailVerificationEnforced() &&
      !user.emailVerified &&
      !isEmailVerificationAllowedPath(getRequestContext()?.path)
    ) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "EMAIL_VERIFIED_REQUIRED",
          message: "Verify your email address to continue",
        },
      });
    }
    return { id: user.id, email: user.email };
  }
}
