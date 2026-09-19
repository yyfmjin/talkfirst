/**
 * Phase B3 — the project's single definition of 「资料完整」 (profile complete).
 *
 * Before B3 the rule existed as the same literal in two places:
 *
 *     profileCompleted: Boolean(user.nickname && user.birthDate)
 *
 * ...in `auth.service.ts` (the login response) and `users.service.ts` (the
 * public card). B3 needs the same answer on the admin user-detail screen, and
 * B3 §十 forbids the console from growing a second standard of its own
 * (「禁止：Dashboard 与 User Detail 各自一套 completion 规则」). So the literal
 * was extracted here rather than copied a third time: both existing call sites
 * now call `isProfileComplete`, and the admin service calls
 * `profileCompletionOf`, which is derived from the same field list. There is
 * exactly one place to change.
 *
 * ## Why only two fields
 *
 * Onboarding collects far more than this (avatar, city, gender, bio, interests,
 * languages, purposes, countries, social accounts), but the product only ever
 * *requires* two of them: a nickname and a birth date. Those are precisely the
 * fields `Boolean(nickname && birthDate)` tests, and that boolean is what gates
 * the app. `profileCompletion` therefore reports 2 as its denominator rather
 * than inventing a ten-field scorecard that no other part of the product agrees
 * with.
 *
 * ## Truthiness is deliberate
 *
 * The check is `!user.nickname`, not `user.nickname == null`. The pre-B3 rule
 * was `Boolean(...)`, so an empty-string nickname has always counted as
 * *missing*. Testing for `null` here would silently reclassify existing
 * accounts and make the console disagree with the app about the same user.
 */

/**
 * The fields onboarding actually requires, in the order the console lists them.
 *
 * Adding an entry changes `isProfileComplete` and every consumer of
 * `profileCompletionOf` at once — which is the entire point of the list.
 */
export const REQUIRED_PROFILE_FIELDS = ["nickname", "birthDate"] as const;

export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

/** The subset of `User` the rule reads, so callers cannot pass a whole row by accident. */
export type ProfileCompletionSource = {
  nickname?: string | null;
  birthDate?: Date | string | null;
};

export type ProfileCompletion = {
  /** How many of the required fields are filled. */
  completed: number;
  /** `REQUIRED_PROFILE_FIELDS.length` — the denominator the UI shows. */
  total: number;
  /** Already an integer, so the UI never has to round a second time. */
  percentage: number;
  /** Which fields are unfilled, so the console can say *what* is missing. */
  missing: RequiredProfileField[];
};

/** The required fields this user has not filled in yet. */
export function missingProfileFields(user: ProfileCompletionSource): RequiredProfileField[] {
  const missing: RequiredProfileField[] = [];
  // Truthiness on purpose — see the note above about the pre-B3 `Boolean(...)`.
  if (!user.nickname) missing.push("nickname");
  if (!user.birthDate) missing.push("birthDate");
  return missing;
}

/**
 * The project's existing 「资料完整」 boolean.
 *
 * Identical in meaning to the `Boolean(user.nickname && user.birthDate)` it
 * replaced, so `auth.service` and `users.service` keep answering exactly what
 * they answered before B3.
 */
export function isProfileComplete(user: ProfileCompletionSource): boolean {
  return missingProfileFields(user).length === 0;
}

/**
 * The same rule expressed as a countable score for the admin console.
 *
 * `percentage` falls back to `0` for an empty field list. `REQUIRED_PROFILE_FIELDS`
 * is a compile-time constant and cannot be empty today, but a future edit could
 * make it so, and `NaN` rendered into a UI is worse than a plain `0`.
 */
export function profileCompletionOf(user: ProfileCompletionSource): ProfileCompletion {
  // Annotated `number` on purpose: `REQUIRED_PROFILE_FIELDS` is `as const`, so
  // `.length` is the literal type `2` and the zero guard below would be flagged
  // as an impossible comparison. Widening here keeps the guard honest — it is
  // dead code today and would start working the day someone empties the list.
  const total: number = REQUIRED_PROFILE_FIELDS.length;
  const missing = missingProfileFields(user);
  const completed = total - missing.length;
  return {
    completed,
    total,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    missing,
  };
}
