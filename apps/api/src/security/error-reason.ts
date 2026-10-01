import { HttpException } from "@nestjs/common";

/**
 * Security Audit Center (P1) — the domain reason behind a thrown error.
 *
 * Reuses the `error.code` the client already receives, so a security event never
 * invents a second vocabulary for the same failure. Falls back to a caller
 * supplied code for anything unstructured (an unexpected 500, for instance),
 * which keeps the audit trail readable without leaking internal messages.
 */
export function reasonCodeOf(error: unknown, fallback: string): string {
  if (error instanceof HttpException) {
    const payload = error.getResponse();
    if (payload && typeof payload === "object" && "error" in payload) {
      const nested = (payload as { error?: { code?: unknown } }).error;
      if (nested && typeof nested.code === "string") return nested.code;
    }
  }
  return fallback;
}
