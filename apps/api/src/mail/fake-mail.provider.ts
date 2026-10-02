import type { EmailVerificationMessage, MailProvider } from "./mail.types";

/**
 * Test transport.
 *
 * Holds the messages in a module-level outbox so a spec can assert that a code
 * was (or was not) handed to the mailer, and read the code without the
 * production code ever having to pass it back through a response body.
 */
const outbox: EmailVerificationMessage[] = [];

export class FakeMailProvider implements MailProvider {
  readonly kind = "fake" as const;

  async sendEmailVerificationCode(message: EmailVerificationMessage): Promise<void> {
    outbox.push({ ...message });
  }
}

/** Test-only read access. */
export function sentVerificationMails(): readonly EmailVerificationMessage[] {
  return outbox;
}

/** Test-only reset, so cases do not leak into each other. */
export function resetSentVerificationMails(): void {
  outbox.length = 0;
}
