import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaClient, User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { isProfileComplete } from "../users/profile-completion";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ACCESS_SECRET,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./auth.constants";
import { newRawToken, sha256Hex } from "../common/crypto";
import { SecurityEventService } from "../security/security-event.service";
import {
  RiskLevel,
  SecurityEventSource,
  SecurityEventType,
} from "../security/security.constants";
import { reasonCodeOf } from "../security/error-reason";
import { hashEmail, maskEmail } from "../security/privacy";
import { ChangePasswordDto, LoginDto, RegisterDto } from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    // Security Audit Center (P1). Optional so an isolated unit test can build the
    // service without pulling in the audit infrastructure.
    private readonly securityEvents?: SecurityEventService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    try {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictException({
          success: false,
          error: { code: "EMAIL_TAKEN", message: "Email is already registered" },
        });
      }
      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = await this.prisma.user.create({
        data: { email, passwordHash, lastActiveAt: new Date() },
      });
      const session = await this.issueSession(user);
      await this.securityEvents?.record({
        type: SecurityEventType.REGISTER_SUCCESS,
        source: SecurityEventSource.AUTH,
        userId: user.id,
        success: true,
        detail: { emailMasked: maskEmail(email) },
      });
      return session;
    } catch (error) {
      // Never the password, and never the raw address — see `privacy.ts`.
      await this.securityEvents?.record({
        type: SecurityEventType.REGISTER_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.LOW,
        success: false,
        detail: {
          emailMasked: maskEmail(email),
          emailHash: hashEmail(email),
          reasonCode: reasonCodeOf(error, "REGISTER_FAILED"),
        },
      });
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new UnauthorizedException({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" },
        });
      }
      if (user.status === "BANNED") {
        throw new UnauthorizedException({
          success: false,
          error: { code: "USER_BANNED", message: "This account is banned" },
        });
      }
      const valid = await bcrypt.compare(dto.password, user.passwordHash);
      if (!valid) {
        throw new UnauthorizedException({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" },
        });
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
      const session = await this.issueSession(user);
      await this.securityEvents?.record({
        type: SecurityEventType.LOGIN_SUCCESS,
        source: SecurityEventSource.AUTH,
        userId: user.id,
        success: true,
      });
      return session;
    } catch (error) {
      // A failed login deliberately carries no `userId`: the point of the event
      // is to spot attempts against addresses that may not exist.
      await this.securityEvents?.record({
        type: SecurityEventType.LOGIN_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        success: false,
        detail: {
          emailMasked: maskEmail(email),
          emailHash: hashEmail(email),
          reasonCode: reasonCodeOf(error, "LOGIN_FAILED"),
        },
      });
      throw error;
    }
  }

  private async issueSession(user: User) {
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, type: "access" },
      {
        secret: process.env[JWT_ACCESS_SECRET] ?? "change-me-in-development",
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
    const refreshToken = newRawToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return { accessToken, refreshToken, user: this.toPublicUser(user) };
  }

  async rotateRefresh(rawRefreshToken: string | undefined) {
    try {
      if (!rawRefreshToken) {
        throw new UnauthorizedException({
          success: false,
          error: { code: "NO_REFRESH_TOKEN", message: "Missing refresh token" },
        });
      }
      const record = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256Hex(rawRefreshToken) },
        include: { user: true },
      });
      if (!record || record.revokedAt || record.expiresAt < new Date()) {
        throw new UnauthorizedException({
          success: false,
          error: { code: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid or expired" },
        });
      }
      if (record.user.status === "BANNED") {
        throw new UnauthorizedException({
          success: false,
          error: { code: "USER_BANNED", message: "This account is banned" },
        });
      }
      await this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      const session = await this.issueSession(record.user);
      await this.securityEvents?.record({
        type: SecurityEventType.TOKEN_REFRESH,
        source: SecurityEventSource.AUTH,
        userId: record.user.id,
        success: true,
      });
      return session;
    } catch (error) {
      // The raw refresh token is never recorded — only that a rotation failed.
      await this.securityEvents?.record({
        type: SecurityEventType.TOKEN_REFRESH_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        success: false,
        detail: { reasonCode: reasonCodeOf(error, "TOKEN_REFRESH_FAILED") },
      });
      throw error;
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    try {
      if (dto.newPassword !== dto.confirmPassword) {
        throw new BadRequestException({
          success: false,
          error: { code: "PASSWORD_MISMATCH", message: "New password and confirmation do not match" },
        });
      }
      if (dto.newPassword === dto.currentPassword) {
        throw new BadRequestException({
          success: false,
          error: { code: "PASSWORD_UNCHANGED", message: "New password must differ from current password" },
        });
      }

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }

      const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
      if (!valid) {
        throw new UnauthorizedException({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "Current password is incorrect" },
        });
      }

      const passwordHash = await bcrypt.hash(dto.newPassword, 12);
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
        this.prisma.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      const updated = await this.prisma.user.findUnique({ where: { id: userId } });
      const session = await this.issueSession(updated!);
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_CHANGED,
        source: SecurityEventSource.AUTH,
        userId,
        success: true,
      });
      return session;
    } catch (error) {
      const reasonCode = reasonCodeOf(error, "PASSWORD_CHANGE_FAILED");
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_CHANGE_FAILED,
        source: SecurityEventSource.AUTH,
        // A wrong current password is a meaningful signal; a validation slip is not.
        riskLevel: reasonCode === "INVALID_CREDENTIALS" ? RiskLevel.MEDIUM : RiskLevel.LOW,
        userId,
        success: false,
        detail: { reasonCode },
      });
      throw error;
    }
  }

  async logout(rawRefreshToken: string | undefined) {
    if (rawRefreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256Hex(rawRefreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.securityEvents?.record({
      type: SecurityEventType.LOGOUT,
      source: SecurityEventSource.AUTH,
      success: true,
    });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return this.toPublicUser(user);
  }

  toPublicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      status: user.status,
      isAdmin: user.isAdmin,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      birthDate: user.birthDate,
      countryCode: user.countryCode,
      city: user.city,
      gender: user.gender,
      bio: user.bio,
      profileCompleted: isProfileComplete(user),
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
    };
  }

  async markEmailVerified(email: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.update({
      where: { email: normalized },
      data: { emailVerified: true },
    });
    return this.toPublicUser(user);
  }
}

void PrismaClient;
