/**
 * Security Audit Center (P1) — the single redaction utility.
 *
 * Every audit payload (SecurityEvent.detail/factors, AccessLog.queryDigest) must
 * pass through here before it is persisted. The rule is deliberately blunt: if a
 * key *looks* like it could carry a credential, the value is replaced outright
 * rather than pattern-matched. False positives (a redacted innocuous field) are
 * cheap; a leaked password or refresh token in a log is not.
 *
 * This module is intentionally dependency-free so it can be used from any layer
 * and unit-tested in isolation.
 */

/**
 * Keys whose values must never be persisted. Matched case-insensitively and
 * exactly (so `reasonCode`, `statusCode` and `errorCode` are *not* caught by
 * `code`). `set-cookie` is normalised to the same comparison as everything else.
 */
export const SENSITIVE_KEYS = [
  "password",
  "passwordConfirm",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "set-cookie",
  "code",
  "verificationCode",
  "resetToken",
  "oauthToken",
  "secret",
  "clientSecret",
] as const;

const SENSITIVE_KEY_SET = new Set<string>(SENSITIVE_KEYS.map((key) => key.toLowerCase()));

export const REDACTED = "[REDACTED]";

/** Recursion is capped so a hostile/deep object cannot blow the stack. */
const MAX_DEPTH = 6;
/** A single string longer than this is truncated before it can reach the DB. */
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SET.has(key.toLowerCase());
}

/**
 * Returns a redacted deep copy of `value`. Never throws, never mutates the
 * input, and is cycle-safe. Non-JSON values (functions, symbols) are dropped.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
      return clampString(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }

  if (depth >= MAX_DEPTH) return "[TRUNCATED:MAX_DEPTH]";

  const object = value as object;
  if (seen.has(object)) return "[CIRCULAR]";
  seen.add(object);
  try {
    if (Array.isArray(value)) {
      const out = value
        .slice(0, MAX_ARRAY_LENGTH)
        .map((item) => redactValue(item, depth + 1, seen));
      if (value.length > MAX_ARRAY_LENGTH) out.push("[TRUNCATED:ARRAY]");
      return out;
    }
    if (value instanceof Date) return value.toISOString();

    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_OBJECT_KEYS) {
        out["[truncated]"] = "[TRUNCATED:KEYS]";
        break;
      }
      count += 1;
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested, depth + 1, seen);
    }
    return out;
  } finally {
    // Released on the way out so a value repeated in sibling positions is still
    // rendered (only a true cycle hits the guard above).
    seen.delete(object);
  }
}

function clampString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`;
}

/**
 * Keys from a request query string that are safe to persist verbatim. Every
 * other key is dropped entirely — the raw query string is never stored, and it
 * must be assumed to carry anything.
 */
export const SAFE_QUERY_KEYS = [
  "page",
  "pageSize",
  "limit",
  "cursor",
  "type",
  "status",
  "sort",
  "order",
  "direction",
  "kind",
  "scope",
  "role",
] as const;

const SAFE_QUERY_KEY_SET = new Set<string>(SAFE_QUERY_KEYS.map((key) => key.toLowerCase()));

/**
 * Builds a small, deterministic digest such as `page=2&pageSize=20` from a query
 * object. Only whitelisted keys survive, values are truncated, and the whole
 * result is length-capped so it always fits `AccessLog.queryDigest`.
 */
export function summarizeQuery(query: unknown): string | undefined {
  if (!query || typeof query !== "object" || Array.isArray(query)) return undefined;

  const parts: string[] = [];
  for (const [key, raw] of Object.entries(query as Record<string, unknown>)) {
    if (!SAFE_QUERY_KEY_SET.has(key.toLowerCase())) continue;
    const value = Array.isArray(raw) ? raw.join(",") : raw;
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${clampString(String(value)).slice(0, 64)}`);
  }
  if (parts.length === 0) return undefined;
  parts.sort((a, b) => a.localeCompare(b));
  return clampString(parts.join("&")).slice(0, 512);
}

/**
 * Serialises a value for a Prisma `Json` column: redacted first, then capped so
 * an oversized payload degrades into a marker instead of a failed insert.
 */
export function toSafeJson(value: unknown, maxChars = 4000): unknown {
  if (value === undefined) return undefined;
  const redacted = redact(value);
  const serialized = JSON.stringify(redacted);
  if (serialized !== undefined && serialized.length > maxChars) {
    return { truncated: true, preview: serialized.slice(0, maxChars) };
  }
  return redacted;
}
