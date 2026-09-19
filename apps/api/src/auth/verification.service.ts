import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { newVerificationCode, sha256Hex } from "../common/crypto";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

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

    // Phase 2/3: no SMTP provider configured yet. The code is returned only in
    // development so the onboarding flow can be verified end to end.
    const devCode = process.env.NODE_ENV === "production" ? undefined : code;
    return { sent: true, expiresInSeconds: CODE_TTL_MS / 1000, devCode };
  }

  async verifyCode(email: string, code: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();
    const record = await this.prisma.verificationCode.findFirst({
      where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });    if (!record) {
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
    return { verified: true };
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
