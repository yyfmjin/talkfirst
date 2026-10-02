import { Injectable } from "@nestjs/common";
import { emailVerificationEnforced } from "../auth/email-verification.policy";
import { ConsoleMailProvider } from "./console-mail.provider";
import { FakeMailProvider } from "./fake-mail.provider";
import { MailConfigurationError, readSmtpConfig, resolveMailProviderKind } from "./mail.config";
import { SmtpMailProvider } from "./smtp-mail.provider";
import type { EmailVerificationMessage, MailProvider } from "./mail.types";

/**
 * SEC-005 — the one seam through which verification mail leaves the API.
 *
 * Everything above it (the verification service) is transport-agnostic; every
 * environment difference lives in `createMailProvider`.
 */
@Injectable()
export class MailService {
  constructor(private readonly provider: MailProvider) {}

  get providerKind(): MailProvider["kind"] {
    return this.provider.kind;
  }

  sendEmailVerificationCode(message: EmailVerificationMessage): Promise<void> {
    return this.provider.sendEmailVerificationCode(message);
  }
}

/**
 * Selects the transport from the environment.
 *
 * When verification is *not* enforced and SMTP is misconfigured we degrade to
 * the console transport instead of crashing a production boot that does not
 * depend on mail — but when verification *is* enforced the misconfiguration is
 * fatal, so a deployment can never trap users behind mail it cannot send.
 */
export function createMailProvider(env: NodeJS.ProcessEnv = process.env): MailProvider {
  const kind = resolveMailProviderKind(env);

  if (kind === "smtp") {
    const config = readSmtpConfig(env);
    if (config) return new SmtpMailProvider(config);
    if (emailVerificationEnforced(env)) {
      throw new MailConfigurationError(
        "Email verification is enabled but SMTP configuration is incomplete.",
      );
    }
    return new ConsoleMailProvider();
  }

  return kind === "fake" ? new FakeMailProvider() : new ConsoleMailProvider();
}
