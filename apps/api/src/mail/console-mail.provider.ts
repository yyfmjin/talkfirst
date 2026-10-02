import { Logger } from "@nestjs/common";
import { maskEmail } from "../security/privacy";
import type { EmailVerificationMessage, MailProvider } from "./mail.types";

/**
 * Development transport.
 *
 * It logs only *that* a message was handed off — never the code. The onboarding
 * flow still surfaces the code through the verification API's `devCode` field,
 * which is itself suppressed in production, so nothing about this provider is a
 * leak vector.
 */
export class ConsoleMailProvider implements MailProvider {
  readonly kind = "console" as const;
  private readonly logger = new Logger("Mail");

  async sendEmailVerificationCode(message: EmailVerificationMessage): Promise<void> {
    this.logger.log(
      `EMAIL VERIFICATION SENT (console) to ${maskEmail(message.to)}; ` +
        `expires in ${message.expiresInSeconds}s`,
    );
  }
}
