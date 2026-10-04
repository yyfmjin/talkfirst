import { sha256Hex } from "../common/crypto";

/**
 * Security Audit Center (P1) — e-mail privacy for security events.
 *
 * Security events never store a plaintext e-mail address. A failed login for an
 * unknown address would otherwise turn the audit trail into a list of valid
 * addresses. Instead we keep a masked form (for a human reading the log) and a
 * stable hash (for correlation: "the same address failed 40 times").
 *
 * The hash is unsalted and therefore not a privacy guarantee on its own — it is
 * a correlation key, and the masked form is what a reviewer actually reads.
 */
export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at);
  const head = local.slice(0, 1);
  return `${head}***${domain}`;
}

export function hashEmail(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

/**
 * The same treatment for an account name, and deliberately a separate pair of
 * functions rather than a generalised one.
 *
 * `maskEmail` keeps the domain because the domain carries meaning for an address;
 * a handle has no `@` to split on, and preserving its head and tail is what makes
 * a row recognisable to whoever reads the log. The hash does not need its own
 * namespace: a username is `[a-z0-9]` only, so it can never equal an e-mail.
 */
export function maskUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (normalized.length <= 2) return "***";
  return `${normalized.slice(0, 1)}***${normalized.slice(-1)}`;
}

export function hashUsername(username: string): string {
  return sha256Hex(username.trim().toLowerCase());
}
