import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { newVerificationCode, sha256Hex } from "../common/crypto";
import { mayExposeVerificationCode } from "../common/security-config";
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

  /**
   * 全局发信窗口（2026-10-07）。
   *
   * 下面已有的冷却与每小时上限都**按地址**计数 —— 换个地址就重置。而从
   * 2026-10-06 起每一封都真的经我们的 Gmail 账号发出，于是「换地址刷」的后果是：
   * 账号日额度被打满 / 被判定为垃圾邮件发送源，连带把注册与找回密码一起打死，
   * 而且等于替别人群发。
   *
   * 这不是「防住某个人」，而是给「一次事故最多烧掉多少封」定一个上限：超了就拒。
   * 代价是**真的有人群发时正常用户也会被挡一会儿** —— 两害相权。
   *
   * 单进程内存窗口就够：当前部署是一个 api 实例（pm2 单实例）。
   * 将来扩到多实例时必须换 Redis，否则每个实例各放 N 条。
   */
  private readonly globalSends: number[] = [];
  private readonly globalMaxPerHour = 200;

  /**
   * 只在**真的要发信**的路径上消耗全局额度。
   *
   * 调用点放在 `assertSendAllowed` 末尾，是为了继承它上方那段注释的语义：
   * 对一条未过期验证码的重发不算新的外发邮件，不该占额度。
   */
  private consumeGlobalSendBudget(now: number): boolean {
    const hourAgo = now - 60 * 60 * 1000;
    const window = this.globalSends;
    while (window.length > 0 && window[0] <= hourAgo) window.shift();
    if (window.length >= this.globalMaxPerHour) return false;
    window.push(now);
    return true;
  }

  /**
   * Issue (or re-issue) a verification code.
   *
   * ## Why an active code short-circuits the cooldown (post-audit fix)
   *
   * `assertSendAllowed` enforces a 60s cooldown between sends and a 5-per-hour
   * cap per address, which is the right envelope for *mail-bomb* resistance. But
   * it counted every send against the budget, so a request that could not
   * actually deliver anything new — because a valid code for this address and
   * purpose is already sitting unspent — still burned a slot.
   *
   * That is harmless for registration (the page sends once on mount) and it is
   * actively harmful for password reset: `AuthService.resetPassword` calls
   * `verifyCode` and then this method, so that a failed attempt re-sends a code
   * rather than leaving the user stuck with one they may not have received or
   * already mistyped. Under the old rule, five mistyped codes locked the address
   * out of the reset flow for an hour — a denial of service against the very
   * user the flow exists to rescue.
   *
   * Re-sending the *same* code is also better security: the cooldown and hourly
   * budget now bound DISTINCT codes (real outbound mail), while retries against
   * an outstanding code are bounded by `maxAttempts`, which is the counter
   * designed for that.
   */
  async sendCode(email: string, purpose = "REGISTER") {
    const normalized = email.trim().toLowerCase();
    const now = Date.now();

    const outstanding = await this.prisma.verificationCode.findFirst({
      where: {
        email: normalized,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date(now) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (outstanding) {
      // The code itself is unrecoverable (only its hash is stored), so nothing
      // is mailed again — the client already has whatever was delivered. The
      // caller still gets the same success shape, so this cannot be used to
      // probe how recently a code was requested.
      return {
        sent: true,
        expiresInSeconds: Math.max(
          0,
          Math.round((outstanding.expiresAt.getTime() - now) / 1000),
        ),
        devCode: undefined,
      };
    }

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

    // The code is handed back only when this process has explicitly declared
    // itself a development/test process. It used to be `NODE_ENV !== "production"`,
    // which handed the code to any UNAUTHENTICATED caller — this endpoint has no
    // guard — on every deployment that forgot to set NODE_ENV (FIX, audit P007).
    const devCode = mayExposeVerificationCode() ? code : undefined;
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

    // 全局闸门：见 `globalSends` 的说明。按地址的上限挡不住「换地址刷」。
    if (!this.consumeGlobalSendBudget(now)) {
      await this.recordRateLimited(normalized, purpose, "GLOBAL_SEND_BUDGET");
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
