/**
 * PC-1.4: the front-end contract for the profile API.
 *
 * These types mirror `apps/api/src/users/users.service.ts` (`PublicProfile` /
 * `PublicCard`) and `apps/api/src/users/profile-attributes.view.ts`
 * (`AttributeView`) exactly. This module is the single place the web app
 * describes what the API returns — a page-local duplicate is how the previous
 * `PublicProfile` drifted (missing `region`/`attributes`, non-nullable
 * `gender`).
 */

/** `Visibility` enum: per-attribute tier and per-field profile tier share it. */
export type VisibilityTier = "PUBLIC" | "CONNECTIONS" | "PRIVATE";

import type { MsgKey } from "@/lib/i18n";

export type AttributeKind = "ABOUT_ME" | "LOOKING_FOR";

/** Derived by the API from `definitionId`; never sent by the client. */
export type AttributeSource = "SYSTEM" | "CUSTOM";

export type AttributeView = {
  id: string;
  kind: AttributeKind;
  source: AttributeSource;
  definitionId: string | null;
  /** Catalog key — SYSTEM rows only. */
  key: string | null;
  category: string | null;
  label: string;
  labelZh: string | null;
  value: string | null;
  visibility: VisibilityTier;
  sortOrder: number;
  /** `PENDING` / `REJECTED` rows are only visible to their owner. */
  reviewStatus: string;
  /**
   * `null` for CUSTOM rows; `false` for a SYSTEM row whose tag was retired.
   * A retired tag must stay rendered — the selection is kept, it just cannot be
   * re-chosen (PC-1.2 Q10).
   */
  definitionActive: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type AttributeGroups = {
  aboutMe: AttributeView[];
  lookingFor: AttributeView[];
};

/** One row of `GET /meta/attributes` (the raw `AttributeDefinition` model). */
export type AttributeDefinition = {
  id: string;
  key: string;
  scope: AttributeSource;
  kind: AttributeKind;
  category: string;
  label: string;
  labelZh: string | null;
  valueType: string;
  sort: number;
  isActive: boolean;
  isSearchable: boolean;
};

/**
 * `GET /users/:id`. Scalar fields the viewer may not see arrive as `null`, and
 * aggregate fields as `[]`, so a hidden field is indistinguishable from an
 * unset one.
 */
export type PublicProfile = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  age: number | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  city: string | null;
  region: string | null;
  /** Governed by `ProfileFieldVisibility`, hence nullable. */
  gender: string | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null; category: string }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  preferredCountries: Array<{ code: string; name: string; flag: string | null }>;
  attributes: AttributeGroups;
  relationship: { isSelf: boolean; isConnected: boolean };
  /**
   * 送花（虚拟礼物，2026-10-06）：收到花的朵数，以及查看者自己送过没有。
   * 镜像 `apps/api/src/users/users.service.ts` 的 `PublicProfile`。
   */
  flowerCount: number;
  flowerFromViewer: boolean;
};

/**
 * The closed whitelist of governed profile fields.
 *
 * Must stay identical to `PROFILE_VISIBILITY_FIELD_WHITELIST` in
 * `apps/api/src/users/profile-visibility.constants.ts`: the API answers 400 for
 * anything else, and nothing outside this list (`email`, `passwordHash`,
 * `isAdmin`, social handles…) is ever toggleable.
 */
export const PROFILE_VISIBILITY_FIELDS = [
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

export type ProfileVisibilityField = (typeof PROFILE_VISIBILITY_FIELDS)[number];

export type FieldVisibilityRow = {
  fieldKey: ProfileVisibilityField;
  visibility: VisibilityTier;
};

export const VISIBILITY_TIERS: readonly VisibilityTier[] = ["PUBLIC", "CONNECTIONS", "PRIVATE"];

/** User-facing wording as **dictionary keys** — the raw enum names are never shown. */
export const VISIBILITY_LABELS: Record<VisibilityTier, MsgKey> = {
  PUBLIC: "visibility.publicLabel",
  CONNECTIONS: "visibility.connectionsLabel",
  PRIVATE: "visibility.privateLabel",
};

export const VISIBILITY_HINTS: Record<VisibilityTier, MsgKey> = {
  PUBLIC: "visibility.publicHint",
  CONNECTIONS: "visibility.connectionsHint",
  PRIVATE: "visibility.privateHint",
};

/** Compact wording for the 3-way segmented control, where space is tight. */
export const VISIBILITY_SHORT_LABELS: Record<VisibilityTier, MsgKey> = {
  PUBLIC: "visibility.public",
  CONNECTIONS: "visibility.connections",
  PRIVATE: "visibility.private",
};

export const FIELD_VISIBILITY_LABELS: Record<ProfileVisibilityField, MsgKey> = {
  nickname: "field.nickname",
  avatarUrl: "field.avatarUrl",
  birthDate: "field.birthDate",
  countryCode: "field.countryCode",
  city: "field.city",
  region: "field.region",
  gender: "field.gender",
  bio: "field.bio",
  languages: "field.languages",
  interests: "field.interests",
  purposes: "field.purposes",
  preferredCountries: "field.preferredCountries",
  attributes: "field.attributes",
};

/** The tier assumed when the API reports no stored row for a field. */
export const DEFAULT_FIELD_VISIBILITY: VisibilityTier = "PUBLIC";

/** `labelZh` is only meaningful for system tags, where it may be absent. */
export function attributeLabel(attribute: Pick<AttributeView, "label" | "labelZh" | "source">): string {
  return attribute.source === "SYSTEM" ? attribute.labelZh ?? attribute.label : attribute.label;
}

export function avatarInitial(nickname: string | null | undefined): string {
  return (nickname ?? "?").slice(0, 1).toUpperCase();
}
