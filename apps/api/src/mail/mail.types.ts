/**
 * SEC-005 — outbound mail abstraction.
 *
 * The verification flow must not depend on *how* a message leaves the process:
 * development prints it, tests capture it, production sends it over SMTP. The
 * only thing every caller knows is this interface, which is also why a
 * production deployment can be refused at boot when the SMTP half is missing.
 */
import type { SupportedLocale } from "../common/i18n";

export type MailProviderKind = "console" | "fake" | "smtp";

export interface EmailVerificationMessage {
  /** Recipient address (plaintext — never written to the audit trail). */
  to: string;
  /** The 6-digit code. Never logged and never recorded in a security event. */
  code: string;
  expiresInSeconds: number;
  /**
   * 收件人的语言，由调用方（`VerificationService`）解析后传进来 ——
   * 模板层不查数据库。
   *
   * 注册时账号还不存在，只能看请求头；缺失时按兑底语言渲染：因为语言不确定
   * 而不发验证码，才是真正的事故。
   */
  locale?: SupportedLocale;
}

export interface MailProvider {
  readonly kind: MailProviderKind;
  sendEmailVerificationCode(message: EmailVerificationMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}
