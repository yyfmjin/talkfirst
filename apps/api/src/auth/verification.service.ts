import { BadRequestException, Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { newVerificationCode, sha256Hex } from "../common/crypto";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async sendCode(email: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();

    const host = process.env.EMAIL_HOST;
    const port = Number(process.env.EMAIL_PORT || "587");
    const user = process.env.EMAIL_USER;
    const password = process.env.EMAIL_PASSWORD;

    if (!host || !user || !password) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "EMAIL_NOT_CONFIGURED",
          message: "Email service is not configured",
        },
      } as unknown as Record<string, unknown>);
    }

    const code = newVerificationCode();

    const record = await this.prisma.verificationCode.create({
      data: {
        email: normalized,
        codeHash: sha256Hex(code),
        purpose,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user,
          pass: password,
        },
      });

      await transporter.sendMail({
        from: `"TalkFirst" <${user}>`,
        to: normalized,
        subject: "TalkFirst 邮箱验证码",
        text: `你的 TalkFirst 验证码是：${code}\n\n验证码有效期为 10 分钟，请勿将验证码透露给他人。`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 20px; color: #222;">
            <h2 style="margin-bottom: 24px;">TalkFirst 邮箱验证</h2>
            <p>你好，</p>
            <p>你正在注册 TalkFirst 账号，请使用下面的验证码完成邮箱验证：</p>

            <div style="margin: 28px 0; padding: 18px; background: #f5f6ff; border-radius: 12px; text-align: center;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px;">
                ${code}
              </span>
            </div>

            <p>验证码有效期为 <strong>10 分钟</strong>。</p>
            <p style="color: #888; font-size: 13px;">
              如果这不是你的操作，请忽略此邮件。请勿将验证码透露给他人。
            </p>

            <p style="margin-top: 32px; color: #888; font-size: 12px;">
              TalkFirst
            </p>
          </div>
        `,
      });

      return {
        sent: true,
        expiresInSeconds: CODE_TTL_MS / 1000,
      };
    } catch (error) {
      await this.prisma.verificationCode.delete({
        where: { id: record.id },
      });

      console.error("[VerificationService] Failed to send verification email:", error);

      throw new BadRequestException({
        success: false,
        error: {
          code: "EMAIL_SEND_FAILED",
          message: "Failed to send verification email",
        },
      } as unknown as Record<string, unknown>);
    }
  }

  async verifyCode(email: string, code: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();

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
        error: {
          code: "CODE_INVALID",
          message: "Verification code is invalid or expired",
        },
      } as unknown as Record<string, unknown>);
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "CODE_LOCKED",
          message: "Too many attempts, request a new code",
        },
      } as unknown as Record<string, unknown>);
    }

    if (record.codeHash !== sha256Hex(code)) {
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });

      throw new BadRequestException({
        success: false,
        error: {
          code: "CODE_MISMATCH",
          message: "Verification code is incorrect",
        },
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
        expiresAt: {
          gt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { consumedAt: "desc" },
    });

    if (!record) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "EMAIL_NOT_VERIFIED",
          message: "Verify your email before registering",
        },
      } as unknown as Record<string, unknown>);
    }
  }
}
