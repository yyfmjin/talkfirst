import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function newVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
