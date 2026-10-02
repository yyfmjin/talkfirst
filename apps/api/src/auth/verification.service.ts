import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { newVerificationCode, sha256Hex } from "../common/crypto";
import { MailService } from "../mail/mail.service";
import { SecurityEventService } from "../security/security-event.service";
import {
  RiskLevel,
  SecurityEventSource,
  SecurityEventType,
} from "../security/security.constants";
import { reasonCodeOf } from "../security/error-reason";
import { hashEmail, maskEmail } from "../security/privacy";

/**
 * SEC-005 — one place for the verification-code lifecycle numbers, so a policy
 * change is a single edit rather than a hunt for magic numbers.
 *
 *  - `codeTtlMs` 10min: long enough for a slow inbox, short enough that a leak is
 *    not durable.
 *  - `maxAttempts` 5: a 6-digit space is unhittable by guessing within five tries.
 *  - `resendCooldownMs` 60s: stops a double-click from burning the hourly budget,
 *    and stops the endpoint being used as a mail-bomb amplifier.
 *  - `maxPerHour` 5: bounds how many messages one address can be made to receive.
 *
 * The IP-level `@Throttle(20/min)` on the controller is kept *in addition* to
 * this: the two budgets catch different attackers (one IP → many addresses,
 * versus many IPs → one address).
 */
export const EMAIL_VERIFICATION_POLICY = {
  codeTtlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 60 * 1000,
  maxPerHour: 5,
} as const;

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    // Security Audit Center (P1). Optional so isolated unit tests stay simple.
    private readonly securityEvents?: SecurityEventService,
    // SEC-005. Optional so the pre-existing unit tests that build this service
    // by hand keep compiling; Nest still injects the singleton.
    private readonly mail?: MailService,
  ) {}

  async sendCode(email: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();
    const now = Date.now();

    await this.assertSendAllowed(normalized, purpose, now);

    const code = newVerificationCode();
    const record = await this.prisma.verificationCode.create({
      data: {
        email: normalized,
        codeHash: sha256Hex(code),
        purpose,
        expiresAt: new Date(now + EMAIL_VERIFICATION_POLICY.codeTtlMs),
      },
    });

    try {
      await this.mail?.sendEmailVerificationCode({
        to: normalized,
        code,
        expiresInSeconds: EMAIL_VERIFICATION_POLICY.codeTtlMs / 1000,
      });
    } catch (error) {
      // A code nobody can receive must not occupy the address' cooldown, or the
      // next honest retry is refused for a minute for no reason.
      await this.prisma.verificationCode
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw error;
    }

    // The code itself must never reach the audit trail.
    await this.securityEvents?.record({
      type: SecurityEventType.EMAIL_VERIFICATION_SENT,
      source: SecurityEventSource.AUTH,
      success: true,
      detail: { emailMasked: maskEmail(normalized), purpose },
    });

    // The code is handed back only outside production, so the onboarding flow can
    // be exercised locally; production never returns it.
    const devCode = process.env.NODE_ENV === "production" ? undefined : code;
    return { sent: true, expiresInSeconds: EMAIL_VERIFICATION_POLICY.codeTtlMs / 1000, devCode };
  }

  /**
   * Envelope the per-address cooldown and hourly cap. Both are keyed on the
   * submitted address, so an unknown address is bounded exactly like a real one
   * and the refusal says nothing about whether the account exists.
   */
  private async assertSendAllowed(normalized: string, purpose: string, now: number) {
    const latest = await this.prisma.verificationCode.findFirst({
      where: { email: normalized, purpose },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (
      latest &&
      now - latest.createdAt.getTime() < EMAIL_VERIFICATION_POLICY.resendCooldownMs
    ) {
      await this.recordRateLimited(normalized, purpose, "RESEND_COOLDOWN");
      throw this.rateLimited();
    }

    const sentLastHour = await this.prisma.verificationCode.count({
      where: {
        email: normalized,
        purpose,
        createdAt: { gt: new Date(now - 60 * 60 * 1000) },
      },
    });
    if (sentLastHour >= EMAIL_VERIFICATION_POLICY.maxPerHour) {
      await this.recordRateLimited(normalized, purpose, "HOURLY_LIMIT");
      throw this.rateLimited();
    }
  }

  private async recordRateLimited(normalized: string, purpose: string, subReason: string) {
    await this.securityEvents?.record({
      type: SecurityEventType.EMAIL_VERIFICATION_RATE_LIMITED,
      source: SecurityEventSource.AUTH,
      riskLevel: RiskLevel.MEDIUM,
      success: false,
      detail: {
        emailMasked: maskEmail(normalized),
        emailHash: hashEmail(normalized),
        purpose,
        reasonCode: subReason,
      },
    });
  }

  private rateLimited() {
    return new HttpException(
      {
        success: false,
        error: {
          code: "EMAIL_VERIFICATION_RATE_LIMITED",
          message: "Too many verification codes requested. Please try again later.",
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  async verifyCode(email: string, code: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();
    try {
      const record = await this.prisma.verificationCode.findFirst({
        where: {
          email: normalized,
          purpose,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!record) {
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_INVALID", message: "Verification code is invalid or expired" },
        } as unknown as Record<string, unknown>);
      }
      if (record.attempts >= EMAIL_VERIFICATION_POLICY.maxAttempts) {
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_LOCKED", message: "Too many attempts, request a new code" },
        } as unknown as Record<string, unknown>);
      }
      if (record.codeHash !== sha256Hex(code)) {
        // Written outside the transaction below on purpose: a rolled-back attempt
        // counter would let an attacker guess without limit.
        await this.prisma.verificationCode.update({
          where: { id: record.id },
          data: { attempts: { increment: 1 } },
        });
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_MISMATCH", message: "Verification code is incorrect" },
        } as unknown as Record<string, unknown>);
      }

      const consumed = await this.prisma.$transaction(async (tx) => {
        // Claim the code conditionally, so two concurrent submissions cannot both
        // succeed on one code.
        const claim = await tx.verificationCode.updateMany({
          where: { id: record.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (claim.count !== 1) return false;
        // Flip the owner's flag in the same transaction. `updateMany` (not
        // `update`) means an address that was never registered simply matches no
        // row instead of throwing P2025 / a 500 — and it never reveals whether
        // the address exists.
        await tx.user.updateMany({
          where: { email: normalized },
          data: { emailVerified: true },
        });
        return true;
      });

      if (!consumed) {
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_INVALID", message: "Verification code is invalid or expired" },
        } as unknown as Record<string, unknown>);
      }

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
