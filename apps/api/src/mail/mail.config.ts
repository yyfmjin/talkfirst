import { emailVerificationEnforced } from "../auth/email-verification.policy";
import type { MailProviderKind, SmtpConfig } from "./mail.types";

/** Environment variable names owned by this module. */
export const MAIL_PROVIDER_ENV = "MAIL_PROVIDER";

/**
 * Picks the transport. An explicit `MAIL_PROVIDER` always wins; otherwise the
 * environment decides a sensible default so a plain `npm run start:dev` works
 * without any mail configuration and a test run never needs a network.
 */
export function resolveMailProviderKind(env: NodeJS.ProcessEnv = process.env): MailProviderKind {
  const raw = (env[MAIL_PROVIDER_ENV] ?? "").trim().toLowerCase();
  if (raw === "console" || raw === "fake" || raw === "smtp") return raw;

  if (env.NODE_ENV === "test") return "fake";
  if (env.NODE_ENV === "production") return "smtp";
  return "console";
}

/**
 * Reads the SMTP settings, returning `null` when the set is incomplete.
 *
 * `SMTP_PORT` defaults to 587 and `SMTP_SECURE` is derived from the port (465 is
 * implicit TLS), so only host/credentials/from are genuinely required.
 */
export function readSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? "").trim();
  const user = (env.SMTP_USER ?? "").trim();
  const password = env.SMTP_PASSWORD ?? "";
  const from = (env.SMTP_FROM ?? "").trim();
  if (!host || !user || !password || !from) return null;

  const port = Number((env.SMTP_PORT ?? "").trim() || "587");
  if (!Number.isFinite(port) || port <= 0) return null;

  const secureRaw = (env.SMTP_SECURE ?? "").trim().toLowerCase();
  const secure = secureRaw ? secureRaw === "true" : port === 465;

  return { host, port, user, password, from, secure };
}

export class MailConfigurationError extends Error {}

/**
 * SEC-005 — fail fast rather than trap users.
 *
 * If a production deployment demands verification but cannot send mail, every
 * new account becomes permanently locked out with no way to recover. Refusing to
 * boot is the least-bad outcome, and the message deliberately names only the
 * variables that are missing — never their values.
 */
export function assertMailConfigurationForProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  if (!emailVerificationEnforced(env)) return;

  const kind = resolveMailProviderKind(env);
  if (kind !== "smtp" || readSmtpConfig(env) === null) {
    throw new MailConfigurationError(
      "Email verification is enabled but SMTP configuration is incomplete. " +
        "Set MAIL_PROVIDER=smtp and SMTP_HOST / SMTP_PORT / SMTP_USER / " +
        "SMTP_PASSWORD / SMTP_FROM.",
    );
  }
}
