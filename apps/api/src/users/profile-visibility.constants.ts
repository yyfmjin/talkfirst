/**
 * PC-1.3: the closed whitelist of profile fields that `ProfileFieldVisibility`
 * may govern.
 *
 * `ProfileFieldVisibility.fieldKey` is a plain `VarChar(32)` on purpose (PC-1.1
 * Q5) so a new governed field needs no schema change. That extensibility must
 * NOT be read as "any key is accepted": the API owns a closed whitelist, so a
 * typo or a hostile key can never create a junk row. Anything absent from this
 * list is rejected with `VALIDATION_ERROR`.
 *
 * Deliberately absent (permanently non-toggleable): `email`, `passwordHash`,
 * `emailVerified`, `isAdmin`, `status`, `banReason`, `lastActiveAt`, `id`,
 * audit/relation fields, and every social-handle / OAuth key. Social handles
 * stay authorized exclusively by `SharedSocialAccount`; `MomentSetting.visibleTo`
 * stays independent as well (PC-1.2 preflight 4.2/4.3).
 */
export const PROFILE_VISIBILITY_FIELD_WHITELIST = [
  "nickname",
  "avatarUrl",
  "birthDate",
  "countryCode",
  "city",
  "region",
  "gender",
  "bio",
  "languages",
  "interests",
  "purposes",
  "preferredCountries",
  "attributes",
] as const;

export type ProfileVisibilityField = (typeof PROFILE_VISIBILITY_FIELD_WHITELIST)[number];

export type VisibilityTier = "PUBLIC" | "CONNECTIONS" | "PRIVATE";

export const VISIBILITY_TIERS: readonly VisibilityTier[] = ["PUBLIC", "CONNECTIONS", "PRIVATE"];

/** Absent `ProfileFieldVisibility` row means this tier (PC-1.1 Q5 / Q9). */
export const DEFAULT_FIELD_VISIBILITY: VisibilityTier = "PUBLIC";

export function isVisibilityTier(value: unknown): value is VisibilityTier {
  return value === "PUBLIC" || value === "CONNECTIONS" || value === "PRIVATE";
}

export function isProfileVisibilityField(value: unknown): value is ProfileVisibilityField {
  return (
    typeof value === "string" && (PROFILE_VISIBILITY_FIELD_WHITELIST as readonly string[]).includes(value)
  );
}

export type FieldVisibilityMap = Record<ProfileVisibilityField, VisibilityTier>;

/**
 * Collapses stored rows into a complete map. Unknown keys (impossible through
 * the API, but possible via direct DB writes) are ignored, and every whitelisted
 * field without a row resolves to the default tier.
 */
export function resolveFieldVisibilityMap(
  rows: Array<{ fieldKey: string; visibility: string }>,
): FieldVisibilityMap {
  const map = {} as FieldVisibilityMap;
  for (const field of PROFILE_VISIBILITY_FIELD_WHITELIST) {
    map[field] = DEFAULT_FIELD_VISIBILITY;
  }
  for (const row of rows) {
    if (isProfileVisibilityField(row.fieldKey) && isVisibilityTier(row.visibility)) {
      map[row.fieldKey] = row.visibility;
    }
  }
  return map;
}

export type ViewerContext = { isSelf: boolean; isConnected: boolean };

/**
 * Single decision point for every visibility-governed read.
 *
 * Callers must run the block check BEFORE consulting this: a block overrides
 * every tier, including `PUBLIC` (PC-1.3 15). This helper only answers the tier
 * question.
 */
export function canViewField(visibility: VisibilityTier, viewer: ViewerContext): boolean {
  if (viewer.isSelf) return true;
  if (visibility === "PUBLIC") return true;
  if (visibility === "CONNECTIONS") return viewer.isConnected;
  return false;
}
