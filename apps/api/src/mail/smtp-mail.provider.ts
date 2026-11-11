import * as nodemailer from "nodemailer";
import {
  type MessageKey,
  type SupportedLocale,
  localeOrDefault,
  t,
} from "../common/i18n";
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
    const locale = localeOrDefault(message.locale);
    await this.getTransport().sendMail({
      from: this.config.from,
      to: message.to,
      subject: t(locale, "mail.verification.subject"),
      // Plain text first: it is what a text-only client, a screen reader and a
      // watch notification will render, and it must stand on its own.
      text: t(locale, "mail.verification.text", { code: message.code, minutes }),
      // HTML alongside it, never instead of it. Ported from the Gmail-SMTP branch
      // (see the merge note below) because a bare code in a plain-text body is
      // easy to mistake for spam, and the styled box is what makes the 6 digits
      // readable at a glance on a phone.
      html: verificationEmailHtml(locale, message.code, minutes, introKeyFor(message.purpose)),
    });
  }
}

/**
 * 按用途挑一句「你正在做什么」（2026-11-11）。
 *
 * 这段正文曾经硬编码成注册文案，而同一个模板同时服务于注册、重置密码、改密码三种
 * 场景 —— 于是一个正在改密码的人会收到「你正在注册 TalkFirst 账号」。内容本身无害
 * （码是真的、有效期是真的），但一封说自己「不是这个用途」的信，正是钓鱼邮件的特征。
 *
 * 未知用途落到中性句：宁少说一句，不猜错一句。
 */
function introKeyFor(purpose?: string): MessageKey {
  switch (purpose) {
    case "REGISTER":
      return "mail.verification.intro";
    case "PASSWORD_RESET":
      return "mail.verification.introReset";
    case "PASSWORD_CHANGE":
      return "mail.verification.introChange";
    default:
      return "mail.verification.introGeneric";
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
 * `EMAIL_VERIFICATION_POLICY`, not to a template. `locale` 同理来自调用方：
 * 语言是**收件人**的属性，不是模板的属性。
 */
function verificationEmailHtml(
  locale: SupportedLocale,
  code: string,
  minutes: number,
  introKey: MessageKey,
): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 20px; color: #222;">
      <h2 style="margin-bottom: 24px;">${t(locale, "mail.verification.heading")}</h2>
      <p>${t(locale, "mail.verification.greeting")}</p>
      <p>${t(locale, introKey)}</p>

      <div style="margin: 28px 0; padding: 18px; background: #f5f6ff; border-radius: 12px; text-align: center;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px;">
          ${code}
        </span>
      </div>

      <p>${t(locale, "mail.verification.expiry", { minutes })}</p>
      <p style="color: #888; font-size: 13px;">
        ${t(locale, "mail.verification.ignore")}
      </p>

      <p style="margin-top: 32px; color: #888; font-size: 12px;">
        TalkFirst
      </p>
    </div>
  `.trim();
}
