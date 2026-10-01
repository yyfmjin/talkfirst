import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { newVerificationCode, sha256Hex } from "../common/crypto";
import { SecurityEventService } from "../security/security-event.service";
import {
  RiskLevel,
  SecurityEventSource,
  SecurityEventType,
} from "../security/security.constants";
import { reasonCodeOf } from "../security/error-reason";
import { hashEmail, maskEmail } from "../security/privacy";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    // Security Audit Center (P1). Optional so isolated unit tests stay simple.
    private readonly securityEvents?: SecurityEventService,
  ) {}

  async sendCode(email: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();

    const code = newVerificationCode();
    await this.prisma.verificationCode.create({
      data: {
        email: normalized,
        codeHash: sha256Hex(code),
        purpose,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    // The code itself must never reach the audit trail.
    await this.securityEvents?.record({
      type: SecurityEventType.EMAIL_VERIFICATION_SENT,
      source: SecurityEventSource.AUTH,
      success: true,
      detail: { emailMasked: maskEmail(normalized), purpose },
    });

    // Phase 2/3: no SMTP provider configured yet. The code is returned only in
    // development so the onboarding flow can be verified end to end.
    const devCode = process.env.NODE_ENV === "production" ? undefined : code;
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000, devCode };
  }

  async verifyCode(email: string, code: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();
    try {
      const record = await this.prisma.verificationCode.findFirst({
        where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (!record) {
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_INVALID", message: "Verification code is invalid or expired" },
        } as unknown as Record<string, unknown>);
      }
      if (record.attempts >= MAX_ATTEMPTS) {
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_LOCKED", message: "Too many attempts, request a new code" },
        } as unknown as Record<string, unknown>);
      }
      if (record.codeHash !== sha256Hex(code)) {
        await this.prisma.verificationCode.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_MISMATCH", message: "Verification code is incorrect" },
        } as unknown as Record<string, unknown>);
      }
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      await this.securityEvents?.record({
        type: SecurityEventType.EMAIL_VERIFICATION_SUCCESS,
        source: SecurityEventSource.AUTH,
        success: true,
        detail: { emailMasked: maskEmail(normalized), purpose },
      });
      return { verified: true };
    } catch (error) {
      // Masked address + reason only: the submitted code is never recorded, and
      // the hash lets repeated failures against one address be grouped.
      await this.securityEvents?.record({
        type: SecurityEventType.EMAIL_VERIFICATION_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        success: false,
        detail: {
          emailMasked: maskEmail(normalized),
          emailHash: hashEmail(normalized),
          purpose,
          reasonCode: reasonCodeOf(error, "EMAIL_VERIFICATION_FAILED"),
        },
      });
      throw error;
    }
  }

  async assertRecentVerification(email: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();
    const record = await this.prisma.verificationCode.findFirst({
      where: {
        email: normalized,
        purpose,
        consumedAt: { not: null },
        expiresAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { consumedAt: "desc" },
    });
    if (!record) {
      throw new BadRequestException({
        success: false,
        error: { code: "EMAIL_NOT_VERIFIED", message: "Verify your email before registering" },
      } as unknown as Record<string, unknown>);
    }
  }
}
