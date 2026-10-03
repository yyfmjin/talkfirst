import * as nodemailer from "nodemailer";
import type { EmailVerificationMessage, MailProvider, SmtpConfig } from "./mail.types";

/**
 * Production transport, backed by `nodemailer`.
 *
 * The package ships its own types, so this stays a plain static import; the
 * dependency is declared in `apps/api/package.json` and only ever constructed
 * when `MAIL_PROVIDER=smtp`.
 */
export class SmtpMailProvider implements MailProvider {
  readonly kind = "smtp" as const;
  private transport: nodemailer.Transporter | null = null;

  constructor(private readonly config: SmtpConfig) {}

  private getTransport(): nodemailer.Transporter {
    if (!this.transport) {
      this.transport = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: { user: this.config.user, pass: this.config.password },
      });
    }
    return this.transport;
  }

  async sendEmailVerificationCode(message: EmailVerificationMessage): Promise<void> {
    const minutes = Math.max(1, Math.round(message.expiresInSeconds / 60));
    await this.getTransport().sendMail({
      from: this.config.from,
      to: message.to,
      subject: "TalkFirst 邮箱验证码",
      // Plain text first: it is what a text-only client, a screen reader and a
      // watch notification will render, and it must stand on its own.
      text: `你的 TalkFirst 验证码是 ${message.code}，${minutes} 分钟内有效。如非本人操作请忽略本邮件。`,
      // HTML alongside it, never instead of it. Ported from the Gmail-SMTP branch
      // (see the merge note below) because a bare code in a plain-text body is
      // easy to mistake for spam, and the styled box is what makes the 6 digits
      // readable at a glance on a phone.
      html: verificationEmailHtml(message.code, minutes),
    });
  }
}

/**
 * The verification e-mail's HTML body.
 *
 * ## Why this lives here and not in `VerificationService`
 *
 * It arrived as an inline `nodemailer.createTransport` call inside
 * `VerificationService.sendCode` on the `feat(auth): enable gmail smtp
 * verification` branch. That placement bypassed `MailService` — the abstraction
 * that already selects between console / fake / smtp transports and that
 * `assertMailConfigurationForProduction` validates at boot — and it duplicated
 * nodemailer configuration behind a SECOND set of environment variables
 * (`EMAIL_HOST` / `EMAIL_USER` / …) beside the repo's `SMTP_*`. It also replaced
 * the hardened `sendCode` wholesale, dropping the per-address send cooldown, the
 * hourly cap, the attempt limit, the atomic single-use claim and the
 * `emailVerified` flip.
 *
 * Only the template was worth keeping, so only the template was kept, here in the
 * transport that already owns "how a message is rendered and sent". Gmail works
 * through this path unchanged: `MAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`,
 * `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=<address>`,
 * `SMTP_PASSWORD=<app password>`.
 *
 * `minutes` is passed in rather than recomputed: the TTL is policy and belongs to
 * `EMAIL_VERIFICATION_POLICY`, not to a template.
 */
function verificationEmailHtml(code: string, minutes: number): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 20px; color: #222;">
      <h2 style="margin-bottom: 24px;">TalkFirst 邮箱验证</h2>
      <p>你好，</p>
      <p>你正在注册 TalkFirst 账号，请使用下面的验证码完成邮箱验证：</p>

      <div style="margin: 28px 0; padding: 18px; background: #f5f6ff; border-radius: 12px; text-align: center;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px;">
          ${code}
        </span>
      </div>

      <p>验证码有效期为 <strong>${minutes} 分钟</strong>。</p>
      <p style="color: #888; font-size: 13px;">
        如果这不是你的操作，请忽略此邮件。请勿将验证码透露给他人。
      </p>

      <p style="margin-top: 32px; color: #888; font-size: 12px;">
        TalkFirst
      </p>
    </div>
  `.trim();
}
