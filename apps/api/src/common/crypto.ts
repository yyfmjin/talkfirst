import { createHash, randomBytes, randomInt } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * SEC-005 — a 6-digit e-mail verification code.
 *
 * Drawn from the CSPRNG. `Math.random()` is not a cryptographic source: its
 * state is recoverable from a handful of outputs, which would let an attacker
 * predict the next code instead of guessing it. `randomInt` is unbounded by
 * modulo bias for this range and always yields exactly six digits.
 */
export function newVerificationCode(): string {
  return String(randomInt(100000, 1000000));
}
