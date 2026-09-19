import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-jwt";
import { JWT_ACCESS_SECRET, jwtFromRequest } from "./auth.constants";
import { PrismaService } from "../prisma/prisma.service";

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
      select: { id: true, email: true, status: true },
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
    return { id: user.id, email: user.email };
  }
}
