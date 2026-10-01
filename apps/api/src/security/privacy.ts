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
