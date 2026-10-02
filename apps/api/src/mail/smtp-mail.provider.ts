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
      text: `你的 TalkFirst 验证码是 ${message.code}，${minutes} 分钟内有效。如非本人操作请忽略本邮件。`,
    });
  }
}
