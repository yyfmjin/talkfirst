import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Runtime-editable site settings.
 *
 * ## Scope
 *
 * Deliberately one consumer today: the support address the app shows members. The
 * table is generic (`AppSetting`), but this service exposes named accessors rather than
 * a general `get(key)`/`set(key)`, so each setting's validation lives in one place and a
 * caller cannot invent a key that nothing reads.
 *
 * ## Why the address is editable at all
 *
 * It is the address members are told to write to, so it changes when a team changes
 * tooling — and an environment variable would need shell access and a restart for a
 * one-word edit. The permission that guards the write (`settings:write`) already
 * existed and had no implementation until now.
 *
 * ## Why there is a fallback constant
 *
 * A misconfigured or empty setting must not render a feedback screen with no address
 * at all: a member with a problem and no way to report it is worse off than one who is
 * told a stale address. The fallback is a real, monitored mailbox, and it is what the
 * screen shows until an administrator sets something else.
 */

export const FEEDBACK_EMAIL_KEY = "feedback.email";

/**
 * Shipped default, also used when the stored value is cleared.
 *
 * Overridable by `SUPPORT_EMAIL` so a fork does not have to ship with this address
 * baked into a screen. The database value wins over both.
 */
const DEFAULT_SUPPORT_EMAIL = "support@talkfirst.ccwu.cc";

export type SettingsConsumer = { key: string };

@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  private fallbackEmail(): string {
    const configured = (process.env.SUPPORT_EMAIL ?? "").trim();
    return isPlausibleEmail(configured) ? configured : DEFAULT_SUPPORT_EMAIL;
  }

  /**
   * The address shown on the feedback screen.
   *
   * Never throws and never returns empty: a read failure falls back rather than
   * breaking a screen that exists to let people report problems.
   */
  async supportEmail(): Promise<string> {
    if (!this.prisma) return this.fallbackEmail();
    try {
      const row = await this.prisma.appSetting.findUnique({
        where: { key: FEEDBACK_EMAIL_KEY },
        select: { value: true },
      });
      const stored = (row?.value ?? "").trim();
      return isPlausibleEmail(stored) ? stored : this.fallbackEmail();
    } catch (error) {
      this.logger.warn(
        `Could not read ${FEEDBACK_EMAIL_KEY} (using fallback): ${error instanceof Error ? error.message : "unknown"}`,
      );
      return this.fallbackEmail();
    }
  }

  /**
   * Sets the address. `null` or a blank string clears it back to the fallback.
   *
   * Validation happens here rather than only in the DTO so it holds for any caller,
   * including a future import or migration script — the same reasoning as the ban
   * reason check.
   */
  async setSupportEmail(value: string | null, adminUserId: string | null): Promise<string> {
    if (!this.prisma) throw new Error("AppSettingsService requires PrismaService to write");
    const trimmed = (value ?? "").trim();

    if (trimmed === "") {
      await this.prisma.appSetting.deleteMany({ where: { key: FEEDBACK_EMAIL_KEY } });
      return this.fallbackEmail();
    }
    if (!isPlausibleEmail(trimmed)) {
      throw new InvalidSupportEmailError(trimmed);
    }

    await this.prisma.appSetting.upsert({
      where: { key: FEEDBACK_EMAIL_KEY },
      update: { value: trimmed, updatedById: adminUserId },
      create: { key: FEEDBACK_EMAIL_KEY, value: trimmed, updatedById: adminUserId },
    });
    return trimmed;
  }
}

/** Thrown for a malformed address; the caller renders a specific message. */
export class InvalidSupportEmailError extends Error {
  constructor(readonly value: string) {
    // The rejected value is NOT interpolated: it reaches a log line and, on some paths,
    // an operator's screen, and echoing input back is how a header or a terminal gets
    // injected.
    super("The support address is not a valid e-mail address");
    this.name = "InvalidSupportEmailError";
  }
}

/**
 * A deliberately loose address check.
 *
 * The goal is to catch a typo before it is shown to every member — not to decide
 * whether an address is deliverable, which only sending mail can establish. A strict
 * RFC 5322 pattern rejects addresses that work in practice, and the cost of accepting
 * an odd-but-valid one here is far lower than refusing a real mailbox.
 *
 * The TLD check (a dot followed by at least two letters) is what catches the common
 * `name@company` mistake while still allowing `a@b.co`.
 */
export function isPlausibleEmail(value: string): boolean {
  if (!value || value.length > 320) return false;
  if (/\s/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)*\.[a-z]{2,}$/i.test(value);
}
