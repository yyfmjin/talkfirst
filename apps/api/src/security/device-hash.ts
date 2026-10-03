import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";

/**
 * Security Audit Center (P1) — device identification.
 *
 * ## What this is, and what it is not
 *
 * `deviceHash` is a *device identifier*: a salted hash of a normalised
 * User-Agent. It groups requests that look like they came from the same kind of
 * client. It is **not** a device fingerprint — UA strings collide, are trivially
 * spoofed, and say nothing about the person. It must therefore never be used on
 * its own to conclude that a user (or a device) is malicious; it is only one
 * correlation signal among several.
 *
 * ## Salt handling
 *
 * The salt comes from `SECURITY_DEVICE_SALT`. It is never hardcoded and never
 * committed. If it is missing we do **not** silently substitute a constant —
 * that would produce stable, guessable hashes that look legitimate. Instead we
 * refuse to compute an identifier (return `undefined`) and warn once, so device
 * correlation is explicitly disabled rather than quietly wrong.
 */
const logger = new Logger("DeviceIdentity");
let warnedAboutMissingSalt = false;

const SALT_ENV = "SECURITY_DEVICE_SALT";

export function normalizeUserAgent(userAgent: string | undefined | null): string {
  return (userAgent ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isDeviceHashEnabled(): boolean {
  return Boolean(process.env[SALT_ENV]?.trim());
}

export function deviceHash(userAgent: string | undefined | null): string | undefined {
  const normalized = normalizeUserAgent(userAgent);
  if (normalized.length === 0) return undefined;

  const salt = process.env[SALT_ENV]?.trim();
  if (!salt) {
    if (!warnedAboutMissingSalt) {
      warnedAboutMissingSalt = true;
      logger.warn(
        `${SALT_ENV} is not set — device identifiers are disabled for this process.`,
      );
    }
    return undefined;
  }

  return createHash("sha256").update(`${salt}:${normalized}`).digest("hex");
}

/**
 * Phase O1 — hash one User-Agent for the bounded correlation list on
 * `DeviceIdentity.userAgents`.
 *
 * Same salt and same normalisation as `deviceHash`, but a different prefix so
 * the two derivations can never collide: `deviceHash` identifies the *device*
 * (used as a column and an index key), while this identifies *one UA string
 * seen on* that device. `DeviceIdentity.userAgents` therefore stores hashes
 * only — the schema's "observed User-Agent strings are hashed for correlation,
 * never stored raw" note stays true, and the raw string continues to live solely
 * on `AccessLog.userAgent` where it is already truncated and short-lived.
 *
 * Returns `undefined` without a salt, exactly like `deviceHash`, so the two
 * agree on when device identification is disabled.
 */
export function userAgentFingerprint(userAgent: string | undefined | null): string | undefined {
  const normalized = normalizeUserAgent(userAgent);
  if (normalized.length === 0) return undefined;
  const salt = process.env[SALT_ENV]?.trim();
  if (!salt) return undefined;
  return createHash("sha256").update(`${salt}:ua:${normalized}`).digest("hex");
}
