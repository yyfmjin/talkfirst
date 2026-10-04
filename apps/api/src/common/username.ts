import { randomBytes } from "node:crypto";

/**
 * The account-name rules, in one place.
 *
 * `username` is the **account name used to sign in**, not the display name —
 * `nickname` keeps that job. An account may be reached by e-mail or by username,
 * which is why the rules live in `common/` and are shared by the auth paths
 * (register / login) and by the profile projections.
 *
 * ## Why the stored value is lower-cased
 *
 * The column is `@unique`, and "Alice" vs "alice" being two accounts would be a
 * support incident and an impersonation vector (they render identically in most
 * fonts). Rather than a functional unique index on `lower(username)` — which
 * Prisma cannot express in the schema and would leave the invariant enforceable
 * only by the database — the canonical form is lower-case and normalization
 * happens on the way in. Lookup therefore needs no case handling either.
 */

export const USERNAME_MIN_LENGTH = 8;
export const USERNAME_MAX_LENGTH = 30;

/** Letters and digits only, either kind alone allowed ("最低8位"). */
export const USERNAME_PATTERN = new RegExp(
  `^[a-z0-9]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`,
);

/**
 * Substrings that may not appear anywhere in a username.
 *
 * These are long enough that a contains-match cannot realistically eat a real
 * name, and each one is a word an attacker would use to be mistaken for the
 * operator of the site. The test is deliberately a substring test, not equality:
 * `admin123` does not become acceptable just because an exact row exists.
 */
const RESERVED_SUBSTRINGS = [
  "admin",
  "administrator",
  "moderator",
  "sysadmin",
  "superuser",
  "superadmin",
  "official",
  "support",
  "staff",
  "root",
  "talkfirst",
  "webmaster",
  "postmaster",
  "hostmaster",
  "noreply",
  "no-reply",
  "abuse",
  "security",
];

/**
 * Short tokens rejected only as an ENTIRE username.
 *
 * `api` is the reason this second list exists at all: as a contains-rule it also
 * matches "capital", "rapid" and "therapist", which are perfectly ordinary
 * names. As an exact rule it still blocks the handle that could be mistaken for
 * a service endpoint. Same reasoning for the rest.
 */
const RESERVED_EXACT = [
  "api",
  "www",
  "mail",
  "smtp",
  "ftp",
  "app",
  "help",
  "test",
  "demo",
  "guest",
  "user",
  "users",
  "me",
  "you",
  "null",
  "undefined",
  "none",
  "true",
  "false",
  "system",
  "service",
  "bot",
  "robot",
  "team",
];

/**
 * Canonical form. Also drops a leading `@`, because people type handles that way
 * and rejecting it would be a pure usability tax — but the `@` must be removed
 * BEFORE the caller decides "contains an @" means "this is an e-mail".
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, "");
}

export function isReservedUsername(normalized: string): boolean {
  if (RESERVED_EXACT.includes(normalized)) return true;
  return RESERVED_SUBSTRINGS.some((token) => normalized.includes(token));
}

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; code: "USERNAME_INVALID" | "USERNAME_RESERVED"; message: string };

/**
 * Validate a user-supplied username.
 *
 * `code` is what reaches the client, so the two failures stay distinguishable in
 * the UI ("格式不对" vs "这个名字不能用"). Neither message echoes the input
 * back: a reserved-word rejection that quoted the candidate would confirm the
 * value to someone probing the filter.
 */
export function checkUsername(raw: string): UsernameCheck {
  const value = normalizeUsername(raw);
  /**
   * The reserved check runs FIRST, and that ordering is load-bearing.
   *
   * `RESERVED_EXACT` holds names that are SHORTER than the 8-character minimum
   * (`api`, `www`, `help`, `me`, …). With the format check first, those could never
   * reach this branch at all: `api` would come back "too short", which invites the
   * caller to try `api12345` — a name that is refused too, for the other reason.
   * Answering "that name is not available" whenever a reserved token is present is
   * both the more useful answer and the more honest one.
   *
   * The consequence is deliberate: a value that is BOTH malformed and reserved
   * (`admin!`) reports `USERNAME_RESERVED`. The reserved fact is the one worth
   * telling the member about.
   */
  if (isReservedUsername(value)) {
    return {
      ok: false,
      code: "USERNAME_RESERVED",
      message: "That username is not available",
    };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      code: "USERNAME_INVALID",
      message: `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} letters or digits`,
    };
  }
  return { ok: true, value };
}

/** Excludes 0/1/l/i/o: a handle gets read aloud and typed by hand. */
const GENERATED_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const GENERATED_LENGTH = 10;

/**
 * A random username for an account that does not have one yet — every account
 * created before this feature, and any registration that omits the field.
 *
 * 10 characters from a 31-symbol alphabet is ~4.9e14 values, so a collision is
 * not a design concern; the caller still has to handle the unique-constraint race
 * (`P2002`) because two concurrent inserts can pick the same value.
 */
export function generateUsername(): string {
  const bytes = randomBytes(GENERATED_LENGTH);
  let out = "";
  for (let i = 0; i < GENERATED_LENGTH; i += 1) {
    out += GENERATED_ALPHABET[bytes[i] % GENERATED_ALPHABET.length];
  }
  // The alphabet cannot contain a reserved word today (it has no 'l'/'i'/'o', so
  // "admin"/"root"/"official" are unspellable), but the invariant is asserted
  // rather than inferred — if the alphabet ever widens, this still holds.
  return isReservedUsername(out) ? generateUsername() : out;
}

/**
 * True when a Prisma error is a unique-constraint violation (`P2002`) naming the
 * `username` column.
 *
 * Two callers need this and both need the SAME answer, because two very different
 * collisions hide behind the one error code:
 *
 *   - the generated or chosen USERNAME is taken -> try another name
 *   - the E-MAIL or the OAuth identity is taken -> somebody else's write landed
 *     first; re-resolve rather than fail
 *
 * The shape is inspected rather than `instanceof
 * Prisma.PrismaClientKnownRequestError`, matching the idiom used elsewhere in this
 * codebase: importing the class makes a hand-built error object in a spec stop
 * matching. `meta.target` carries the column list — or, depending on the connector
 * and Prisma version, the index name — so both are checked.
 */
export function isUsernameConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const typed = error as { code?: string; meta?: { target?: unknown } };
  if (typed.code !== "P2002") return false;
  const target = typed.meta?.target;
  const parts = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return parts.some((entry) => entry.includes("username"));
}

/**
 * The SQL used by the migration that backfills existing accounts.
 *
 * Kept beside the TypeScript generator so the two cannot drift: same alphabet,
 * same length, same reserved-word rule. Reproduced as a comment here because a
 * migration is frozen once applied and cannot import this module.
 *
 *   alphabet = '23456789abcdefghjkmnpqrstuvwxyz', length = 10, retry while the
 *   candidate is taken or matches a reserved substring.
 */
export const BACKFILL_ALPHABET = GENERATED_ALPHABET;
export const BACKFILL_LENGTH = GENERATED_LENGTH;
